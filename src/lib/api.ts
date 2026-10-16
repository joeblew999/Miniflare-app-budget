// Typed API client, built from the shared contract. Talks to the Worker's RPC endpoint.
import type { RouterContractClient } from "@orpc/contract"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import type { Contract } from "@shared/contract"

const link = new RPCLink({
  origin: window.location.origin,
  url: "/api/rpc", // must match the Worker's RPCHandler prefix
})

export const client: RouterContractClient<Contract> = createORPCClient(link)

/** TanStack Query helpers: orpc.budget.get.queryOptions(), orpc.budget.save.mutationOptions(), keys… */
export const orpc = createTanstackQueryUtils(client)
