import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
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
