// Cloudflare Worker entry. Serves /api/* (the oRPC router will mount here);
// all other requests fall through to the React app's static assets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/api/health") return Response.json({ ok: true })
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
