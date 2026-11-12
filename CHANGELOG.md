# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-11-13

### Added

- PostGraphile v5 support via `postgraphile-plugin-atomic-mutations/v5` (#2). A
  rolled back request carries `extensions.atomicMutations.rolledBack: true`.

### Changed

- Requires Node.js 22 or later.
- The v4 plugin imports `makeWrapResolversPlugin` from `graphile-utils`, which
  is now an optional peer dependency - Thanks
  [pranaypratyush](https://github.com/pranaypratyush) (#3).
- `MutationAtomicityHeaderValue` is a constant object with a matching type.
- v4: after a mutation fails, the mutations before it are rolled back right away
  and the remaining mutations are not executed. `MutationAtomicityContext` is
  `{ started, failed }`.

### Fixed

- v4: mutations skipped with `@skip` / `@include`, repeated without an alias, or
  selected through a root fragment no longer stop the rollback.
- v4: an operation name no longer fails on documents that also contain an
  anonymous operation.
- v4: a document with a single named mutation applies atomicity when the request
  has no operation name.

## [1.0.4] - 2020-06-01

### Fixed

- Fixed an error when operationName is set to `null` - Thanks
  [hansallis](https://github.com/hansallis).
- Fixed an error which was caused by Subscription websocket messages.
