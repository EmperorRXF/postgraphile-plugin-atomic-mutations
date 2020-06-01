import {
  getMutationAtomicityContext,
  MutationAtomicityHeaderName,
  MutationAtomicityHeaderValue,
} from './atomic-mutations-plugin';

const reqSuperSimpleQueryHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: `{
    someQuery
  }`,
};

const reqSimpleQueryHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `{
      someQuery
    }`,
  },
};

const reqSimpleMutationHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `mutation {
      someMutation
    }`,
  },
};

const reqSimpleMutationHeaderOff = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.OFF },
  body: {
    query: `mutation {
      someMutation
    }`,
  },
};

const reqSimpleMutationHeaderUndefined = {
  headers: {},
  body: {
    query: `mutation {
      someMutation
    }`,
  },
};

const reqSingleQueryHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `query QueryName { 
      someQuery
      anotherQuery
    }`,
    operationName: 'QueryName',
  },
};

const reqSingleAnonymousQueryHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `query {
      someQuery
      anotherQuery
    }`,
    operationName: null,
  },
};

const reqSingleMutationHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `mutation OperationName { 
      __typename
      someMutation
      anotherMutation
    }`,
    operationName: 'OperationName',
    totalMutations: 2,
  },
};

const reqMixedQueryMutationHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `
    query QueryName { 
      someQuery
    }

    mutation MutationName { 
      __typename
      someMutation
      anotherMutation
    }`,
    operationName: 'MutationName',
    totalMutations: 2,
  },
};

const reqMixedQueryMutationHeaderOff = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.OFF },
  body: {
    query: `
    query QueryName { 
      someQuery
    }

    mutation MutationName { 
      __typename
      someMutation
      anotherMutation
    }`,
    operationName: 'MutationName',
    totalMutations: 2,
  },
};

const reqMultipleMutationHeaderOn = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: {
    query: `
    query QueryName { 
      someQuery
    }

    mutation MutationName { 
      __typename
      someMutation
      anotherMutation
    }`,
    operationName: 'MutationName',
    totalMutations: 2,
  },
};

const reqMultipleMutationHeaderOff = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.OFF },
  body: {
    query: `
    query QueryName { 
      someQuery
    }

    mutation MutationName { 
      __typename
      someMutation
      anotherMutation
    }`,
    operationName: 'MutationName',
    totalMutations: 2,
  },
};

const reqUnsupportedQueryBatching = {
  headers: { [MutationAtomicityHeaderName]: MutationAtomicityHeaderValue.ON },
  body: [
    {
      query: `query QueryName { 
        someQuery
      }`,
    },
    {
      query: `query QueryName { 
        someQuery
      }`,
    },
  ],
};

describe('query operations', () => {
  test('super simple query - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSuperSimpleQueryHeaderOn,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('simple query - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSimpleQueryHeaderOn,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('single query - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSingleQueryHeaderOn,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('single anonymous query - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSingleAnonymousQueryHeaderOn,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });
});

describe('mutation operations', () => {
  test('simple mutation - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSimpleMutationHeaderOn,
    );

    expect(mutationAtomicityContext).toBeTruthy();
  });

  test('simple mutation - header off', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSimpleMutationHeaderOff,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('simple mutation - header undefined', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSimpleMutationHeaderUndefined,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('single mutation - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSingleMutationHeaderOn,
    );

    expect(mutationAtomicityContext).toBeTruthy();
  });

  test('multiple mutation - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMultipleMutationHeaderOn,
    );

    expect(mutationAtomicityContext).toBeTruthy();
  });

  test('multiple mutation - header off', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMultipleMutationHeaderOff,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });

  test('mixed query & mutation - header on', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMixedQueryMutationHeaderOn,
    );

    expect(mutationAtomicityContext).toBeTruthy();
  });

  test('mixed query & mutation - header off', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMixedQueryMutationHeaderOff,
    );

    expect(mutationAtomicityContext).toBeFalsy();
  });
});

describe('mutation counts', () => {
  test('single mutation - total mutation count', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqSingleMutationHeaderOn,
    );

    expect(mutationAtomicityContext.totalMutations).toEqual(
      reqSingleMutationHeaderOn.body.totalMutations,
    );
  });

  test('multiple mutation - total mutation count', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMultipleMutationHeaderOn,
    );

    expect(mutationAtomicityContext.totalMutations).toEqual(
      reqMultipleMutationHeaderOn.body.totalMutations,
    );
  });

  test('mixed query & mutation - total mutation count', () => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      reqMixedQueryMutationHeaderOn,
    );

    expect(mutationAtomicityContext.totalMutations).toEqual(
      reqMixedQueryMutationHeaderOn.body.totalMutations,
    );
  });
});

describe('unsupported', () => {
  test('query batching exception', () => {
    const unsupportedQueryBatching = (): void => {
      getMutationAtomicityContext(reqUnsupportedQueryBatching);
    };

    expect(unsupportedQueryBatching).toThrow(
      'AtomicMutationsPlugin does not support GraphQL query batching',
    );
  });
});
