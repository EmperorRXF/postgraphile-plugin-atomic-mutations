# postgraphile-plugin-atomic-mutations

![npm package](https://img.shields.io/npm/v/postgraphile-plugin-atomic-mutations?style=flat-square)
![license](https://img.shields.io/npm/l/postgraphile-plugin-atomic-mutations?style=flat-square)

This Postgraphile plugin allows you to enable mutation atomicity with GraphQL
requests containing multiple mutations.

It's ideal if you would like to have client request repeatability when at least
one mutation in the GraphQL request fails. This would guarantee that either all
the mutations in the request are `committed` when successful, or all are
`rolled back` if at least one is erroneous.

## Installing

```
yarn add postgraphile-plugin-atomic-mutations
```

```
npm install postgraphile-plugin-atomic-mutations
```

## Usage as Library

```js
import {
  AtomicMutationsPlugin,
  getMutationAtomicityContext,
} from 'postgraphile-plugin-atomic-mutations';

const app = express();

app.use(
  postgraphile(pgConfig, schema, {
    // Append the plugin to the array.
    appendPlugins: [AtomicMutationsPlugin],

    async additionalGraphQLContextFromRequest(req, res) {
      return {
        // Additional context needed by the plugin
        mutationAtomicityContext: getMutationAtomicityContext(req),
      };
    },
  }),
);

app.listen(5000);
```

```js
const getMutationAtomicityContext = (
  req,
  enablePluginByDefault = false,
): MutationAtomicityContext;
```

This function will extract the HTTP headers from the `req` object passed as the
1st argument to determine if the mutation atomicity behavior will be enabled or
not. See _Usage from Client_ for more details.

The 2nd argument `enablePluginByDefault` will determine plugin behavior when the
HTTP header is not set (defaults to `false`).

## Usage from Client

The plugin allows the client to decide when the mutation atomicity should be
applied per GraphQL request, using a custom HTTP header
`'X-Mutation-Atomicity'`, which can be set to either `'on'` or `'off'`.

```py
mutation MultipleMutationOperation {
  # Mutation 1 - Successful
  createTenant(input: {tenant: {name: "New Tenant"}}) {
    tenant {
      id
    }
  }

  # Mutation 2 - Erroneous
  updateTenant(input: {patch: {name: "Updated Tenant Name"}, id: "dd0f6631-3905-4cc0-bc75-6c7b1dcafa89"}) {
    tenant {
      name
    }
  }

  # Mutation 3 - Successful
  deleteTenant(input: {id: "761aa030-6965-4cfe-90cf-00d2dec41c61"}) {
    tenant {
      name
    }
  }
}
```

In the above example of a multiple mutation request, if we didn't use the plugin
at all, the outcome would be that Mutations `#1` & `#3` will be committed to the
database, while `#2` will be rolled back due to its hypothetical error. But if
the same request is sent again from the client, there will be new exceptions
caused by mutations `#1` & `#3` (possibly for duplicate key violation, and no
matching criteria).

Now instead if we use the plugin, and the same request is made with the
`'X-Mutation-Atomicity: on'` HTTP header set by the client, the Mutations `#1` &
`#3` will never be committed to the database since Mutation `#2` caused an
error, thus, guaranteeing atomicity for the set of Mutations. If the client
decides to re-run the same request again, the outcome will be the same.

## Limitations

- If there already exists plugins which are used in postgraphile options,
  `AtomicMutationsPlugin` must be appended after them - i.e.
  `appendPlugins: [SomePlugin, AnotherPlugin, AtomicMutationsPlugin]`.

- As with any transaction management mechanism, the individual mutations must
  not contain any explicit `commit` or `rollback` commands.

- Postgraphile v4 has an experimental feature
  [enableQueryBatching](https://www.graphile.org/postgraphile/v4-new-features/#graphql-query-batching)
  which is currently not supported by the plugin.

## Todo

- Improve tests to have more code coverage.

## Contributing

This project uses `yarn` as the package manager, so make sure that pre-requisite
is installed.

```
npm install -g yarn
```

Then `clone` & run `yarn`
