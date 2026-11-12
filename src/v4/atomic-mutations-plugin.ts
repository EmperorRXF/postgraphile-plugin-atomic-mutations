import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { makeWrapResolversPlugin } from 'graphile-utils';
import { Kind, parse } from 'graphql';
import type { OperationDefinitionNode } from 'graphql';
import {
  MutationAtomicityHeaderName,
  MutationAtomicityHeaderValue,
} from '../constants';

export type MutationAtomicityContext = {
  /** True once the savepoint covering the request's mutations exists */
  started: boolean;
  /** True once a mutation failed and the request's mutations were rolled back */
  failed: boolean;
};

export interface AtomicMutationRequest extends IncomingMessage {
  mutationAtomicityContext: MutationAtomicityContext;
}

interface GraphQLRequestParams {
  query?: string;
  operationName?: string | null;
}

interface RequestLike {
  headers: IncomingHttpHeaders;
  body?: unknown;
  mutationAtomicityContext?: MutationAtomicityContext;
}

interface PgClientLike {
  query(text: string): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMutationAtomicityContext = (
  value: unknown,
): value is MutationAtomicityContext =>
  isRecord(value) &&
  typeof value.started === 'boolean' &&
  typeof value.failed === 'boolean';

const isPgClientLike = (value: unknown): value is PgClientLike =>
  isRecord(value) && typeof value.query === 'function';

const toRequestParams = (body: unknown): GraphQLRequestParams | undefined => {
  if (typeof body === 'string') {
    return { query: body };
  }

  if (Array.isArray(body)) {
    if (body.length > 1) {
      throw new Error(
        'AtomicMutationsPlugin does not support GraphQL query batching',
      );
    }
    return toRequestParams(body[0]);
  }

  if (!isRecord(body)) {
    return undefined;
  }

  return {
    query: typeof body.query === 'string' ? body.query : undefined,
    operationName:
      typeof body.operationName === 'string' ? body.operationName : null,
  };
};

const findOperation = (
  query: string,
  operationName: string | null | undefined,
): OperationDefinitionNode | undefined => {
  const operations = parse(query).definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );

  if (operationName == null) {
    return operations.length === 1 ? operations[0] : undefined;
  }

  return operations.find(
    (operation) => operation.name?.value === operationName,
  );
};

const isAtomicityRequested = (
  headers: IncomingHttpHeaders,
  enablePluginByDefault: boolean,
): boolean => {
  const header = headers[MutationAtomicityHeaderName];

  if (header === undefined) {
    return enablePluginByDefault;
  }

  return (
    typeof header === 'string' &&
    header.toLowerCase() === MutationAtomicityHeaderValue.ON
  );
};

/**
 * Decides whether the request runs with mutation atomicity and returns the
 * context the plugin needs, or `undefined` when atomicity does not apply.
 * Request bodies are `undefined` for subscription websocket messages.
 */
export const getMutationAtomicityContext = (
  req: RequestLike,
  enablePluginByDefault = false,
): MutationAtomicityContext | undefined => {
  const params = toRequestParams(req.body);

  if (params?.query === undefined) {
    return undefined;
  }

  const operation = findOperation(params.query, params.operationName);

  // A plain string, as graphql 15 types it as a union and graphql 16 as an enum
  const operationType: string | undefined = operation?.operation;

  if (
    operation === undefined ||
    operationType !== 'mutation' ||
    !isAtomicityRequested(req.headers, enablePluginByDefault)
  ) {
    req.headers[MutationAtomicityHeaderName] = MutationAtomicityHeaderValue.OFF;
    return undefined;
  }

  req.headers[MutationAtomicityHeaderName] = MutationAtomicityHeaderValue.ON;
  req.mutationAtomicityContext = { started: false, failed: false };

  return req.mutationAtomicityContext;
};

export const MutationNotExecutedMessage =
  'Mutation not executed: an earlier mutation in this request failed and all its mutations were rolled back';

/**
 * Root mutation fields run one after another. The first one opens a savepoint
 * inside PostGraphile's request transaction. When a mutation fails, the
 * savepoint is rolled back and the remaining mutations are not executed, so
 * the transaction commits none of them.
 */
export const AtomicMutationsPlugin: ReturnType<typeof makeWrapResolversPlugin> =
  makeWrapResolversPlugin(
    (context) =>
      context.scope.isRootMutation ? { scope: context.scope } : null,
    () => async (resolver, source, args, context, resolveInfo) => {
      const mutationAtomicityContext = isRecord(context)
        ? context.mutationAtomicityContext
        : undefined;
      const pgClient = isRecord(context) ? context.pgClient : undefined;

      if (
        !isMutationAtomicityContext(mutationAtomicityContext) ||
        !isPgClientLike(pgClient)
      ) {
        return resolver(source, args, context, resolveInfo);
      }

      if (mutationAtomicityContext.failed) {
        throw new Error(MutationNotExecutedMessage);
      }

      if (!mutationAtomicityContext.started) {
        await pgClient.query('SAVEPOINT atomic_mutations_tx_start');
        mutationAtomicityContext.started = true;
      }

      try {
        const result: unknown = await resolver(
          source,
          args,
          context,
          resolveInfo,
        );
        return result;
      } catch (error) {
        mutationAtomicityContext.failed = true;
        await pgClient.query('ROLLBACK TO SAVEPOINT atomic_mutations_tx_start');
        throw error;
      }
    },
  );
