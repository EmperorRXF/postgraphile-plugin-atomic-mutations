import {
  getMutationAtomicityContext,
  MutationAtomicityHeaderName,
  MutationAtomicityHeaderValue,
} from './atomic-mutations-plugin';

const reqWithHeaderOff = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.OFF },
  mutationAtomicityContext: {
    totalMutations: 1,
    executedMutations: [{ hasErrors: false }],
  },
};

const reqWithoutHeader = {
  headers: {},
  mutationAtomicityContext: {
    totalMutations: 1,
    executedMutations: [{ hasErrors: false }],
  },
};

const reqMutationWithErrors = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  mutationAtomicityContext: {
    totalMutations: 1,
    executedMutations: [{ hasErrors: false }],
  },
};

const reqMutationWithoutErrors = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  mutationAtomicityContext: {
    totalMutations: 1,
    executedMutations: [{ hasErrors: false }],
  },
};

test('retrieve mutationAtomicityContext - reqMutationWithErrors', () => {
  const mutationAtomicityContext = getMutationAtomicityContext(
    reqMutationWithErrors,
  );

  expect(mutationAtomicityContext).toBeTruthy();
});

test('retrieve mutationAtomicityContext - reqMutationWithoutErrors', () => {
  const mutationAtomicityContext = getMutationAtomicityContext(
    reqMutationWithoutErrors,
  );

  expect(mutationAtomicityContext).toBeTruthy();
});

test('MutationAtomicityHeaderName - OFF', () => {
  const mutationAtomicityContext = getMutationAtomicityContext(
    reqWithHeaderOff,
  );

  expect(mutationAtomicityContext).toBeFalsy();
});

test('MutationAtomicityHeaderName - Missing', () => {
  const mutationAtomicityContext = getMutationAtomicityContext(
    reqWithoutHeader,
  );

  expect(mutationAtomicityContext).toBeFalsy();
});
