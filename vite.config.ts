import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// A stable id for THIS deploy. On Vercel we use the git commit SHA; locally we
// fall back to the working-tree SHA, then a timestamp. The same value is baked
// into the app (__APP_VERSION__) AND written to /version.json, so a running
// client can poll version.json and detect when a newer deploy is live.
function resolveVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { /* not a git checkout */ }
  return String(Date.now())
}
const APP_VERSION = resolveVersion()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Emit /version.json (served no-store per vercel.json) so clients can
      // cheaply check whether a newer build has been deployed.
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    // Force fresh bundle on every deploy
    rollupOptions: {},
  },
})
