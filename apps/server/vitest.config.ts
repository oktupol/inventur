import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exports show local times, as in the container (see the Dockerfile).
    env: { TZ: 'Europe/Berlin' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // Integration tests against a real Postgres (Testcontainers, needs Docker).
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
