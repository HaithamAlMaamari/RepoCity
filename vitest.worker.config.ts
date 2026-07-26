import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-07-26',
        compatibilityFlags: ['enable_request_signal'],
        serviceBindings: {
          ASSETS: async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`),
        },
      },
    }),
  ],
  test: {
    include: ['worker/**/*.workerd.test.ts'],
  },
});
