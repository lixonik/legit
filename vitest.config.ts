import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Alias the `vscode` module to a tiny mock so model code that only needs
// EventEmitter can be unit-tested outside the extension host.
export default defineConfig({
  test: {
    alias: {
      vscode: fileURLToPath(new URL('./test/vscode-mock.ts', import.meta.url)),
    },
  },
});
