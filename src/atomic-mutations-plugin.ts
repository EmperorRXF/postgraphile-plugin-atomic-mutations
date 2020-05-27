import { parse } from 'graphql';
import { IncomingMessage } from 'http';
import { makeWrapResolversPlugin } from 'postgraphile';

interface PostGraphileContext {
  mutationAtomicityContext: MutationAtomicityContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export const MutationAtomicityHeaderName = 'x-mutation-atomicity';

export enum MutationAtomicityHeaderValue {
  ON = 'on',
  OFF = 'off',
}

export interface AtomicMutationRequest extends IncomingMessage {
  mutationAtomicityContext: MutationAtomicityContext;
}

export type MutationAtomicityContext = {
  totalMutations: number;
  executedMutations: { hasErrors: boolean }[];
};

export const getMutationAtomicityContext = (
  req,
  enablePluginByDefault = false,
): MutationAtomicityContext => {
  const body: string | object = req.body;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paramsList: any = typeof body === 'string' ? { query: body } : body;

  if (Array.isArray(paramsList) && paramsList.length > 1) {
    throw Error(
      'AtomicMutationsPlugin does not support GraphQL query batching',
    );
  }

  const { query, operationName } = paramsList;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsedQuery = parse(query) as any;

  const [executedDefinition] = parsedQuery.definitions.filter(
    (definition) =>
      (definition.name === undefined && (operationName === undefined || operationName === null)) ||
      definition.name.value === operationName,
  );

  if (
    executedDefinition &&
    executedDefinition.operation === 'mutation' &&
    ((req.headers[MutationAtomicityHeaderName] &&
      (req.headers[MutationAtomicityHeaderName] as string).toLowerCase() ===
        MutationAtomicityHeaderValue.ON) ||
      (req.headers[MutationAtomicityHeaderName] === undefined &&
        enablePluginByDefault))
  ) {
    req.headers[MutationAtomicityHeaderName] = MutationAtomicityHeaderValue.ON;

    const totalMutations = executedDefinition.selectionSet.selections.filter(
      (selection) => selection.name.value !== '__typename',
    ).length;

    (req as AtomicMutationRequest).mutationAtomicityContext = {
      totalMutations,
      executedMutations: [],
    };
  } else {
    req.headers[MutationAtomicityHeaderName] = MutationAtomicityHeaderValue.OFF;
  }

  if (
    req.headers[MutationAtomicityHeaderName] === MutationAtomicityHeaderValue.ON
  ) {
    return (req as AtomicMutationRequest).mutationAtomicityContext;
  } else {
    return undefined;
  }
};

export const AtomicMutationsPlugin = makeWrapResolversPlugin(
  (context) => {
    if (context.scope.isRootMutation) {
      return { scope: context.scope };
    } else {
      return null;
    }
  },
  () => async (resolver, source, args, context, resolveInfo) => {
    const {
      mutationAtomicityContext,
      pgClient,
    } = context as PostGraphileContext;

    try {
      if (
        mutationAtomicityContext &&
        mutationAtomicityContext.executedMutations.length === 0
      ) {
        await pgClient.query('SAVEPOINT atomic_mutations_tx_start');
      }

      const result = await resolver(source, args, context, resolveInfo);

      if (mutationAtomicityContext) {
        mutationAtomicityContext.executedMutations.push({ hasErrors: false });
      }

      return result;
    } catch (error) {
      if (mutationAtomicityContext) {
        mutationAtomicityContext.executedMutations.push({ hasErrors: true });
      }

      throw error;
    } finally {
      if (
        mutationAtomicityContext &&
        mutationAtomicityContext.executedMutations.length ===
          mutationAtomicityContext.totalMutations
      ) {
        if (
          mutationAtomicityContext.executedMutations.filter(
            (mutation) => mutation.hasErrors === true,
          ).length
        ) {
          await pgClient.query(
            `ROLLBACK TO SAVEPOINT atomic_mutations_tx_start`,
          );
        } else {
          await pgClient.query('RELEASE SAVEPOINT atomic_mutations_tx_start');
        }
      }
    }
  },
);
