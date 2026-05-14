import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // .envファイルを明示的に読み込む
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
          // プロキシ側でヘッダーを付与する
          headers: {
            'x-api-key': env.VITE_ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
        },
      },
    },
  }
})
