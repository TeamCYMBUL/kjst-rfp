import { defineConfig } from 'vitest/config'

// Test-only config (the production build uses vite.config.ts and ignores this).
// Provides dummy Supabase env so importing modules that create the client at
// load time doesn't throw; no test makes a real network call.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
    },
  },
})
