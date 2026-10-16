// How the oRPC client reaches the router: over HTTP to the Worker's RPC endpoint.
// The artifact build (vite.artifact.config.ts) swaps this file for artifact/link.ts, which calls the router in the page.
import { RPCLink } from "@orpc/client/fetch"

export const link = new RPCLink({
  origin: window.location.origin,
  url: "/api/rpc", // must match the Worker's RPCHandler prefix
})
