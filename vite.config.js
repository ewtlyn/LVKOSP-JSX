import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
