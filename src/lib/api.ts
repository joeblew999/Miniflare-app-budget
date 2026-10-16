// Typed API client, built from the shared contract. Where calls go is decided by the link (src/lib/link.ts).
import type { RouterContractClient } from "@orpc/contract"
import { createORPCClient } from "@orpc/client"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import type { Contract } from "@shared/contract"
import { link } from "@/lib/link"

export const client: RouterContractClient<Contract> = createORPCClient(link)

/** TanStack Query helpers: orpc.budget.get.queryOptions(), orpc.budget.save.mutationOptions(), keys… */
export const orpc = createTanstackQueryUtils(client)
