import type { PgClient, WithPgClient } from '@dataplan/pg';
import type { GrafastExecutionArgs } from 'grafast';
import type { NormalizedRequestDigest } from 'grafserv';
import { Kind, OperationTypeNode } from 'graphql';
import type {
  DocumentNode,
  ExecutionResult,
  OperationDefinitionNode,
} from 'graphql';
import {
  MutationAtomicityHeaderName,
  MutationAtomicityHeaderValue,
} from '../constants';
import { version } from '../version';

export interface AtomicMutationsOptions {
  /**
   * Applies mutation atomicity when the request carries no
   * `X-Mutation-Atomicity` header. Defaults to `false`.
   */
  enablePluginByDefault?: boolean;
}

declare global {
  namespace GraphileConfig {
    interface Preset {
      atomicMutations?: AtomicMutationsOptions;
    }
  }
}

type ExecuteResult = Awaited<ReturnType<typeof import('grafast').execute>>;

/** Key of the response extension that marks a rolled back request */
export const RolledBackExtensionName = 'atomicMutations';

class RollbackSignal {
  constructor(public readonly result: ExecutionResult) {}
}

type PgSettings = Record<string, string | undefined> | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Set on the context by @dataplan/pg for each pgService, for any adaptor.
const isWithPgClient = (value: unknown): value is WithPgClient<PgClient> =>
  typeof value === 'function';

const isPgSettings = (value: unknown): value is PgSettings =>
  value === null || isRecord(value);

const definedEntries = (settings: PgSettings): [string, string][] =>
  Object.entries(settings ?? {}).filter(
    (entry): entry is [string, string] => entry[1] != null,
  );

const isSameSettings = (expected: PgSettings, actual: unknown): boolean => {
  const settings = actual ?? null;

  if (settings === expected) {
    return true;
  }
  if (!isPgSettings(settings)) {
    return false;
  }

  const expectedEntries = definedEntries(expected);
  return (
    expectedEntries.length === definedEntries(settings).length &&
    expectedEntries.every(([key, value]) => settings?.[key] === value)
  );
};

const isAsyncIterable = (
  value: unknown,
): value is AsyncIterable<unknown> & AsyncIterator<unknown> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value;

const isMutationOperation = (
  document: DocumentNode,
  operationName: string | null | undefined,
): boolean => {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );
  const operation =
    operationName == null
      ? operations.length === 1
        ? operations[0]
        : undefined
      : operations.find(
          (definition) => definition.name?.value === operationName,
        );

  return operation?.operation === OperationTypeNode.MUTATION;
};

const isAtomicityRequested = (args: GrafastExecutionArgs): boolean => {
  const http: NormalizedRequestDigest | undefined = args.requestContext?.http;
  const header = http?.getHeader(MutationAtomicityHeaderName);

  if (header === undefined) {
    return args.resolvedPreset?.atomicMutations?.enablePluginByDefault ?? false;
  }

  return header.toLowerCase() === MutationAtomicityHeaderValue.ON;
};

/**
 * Runs the whole operation inside one transaction per pgService. Each
 * database call runs in a savepoint inside that transaction, so a failed
 * mutation does not abort the others; any error in the result rolls back
 * everything.
 */
const executeAtomically = async (
  args: GrafastExecutionArgs,
  next: () => Promise<ExecuteResult> | ExecuteResult,
): Promise<ExecuteResult> => {
  const pgServices = args.resolvedPreset?.pgServices ?? [];
  const context = args.contextValue;

  if (!isRecord(context)) {
    return next();
  }

  const run = async (serviceIndex: number): Promise<ExecuteResult> => {
    const pgService = pgServices[serviceIndex];

    if (pgService === undefined) {
      const result = await next();

      if (isAsyncIterable(result)) {
        await result.return?.();
        throw new Error(
          'AtomicMutationsPlugin does not support incremental delivery (@defer / @stream)',
        );
      }

      if (result.errors?.length) {
        throw new RollbackSignal(result);
      }

      return result;
    }

    const { name, withPgClientKey, pgSettingsKey } = pgService;
    const withPgClient = context[withPgClientKey];
    const pgSettings =
      pgSettingsKey === undefined ? null : (context[pgSettingsKey] ?? null);

    if (!isWithPgClient(withPgClient) || !isPgSettings(pgSettings)) {
      throw new Error(
        `AtomicMutationsPlugin could not find the context of pgService '${name}'`,
      );
    }

    return withPgClient(pgSettings, (client) =>
      client.withTransaction(async (transactionClient) => {
        // Every call gets its own savepoint, so a failing statement leaves the
        // outer transaction usable for the remaining mutations. The transaction
        // carries the request's settings, so a call that asks for different
        // ones cannot be served from it.
        const withSavepointClient: WithPgClient<PgClient> = async (
          callSettings,
          callback,
        ) => {
          if (!isSameSettings(pgSettings, callSettings)) {
            throw new Error(
              'AtomicMutationsPlugin cannot run a database call with pgSettings that differ from the request',
            );
          }
          return transactionClient.withTransaction(async (savepointClient) =>
            callback(savepointClient),
          );
        };

        context[withPgClientKey] = withSavepointClient;
        try {
          return await run(serviceIndex + 1);
        } finally {
          context[withPgClientKey] = withPgClient;
        }
      }),
    );
  };

  try {
    return await run(0);
  } catch (error) {
    if (error instanceof RollbackSignal) {
      return {
        ...error.result,
        extensions: {
          ...error.result.extensions,
          [RolledBackExtensionName]: { rolledBack: true },
        },
      };
    }
    throw error;
  }
};

export const AtomicMutationsPlugin: GraphileConfig.Plugin = {
  name: 'AtomicMutationsPlugin',
  description:
    'Commits all mutations of a GraphQL request together, or rolls them all back if any of them fails',
  version,
  grafast: {
    middleware: {
      execute(next, { args }) {
        if (
          !isMutationOperation(args.document, args.operationName) ||
          !isAtomicityRequested(args)
        ) {
          return next();
        }

        return executeAtomically(args, next);
      },
    },
  },
};
