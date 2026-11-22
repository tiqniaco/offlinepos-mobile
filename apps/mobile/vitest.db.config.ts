import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Database integration tests: the real schema + migrations on SQLite (libsql) in Node.
 * They exercise the same domain services the app uses (driver-agnostic `Db` type).
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.db.test.ts'],
    setupFiles: ['./src/test/db-setup.ts'],
    testTimeout: 60_000,
  },
});
