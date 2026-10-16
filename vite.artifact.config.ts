import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The artifact build (`npm run app:artifact`): the same React app and the same Worker, bundled into
// one self-contained HTML file. The oRPC client's link is swapped for artifact/link.ts, which calls the
// router in the page; artifact/in-page-worker.ts provides the database and answers Better Auth's requests.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
  ],
  resolve: {
    alias: [
      // The one swap: call the router in the page instead of over HTTP.
      { find: /^@\/lib\/link$/, replacement: path.resolve(__dirname, './artifact/link.ts') },
      { find: '@shared', replacement: path.resolve(__dirname, './shared') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // sql.js's asm.js build: plain JavaScript, no WebAssembly, so it runs under strict page policies.
      { find: 'sql.js', replacement: path.resolve(__dirname, './node_modules/sql.js/dist/sql-asm.js') },
    ],
  },
  build: { outDir: 'dist/artifact', emptyOutDir: true },
})
