// Cloudflare Worker entry.
//   /api/auth/*  Better Auth (sign up, sign in, session cookies)
//   /api/rpc/*   oRPC RPC protocol, used by the React app
//   /api/*       the same contract as REST (OpenAPI); docs at /api/docs, spec at /api/spec.json
//   everything else: the React app's static assets
import { onError } from "@orpc/server"
import { RPCHandler } from "@orpc/server/fetch"
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema"
import { OpenAPIGenerator } from "@orpc/openapi"
import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins"
import { ZodToJsonSchemaConverter } from "@orpc/zod"
import { contract } from "@shared/contract"
import { createAuth, guestSignInAllowed } from "./auth"
import { createDb } from "./db"
import { type Context, router } from "./router"

const converters = [new ZodToJsonSchemaConverter()]

const rpc = new RPCHandler(router, { interceptors: [onError((error) => console.error(error))] })

const generator = new OpenAPIGenerator({ converters })
const rest = new OpenAPIHandler(router, {
  interceptors: [onError((error) => console.error(error))],
  plugins: [
    new SmartCoercionHandlerPlugin({ converters }),
    new OpenAPIReferenceHandlerPlugin({
      docsPath: "/docs",
      specPath: "/spec.json",
      spec: () => generator.generate(contract, {
        base: {
          info: { title: "Baht & Dollar Budget API", version: "1.0.0" },
          servers: [{ url: "/api" }],
        },
      }),
    }),
  ],
})

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request)
    if (url.pathname === "/api/health") return Response.json({ ok: true })

    const db = createDb(env.DB)
    const auth = createAuth(env, db, url)
    if (url.pathname.startsWith("/api/auth/")) return auth.handler(request)

    const context: Context = { headers: request.headers, db, auth, guestSignIn: guestSignInAllowed(env, url) }
    for (const [handler, prefix] of [[rpc, "/api/rpc"], [rest, "/api"]] as const) {
      const { matched, response } = await handler.handle(request, { prefix, context })
      if (matched) return response
    }
    return Response.json({ error: "Not found" }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
