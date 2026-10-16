import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { orpc } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authClient } from "@/lib/auth-client"

type Mode = "sign-in" | "sign-up"

export function SignIn() {
  const [mode, setMode] = useState<Mode>("sign-in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const config = useQuery(orpc.config.get.queryOptions())

  async function continueAsGuest() {
    setBusy(true)
    setError(null)
    const res = await authClient.signIn.anonymous()
    setBusy(false)
    if (res.error) setError(res.error.message ?? "Guest sign-in didn't work. Try again.")
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = mode === "sign-up"
      ? await authClient.signUp.email({ name: name || email.split("@")[0], email, password })
      : await authClient.signIn.email({ email, password })
    setBusy(false)
    if (res.error) setError(res.error.message ?? "That didn't work. Check your details and try again.")
  }

  return (
    <div className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <div className="grid gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Baht &amp; Dollar Budget</h1>
        <p className="text-muted-foreground">Sign in to see your budget on any device.</p>
      </div>
      <Card>
        <CardHeader>
          <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setError(null) }}>
            <TabsList className="w-full">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="sign-up">Create account</TabsTrigger>
            </TabsList>
          </Tabs>
          <CardTitle className="sr-only">{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription>
            {mode === "sign-in" ? "Use the email and password you signed up with." : "Passwords need at least 8 characters."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            {mode === "sign-up" && (
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "One moment…" : mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
          {config.data?.guestSignIn && (
            <div className="mt-4 grid gap-2 border-t pt-4">
              <Button variant="outline" disabled={busy} onClick={continueAsGuest}>Continue as guest</Button>
              <p className="text-center text-xs text-muted-foreground">Test deployment: guest budgets are temporary.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
