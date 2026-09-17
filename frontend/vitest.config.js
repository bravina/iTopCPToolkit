// frontend/vitest.config.js
//
// Vitest configuration for unit tests.
// Tests live in frontend/src/__tests__/ and are run with: npm test
// They run in a Node environment (no browser DOM needed for pure utility tests).

import { defineConfig } from 'vite'

export default defineConfig({
  // Components are rendered to static markup in a few tests; esbuild needs the
  // automatic JSX runtime for that, since the React plugin is not loaded here.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.js'],
    // Print a summary line per test file
    reporter: 'verbose',
  },
})
