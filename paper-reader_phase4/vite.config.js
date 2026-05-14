import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'anthropic-api',
        configureServer(server) {
          server.middlewares.use('/api/anthropic', async (req, res) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              try {
                const response = await fetch(
                  `https://api.anthropic.com${req.url}`,
                  {
                    method: req.method,
                    headers: {
                      'content-type': 'application/json',
                      'x-api-key': env.VITE_ANTHROPIC_API_KEY,
                      'anthropic-version': '2023-06-01',
                    },
                    body: body || undefined,
                  }
                );
                const data = await response.json();
                res.writeHead(response.status, {
                  'content-type': 'application/json',
                });
                res.end(JSON.stringify(data));
              } catch (err) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          });
        },
      },
    ],
  }
})
