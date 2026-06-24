import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/LVKOSP-JSX/',
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'react';
          if (id.includes('node_modules/@supabase/')) return 'supabase';
        },
      },
    },
  },
  server: {
    proxy: {
      '/supabase': {
        target: 'https://ilxmaeaxulvyqfopwgke.supabase.co',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/supabase/, ''),
        ws: true,
      },
    },
  },
})
