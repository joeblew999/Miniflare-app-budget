// Better Auth client. Same origin as the app; the Worker serves auth under /api/auth.
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({ basePath: "/api/auth" })
