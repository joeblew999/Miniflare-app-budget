// App shell: sign-in gate, then the budget loaded from (and saved to) the API.
// Offline, the last signed-in user is used, so the app still opens; sign-in is only shown when the
// server answers that there's no session.
import { useEffect, useSyncExternalStore } from "react"
import { onlineManager, useQueryClient } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import { BudgetEditor } from "@/components/budget-editor"
import { SignIn } from "@/components/sign-in"
import { Button } from "@/components/ui/button"
import { type SaveState, useBudget } from "@/hooks/use-budget"
import { authClient } from "@/lib/auth-client"
import { type KnownUser, forgetUser, lastUser } from "@/lib/storage"

export default function App() {
  const session = authClient.useSession()
  const sessionUser = session.data?.user
  const id = sessionUser?.id
  const label = sessionUser ? (sessionUser.isAnonymous ? "Guest" : sessionUser.email) : undefined
  useEffect(() => { if (id && label) lastUser.save({ id, label }) }, [id, label])

  if (id && label) return <BudgetScreen key={id} user={{ id, label }} />
  // No answer from the server (offline, or still checking): carry on as the last signed-in user.
  const known = session.isPending || session.error ? lastUser.load() : null
  if (known) return <BudgetScreen key={known.id} user={known} />
  if (session.isPending) return <Centered>Loading…</Centered>
  return <SignIn />
}

function BudgetScreen({ user }: { user: KnownUser }) {
  const queryClient = useQueryClient()
  const { initial, version, isLoading, loadError, save, state, retry } = useBudget(user.id)

  if (loadError) return <Centered>Couldn't load your budget. Check your connection and reload the page.</Centered>
  if (isLoading || !initial) return <Centered>Loading your budget…</Centered>

  async function signOut() {
    await authClient.signOut()
    forgetUser(user.id)
    queryClient.clear()
  }

  return (
    <BudgetEditor
      key={version}
      initial={initial}
      onChange={save}
      toolbar={
        <div className="flex items-center gap-2">
          <ConnectionMarker />
          <SaveStatus state={state} onRetry={retry} />
          <span className="hidden text-sm text-muted-foreground sm:inline" title={user.label}>{user.label}</span>
          <Button variant="outline" size="sm" onClick={signOut}><LogOut /> Sign out</Button>
        </div>
      }
    />
  )
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error")
    return <Button variant="ghost" size="sm" className="text-destructive" onClick={onRetry}>Not saved. Retry</Button>
  const text = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…", offline: "Saved on this device" }[state]
  return <span role="status" className="text-sm text-muted-foreground">{text}</span>
}

/** Always shows the connection: a small green dot online, an amber dot and "Offline" when not. */
function ConnectionMarker() {
  const online = useSyncExternalStore((onChange) => onlineManager.subscribe(onChange), () => onlineManager.isOnline())
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground" title={online ? "Online" : "Offline: edits are kept on this device and sync when you're back online"}>
      <span aria-hidden className={`size-2 rounded-full ${online ? "bg-primary" : "bg-amber-500"}`} />
      <span className={online ? "sr-only" : undefined}>{online ? "Online" : "Offline"}</span>
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center px-4 text-muted-foreground">{children}</div>
}
