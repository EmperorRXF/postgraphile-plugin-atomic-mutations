import type { IncomingHttpHeaders } from 'node:http';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createPostGraphileSchema,
  execute,
  parse,
} from '../../test/v4/harness';
import { MutationAtomicityHeaderName } from '../constants';
import {
  AtomicMutationsPlugin,
  getMutationAtomicityContext,
} from './atomic-mutations-plugin';

const headerOn = { [MutationAtomicityHeaderName]: 'on' };
const headerOff = { [MutationAtomicityHeaderName]: 'off' };

const request = (
  body: unknown,
  headers: IncomingHttpHeaders = headerOn,
): { headers: IncomingHttpHeaders; body: unknown } => ({
  headers: { ...headers },
  body,
});

const queryAndMutation = `
  query ReadItems { someQuery }
  mutation WriteItems { __typename first second }
`;

describe('getMutationAtomicityContext', () => {
  it.each([
    ['a request without a body', undefined],
    ['a query sent as a raw string', '{ someQuery }'],
    ['an anonymous query', { query: 'query { someQuery }' }],
    ['a named query', { query: 'query Q { someQuery }', operationName: 'Q' }],
    [
      'the query operation of a document that also has a mutation',
      { query: queryAndMutation, operationName: 'ReadItems' },
    ],
    [
      'an operation name that is not in the document',
      { query: 'mutation M { first }', operationName: 'Other' },
    ],
  ])('returns undefined for %s', (_, body) => {
    expect(getMutationAtomicityContext(request(body))).toBeUndefined();
  });

  it.each([
    ['an anonymous mutation', { query: 'mutation { first }' }, 1],
    [
      'an anonymous mutation with a null operation name',
      { query: 'mutation { first second }', operationName: null },
      2,
    ],
    [
      'the only named mutation without an operation name',
      { query: 'mutation M { first }' },
      1,
    ],
    [
      'the mutation operation of a document that also has a query',
      { query: queryAndMutation, operationName: 'WriteItems' },
      2,
    ],
    ['a single-request batch', [{ query: 'mutation { first }' }], 1],
  ])('counts the mutations of %s', (_, body, totalMutations) => {
    expect(getMutationAtomicityContext(request(body))).toEqual({
      totalMutations,
      executedMutations: [],
    });
  });

  it('applies the header case-insensitively', () => {
    const req = request(
      { query: 'mutation { first }' },
      { [MutationAtomicityHeaderName]: 'ON' },
    );

    expect(getMutationAtomicityContext(req)).toBeDefined();
    expect(req.headers[MutationAtomicityHeaderName]).toBe('on');
  });

  it.each([
    ['header off, enabled by default', headerOff, true, false],
    ['header off, disabled by default', headerOff, false, false],
    ['no header, enabled by default', {}, true, true],
    ['no header, disabled by default', {}, false, false],
  ])(
    'follows the header and default (%s)',
    (_, headers, enablePluginByDefault, enabled) => {
      const req = request({ query: 'mutation { first }' }, headers);

      expect(
        getMutationAtomicityContext(req, enablePluginByDefault) !== undefined,
      ).toBe(enabled);
      expect(req.headers[MutationAtomicityHeaderName]).toBe(
        enabled ? 'on' : 'off',
      );
    },
  );

  it('rejects batched requests', () => {
    const body = [{ query: '{ a }' }, { query: '{ b }' }];

    expect(() => getMutationAtomicityContext(request(body))).toThrow(
      'AtomicMutationsPlugin does not support GraphQL query batching',
    );
  });
});

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDatabase = connectionString ? describe : describe.skip;

const schemaName = 'atomic_mutations_test_v4';

const createItems = (...names: string[]): string =>
  `mutation CreateItems {
    ${names
      .map(
        (name, index) =>
          `m${index}: createItem(input: { item: { name: "${name}" } }) { item { name } }`,
      )
      .join('\n')}
  }`;

describeWithDatabase('AtomicMutationsPlugin (PostGraphile v4)', () => {
  let pool: Pool;
  let schema: Awaited<ReturnType<typeof createPostGraphileSchema>>;

  /**
   * Runs the request the way PostGraphile v4's HTTP handler does: mutations
   * run inside one transaction that is always committed at the end.
   */
  const run = async (
    source: string,
    headers: IncomingHttpHeaders = {},
    enablePluginByDefault = false,
  ): Promise<{ errors?: readonly unknown[]; data?: unknown }> => {
    const mutationAtomicityContext = getMutationAtomicityContext(
      request({ query: source }, headers),
      enablePluginByDefault,
    );
    const pgClient = await pool.connect();
    try {
      await pgClient.query('begin');
      try {
        return await execute({
          schema,
          document: parse(source),
          contextValue: { pgClient, mutationAtomicityContext },
        });
      } finally {
        await pgClient.query('commit');
      }
    } finally {
      pgClient.release();
    }
  };

  const itemNames = async (): Promise<string[]> => {
    const { rows } = await pool.query<{ name: string }>(
      `select name from ${schemaName}.item order by name`,
    );
    return rows.map((row) => row.name);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await pool.query(`
      drop schema if exists ${schemaName} cascade;
      create schema ${schemaName};
      create table ${schemaName}.item (
        id serial primary key,
        name text not null unique
      );
    `);
    schema = await createPostGraphileSchema(pool, [schemaName], {
      appendPlugins: [AtomicMutationsPlugin],
    });
  });

  afterEach(async () => {
    await pool.query(`truncate ${schemaName}.item`);
  });

  afterAll(async () => {
    await pool.query(`drop schema if exists ${schemaName} cascade`);
    await pool.end();
  });

  it('rolls back every mutation when one fails and the header is on', async () => {
    const result = await run(createItems('a', 'a', 'b'), headerOn);

    expect(result.errors).toHaveLength(1);
    expect(result.data).toEqual({
      m0: { item: { name: 'a' } },
      m1: null,
      m2: { item: { name: 'b' } },
    });
    expect(await itemNames()).toEqual([]);
  });

  it('commits every mutation when all succeed and the header is on', async () => {
    const result = await run(createItems('a', 'b'), headerOn);

    expect(result.errors).toBeUndefined();
    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('commits successful mutations when the header is off', async () => {
    await run(createItems('a', 'a', 'b'), headerOff, true);

    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('commits successful mutations without the header by default', async () => {
    await run(createItems('a', 'a', 'b'));

    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('rolls back without the header when enabled by default', async () => {
    await run(createItems('a', 'a', 'b'), {}, true);

    expect(await itemNames()).toEqual([]);
  });

  it('leaves queries untouched', async () => {
    await pool.query(`insert into ${schemaName}.item (name) values ('a')`);

    const result = await run(`{ allItems { totalCount } }`, headerOn);

    expect(result).toEqual({ data: { allItems: { totalCount: 1 } } });
  });
});
