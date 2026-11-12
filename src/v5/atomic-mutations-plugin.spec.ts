import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { postgraphile } from 'postgraphile';
import type { PostGraphileInstance } from 'postgraphile';
import { makePgService } from 'postgraphile/adaptors/pg';
import { grafserv } from 'postgraphile/grafserv/node';
import { PostGraphileAmberPreset } from 'postgraphile/presets/amber';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MutationAtomicityHeaderName } from '../constants';
import { version } from '../version';
import { AtomicMutationsPlugin } from './atomic-mutations-plugin';

interface GraphQLResponse {
  errors?: unknown[];
  data?: unknown;
}

const isGraphQLResponse = (value: unknown): value is GraphQLResponse =>
  typeof value === 'object' && value !== null;

const createItems = (...names: string[]): string =>
  `mutation CreateItems {
    ${names
      .map(
        (name, index) =>
          `m${index}: createItem(input: { item: { name: "${name}" } }) { item { name tag } }`,
      )
      .join('\n')}
  }`;

it('reports the package version', async () => {
  const { default: packageJson } = await import('../../package.json', {
    with: { type: 'json' },
  });

  expect(AtomicMutationsPlugin.version).toBe(packageJson.version);
  expect(version).toBe(packageJson.version);
});

const connectionString = process.env.TEST_DATABASE_URL;
const describeWithDatabase = connectionString ? describe : describe.skip;

const schemaName = 'atomic_mutations_test_v5';

interface TestServer {
  instance: PostGraphileInstance;
  server: Server;
  url: string;
}

describeWithDatabase('AtomicMutationsPlugin (PostGraphile v5)', () => {
  let pool: Pool;
  let defaultOff: TestServer;
  let defaultOn: TestServer;

  const startServer = async (
    enablePluginByDefault: boolean,
  ): Promise<TestServer> => {
    const instance = postgraphile({
      extends: [PostGraphileAmberPreset],
      plugins: [AtomicMutationsPlugin],
      atomicMutations: { enablePluginByDefault },
      pgServices: [
        makePgService({
          pool,
          schemas: [schemaName],
          pgSettings: () => ({ 'app.tag': 'from-pg-settings' }),
        }),
      ],
    });
    const server = createServer();
    await instance.createServ(grafserv).addTo(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Test server is not listening on a TCP port');
    }
    return {
      instance,
      server,
      url: `http://localhost:${address.port}/graphql`,
    };
  };

  const stopServer = async ({
    instance,
    server,
  }: TestServer): Promise<void> => {
    await new Promise((resolve) => server.close(resolve));
    await instance.release();
  };

  const post = async (
    { url }: TestServer,
    body: { query: string; operationName?: string },
    headers: Record<string, string> = {},
  ): Promise<GraphQLResponse> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json();

    if (!isGraphQLResponse(json)) {
      throw new Error(`Unexpected response: ${JSON.stringify(json)}`);
    }
    return json;
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
        name text not null unique,
        tag text default current_setting('app.tag', true)
      );
    `);
    defaultOff = await startServer(false);
    defaultOn = await startServer(true);
  });

  afterEach(async () => {
    await pool.query(`truncate ${schemaName}.item`);
  });

  afterAll(async () => {
    await stopServer(defaultOff);
    await stopServer(defaultOn);
    await pool.query(`drop schema if exists ${schemaName} cascade`);
    await pool.end();
  });

  it('rolls back every mutation when one fails and the header is on', async () => {
    const result = await post(
      defaultOff,
      { query: createItems('a', 'a', 'b') },
      { [MutationAtomicityHeaderName]: 'on' },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.data).toEqual({
      m0: { item: { name: 'a', tag: 'from-pg-settings' } },
      m1: null,
      m2: { item: { name: 'b', tag: 'from-pg-settings' } },
    });
    expect(await itemNames()).toEqual([]);
  });

  it('commits every mutation when all succeed and the header is on', async () => {
    const result = await post(
      defaultOff,
      { query: createItems('a', 'b') },
      { [MutationAtomicityHeaderName]: 'ON' },
    );

    expect(result.errors).toBeUndefined();
    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('commits successful mutations when the header is off', async () => {
    const result = await post(
      defaultOn,
      { query: createItems('a', 'a', 'b') },
      { [MutationAtomicityHeaderName]: 'off' },
    );

    expect(result.errors).toHaveLength(1);
    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('commits successful mutations without the header by default', async () => {
    await post(defaultOff, { query: createItems('a', 'a', 'b') });

    expect(await itemNames()).toEqual(['a', 'b']);
  });

  it('rolls back without the header when enabled by default', async () => {
    await post(defaultOn, { query: createItems('a', 'a', 'b') });

    expect(await itemNames()).toEqual([]);
  });

  it('applies to the operation selected by operationName', async () => {
    const result = await post(defaultOn, {
      query: `query Items { allItems { totalCount } }\n${createItems('a', 'a')}`,
      operationName: 'CreateItems',
    });

    expect(result.errors).toHaveLength(1);
    expect(await itemNames()).toEqual([]);
  });

  it('leaves queries untouched', async () => {
    await pool.query(`insert into ${schemaName}.item (name) values ('a')`);

    const result = await post(defaultOn, {
      query: `{ allItems { totalCount } }`,
    });

    expect(result).toEqual({ data: { allItems: { totalCount: 1 } } });
  });
});
