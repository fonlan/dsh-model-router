import { defineConfig } from 'vitest/config'

/**
 * Client-half tests import src/client/*, which pulls runtime values from
 * @deepseek-ai/dsh-client-ui-primitives — a package that ships CSS modules.
 * Node's ESM loader cannot load `.css`, so the package has to be inlined into
 * the Vite transform (which stubs CSS) instead of being externalized.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
})
