// The artifact build's oRPC link (replaces src/lib/link.ts): calls the real router in the page
// with createRouterClient, instead of sending HTTP to /api/rpc. Same contract, same procedures.
import type { ClientLink } from "@orpc/client"
import { createRouterClient } from "@orpc/server"
import { createContext } from "../worker/context"
import { router } from "../worker/router"
import { origin, persist, ready, requestHeaders } from "./in-page-worker"

type Call = (input: unknown, options: { signal?: AbortSignal }) => Promise<unknown>

export const link: ClientLink<object> = {
  async call(path, input, options) {
    const { env } = await ready
    const client = createRouterClient(router, {
      context: () => createContext(env, new URL("/api/rpc", origin), requestHeaders()),
    })
    const procedure = path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client) as Call
    const result = await procedure(input, { signal: options.signal })
    await persist()
    return result
  },
}
