import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { handleNodeApiRequest } from './server/handlers.ts'

function bffDevPlugin(): Plugin {
  const middleware = (req: any, res: any, next: any) => {
    if (req.url && (req.url.startsWith('/api') || req.url === '/mcp' || req.url.startsWith('/mcp?') || req.url.startsWith('/mcp/'))) {
      handleNodeApiRequest(req, res).catch((err) => {
        console.error('BFF Middleware Error:', err)
        next(err)
      })
    } else {
      next()
    }
  }

  return {
    name: 'reconcile-bff-dev-plugin',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), react(), bffDevPlugin()],
  build: {
    outDir: 'dist',
  },
})
