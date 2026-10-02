import { defineConfig } from 'vitest/config';

// ESM, DOM-free Node environment for the pure simulation tests.
// Mock-canvas / DOM tests can opt into jsdom per-file via a
// `// @vitest-environment jsdom` docblock comment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
