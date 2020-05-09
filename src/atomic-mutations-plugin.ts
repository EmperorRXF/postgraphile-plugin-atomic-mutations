import { parse } from 'graphql';
import { IncomingMessage } from 'http';
import { makeWrapResolversPlugin } from 'postgraphile';

export const MutationAtomicityHeaderName = 'x-mutation-atomicity';
export enum MutationAtomicityHeaderValue {
  ON = 'on',
  OFF = 'off',
}

interface PostGraphileContext {
  mutationAtomicityContext: MutationAtomicityContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AtomicMutationRequest extends IncomingMessage {
  mutationAtomicityContext: MutationAtomicityContext;
}

export type MutationAtomicityContext = {
  totalMutations: number;
  executedMutations: { hasErrors: boolean }[];
};

export const getMutationAtomicityContext = (req): MutationAtomicityContext => {
  if (req.headers[MutationAtomicityHeaderName] === 'on') {
    return (req as AtomicMutationRequest).mutationAtomicityContext;
  } else {
    return undefined;
  }
};

export const AtomicMutationsHook = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ['postgraphile:httpParamsList'](paramsList: Array<any>, { req }) {
    if (paramsList.length > 1) {
      throw Error(
        'AtomicMutationsPlugin does not support GraphQL query batching',
      );
    }

    if (paramsList.length === 1) {
      const { query, operationName } = paramsList[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedQuery = parse(query) as any;

      const [executedDefinition] = parsedQuery.definitions.filter(
        (definition) => definition.name.value === operationName,
      );

      if (
        executedDefinition &&
        executedDefinition.operation === 'mutation' &&
        req.headers[MutationAtomicityHeaderName].toLowerCase() ===
          MutationAtomicityHeaderValue.ON
      ) {
        const totalMutations = executedDefinition.selectionSet.selections.filter(
          (selection) => selection.name.value !== '__typename',
        ).length;

        (req as AtomicMutationRequest).mutationAtomicityContext = {
          totalMutations,
          executedMutations: [],
        };
      } else {
        req.headers[MutationAtomicityHeaderName] =
          MutationAtomicityHeaderValue.OFF;
      }
    }

    return paramsList;
  },
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
          mutationAtomicityContext.totalMutations &&
        mutationAtomicityContext.executedMutations.filter(
          (mutation) => mutation.hasErrors === true,
        ).length
      ) {
        pgClient.query(`rollback`);
      }
    }
  },
);
