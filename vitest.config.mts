import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The v4 stack is CommonJS, so the aliases point at the CommonJS entries to
// keep a single graphql instance.
const v4Module = (path: string): string =>
  fileURLToPath(new URL(`./test/v4/node_modules/${path}`, import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
    projects: [
      {
        resolve: {
          alias: [
            {
              find: /^graphile-utils$/,
              replacement: v4Module('graphile-utils/node8plus/index.js'),
            },
            { find: /^graphql$/, replacement: v4Module('graphql/index.js') },
          ],
        },
        test: { name: 'v4', include: ['src/v4/**/*.spec.ts'] },
      },
      {
        test: { name: 'v5', include: ['src/v5/**/*.spec.ts'] },
      },
    ],
  },
});
