import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The artifact build (`npm run app:artifact`): the same React app and the same Worker, bundled into
// one self-contained HTML file. artifact/in-page-worker.ts loads first and answers /api/* in the page.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    {
      name: 'in-page-worker',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace(
          '<script type="module" src="/src/main.tsx"></script>',
          '<script type="module" src="/artifact/in-page-worker.ts"></script>\n    <script type="module" src="/src/main.tsx"></script>',
        ),
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      // sql.js's asm.js build: plain JavaScript, no WebAssembly, so it runs under strict page policies.
      'sql.js': path.resolve(__dirname, './node_modules/sql.js/dist/sql-asm.js'),
    },
  },
  build: { outDir: 'dist/artifact', emptyOutDir: true },
})
