// App shell: sign-in gate, then the budget loaded from (and saved to) the API.
import { useQueryClient } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import { BudgetEditor } from "@/components/budget-editor"
import { SignIn } from "@/components/sign-in"
import { Button } from "@/components/ui/button"
import { type SaveState, useBudget } from "@/hooks/use-budget"
import { authClient } from "@/lib/auth-client"

export default function App() {
  const session = authClient.useSession()
  if (session.isPending) return <Centered>Loading…</Centered>
  if (!session.data) return <SignIn />
  const user = session.data.user
  return <BudgetScreen email={user.isAnonymous ? "Guest" : user.email} />
}

function BudgetScreen({ email }: { email: string }) {
  const queryClient = useQueryClient()
  const { initial, isLoading, loadError, save, state, retry } = useBudget()

  if (loadError) return <Centered>Couldn't load your budget. Check your connection and reload the page.</Centered>
  if (isLoading || !initial) return <Centered>Loading your budget…</Centered>

  async function signOut() {
    await authClient.signOut()
    queryClient.clear()
  }

  return (
    <BudgetEditor
      initial={initial}
      onChange={save}
      toolbar={
        <div className="flex items-center gap-2">
          <SaveStatus state={state} onRetry={retry} />
          <span className="hidden text-sm text-muted-foreground sm:inline" title={email}>{email}</span>
          <Button variant="outline" size="sm" onClick={signOut}><LogOut /> Sign out</Button>
        </div>
      }
    />
  )
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error")
    return <Button variant="ghost" size="sm" className="text-destructive" onClick={onRetry}>Not saved. Retry</Button>
  const text = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…" }[state]
  return <span role="status" className="text-sm text-muted-foreground">{text}</span>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-svh place-items-center px-4 text-muted-foreground">{children}</div>
}
