import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Serves the Vercel function in `api/` during `npm run dev`, so local
 * development needs no Vercel CLI. The handler itself stays a plain Vercel
 * `(req, res)` default export and deploys unchanged.
 *
 * Vite's connect middleware hands over a raw Node IncomingMessage: no
 * `req.body`, no `res.status()`, no `res.json()`. Those are shimmed here to
 * match the Vercel runtime the same file sees in production.
 */
function vercelApiDev(env) {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        const route = req.url.split('?')[0].replace(/\/$/, '')
        const file = `.${route}.js`

        // Secrets stay server-side: read from .env.local into this process
        // only, never exposed to the client bundle.
        for (const [k, v] of Object.entries(env)) {
          if (!k.startsWith('VITE_') && process.env[k] === undefined) process.env[k] = v
        }

        res.status = (code) => { res.statusCode = code; return res }
        res.json = (obj) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
          return res
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const raw = Buffer.concat(chunks).toString('utf8')
          try {
            req.body = raw ? JSON.parse(raw) : {}
          } catch {
            return res.status(400).json({ error: 'Request body is not valid JSON.' })
          }
        }

        try {
          const mod = await server.ssrLoadModule(file)
          await mod.default(req, res)
        } catch (err) {
          server.ssrFixStacktrace(err)
          res.status(500).json({
            error: `Local API route ${route} failed.`,
            detail: err?.message || String(err),
          })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // '' prefix loads every var, including unprefixed secrets, for server use.
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), vercelApiDev(env)] }
})
