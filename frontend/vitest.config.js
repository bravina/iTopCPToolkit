// frontend/vitest.config.js
//
// Vitest configuration for unit tests.
// Tests live in frontend/src/__tests__/ and are run with: npm test
// They run in a Node environment (no browser DOM needed for pure utility tests).

import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.js'],
    // Print a summary line per test file
    reporter: 'verbose',
  },
})
