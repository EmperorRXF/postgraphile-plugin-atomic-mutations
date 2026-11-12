// Resolves graphql and PostGraphile v4 from this workspace, so the v4 tests
// run on graphql 15 while the rest of the repository uses graphql 16.
export { execute, parse } from 'graphql';
export { createPostGraphileSchema } from 'postgraphile-core';
