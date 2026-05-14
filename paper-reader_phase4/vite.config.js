import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // /api/anthropic へのリクエストを
      // api.anthropic.com に転送する
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,         // オリジンを書き換える
        rewrite: (path) =>
          path.replace(/^\/api\/anthropic/, ''), // パスから /api/anthropic を除去
      },
    },
  },
})
