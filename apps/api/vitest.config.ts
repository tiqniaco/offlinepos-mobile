import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Test-only secrets. Never used outside tests.
export const TEST_LICENCE_SK = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            LICENCE_SIGNING_KEY: TEST_LICENCE_SK,
            ACCESS_TOKEN_SECRET: 'test-access-secret',
            OTP_PEPPER: 'test-pepper',
            BACKUP_WRAP_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
            OTP_PROVIDER: 'console',
          },
        },
      };
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
