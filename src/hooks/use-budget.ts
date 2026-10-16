// Loads the signed-in user's budget and saves edits back, and keeps working offline:
//   - the last copy from the server is shown straight away, so the budget opens with no connection;
//   - every edit is kept on this device first (the outbox), then sent when there's a connection;
//   - the latest edit wins: the server refuses an edit older than its saved budget, and the app then loads that one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type DraftBudget, toBudget } from "@shared/budget"
import type { Budget } from "@shared/schema"
import { client, orpc } from "@/lib/api"
import { forgetLocalBudget, loadLocalBudget, outbox, serverCopy } from "@/lib/storage"

export type SaveState = "saved" | "pending" | "saving" | "offline" | "error"

const DEBOUNCE_MS = 700

/** The server's copy as the editor should get it. A new version remounts the editor with that budget. */
interface Loaded { budget: DraftBudget; version: number }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useBudget(userId: string) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ["budget", userId], [userId])
  // "always": a save made offline fails straight away and stays in the outbox, instead of waiting in memory.
  const { mutate } = useMutation({ ...orpc.budget.save.mutationOptions(), networkMode: "always" })

  // Shown straight away: the latest edit on this device, else the last copy from the server.
  const [start] = useState(() => outbox.load(userId)?.budget ?? serverCopy.load(userId)?.budget ?? null)
  // What the editor has now, to tell whether the server's copy is different.
  const current = useRef<Budget | DraftBudget | null>(start)

  const [state, setState] = useState<SaveState>(() =>
    !outbox.load(userId) ? "saved" : onlineManager.isOnline() ? "pending" : "offline")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sending = useRef(false)

  // Send the outbox to the server, if there's anything in it and a connection.
  const flushRef = useRef<() => void>(() => {})
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const pending = outbox.load(userId)
    if (!pending || sending.current) return
    if (!onlineManager.isOnline()) { setState("offline"); return }
    sending.current = true
    setState("saving")
    mutate({ ...pending.budget, editedAt: pending.editedAt }, {
      onSuccess: ({ savedAt, applied }) => {
        if (outbox.load(userId)?.editedAt === pending.editedAt) outbox.clear(userId) // unless edited meanwhile
        if (applied) serverCopy.save(userId, { budget: pending.budget, savedAt })
        else void queryClient.invalidateQueries({ queryKey }) // a newer save from another device: load it
      },
      onSettled: (_data, error) => {
        sending.current = false
        if (error) setState(onlineManager.isOnline() ? "error" : "offline")
        else if (outbox.load(userId)) { setState("pending"); timer.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS) }
        else setState("saved")
      },
    })
  }, [mutate, userId, queryClient, queryKey])
  useEffect(() => { flushRef.current = flush }, [flush])

  // Every edit goes to the outbox first, then to the server shortly after.
  const save = useCallback((draft: DraftBudget) => {
    current.current = draft
    outbox.save(userId, { budget: toBudget(draft), editedAt: new Date().toISOString() })
    setState(onlineManager.isOnline() ? "pending" : "offline")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), DEBOUNCE_MS)
  }, [userId])

  // Fetch the server's copy. If this device has an unsent edit, send that instead and keep showing it.
  // Offline, this waits (TanStack Query pauses it) and runs when the connection is back.
  const query = useQuery({
    queryKey,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<Loaded> => {
      const data = await client.budget.get(undefined, { signal })
      const version = queryClient.getQueryData<Loaded>(queryKey)?.version ?? 0
      const showing = (budget: DraftBudget): Loaded => {
        if (same(current.current, budget)) return { budget, version }
        current.current = budget
        return { budget, version: version + 1 }
      }
      const pending = outbox.load(userId)
      if (data.isNew && !pending) {
        const legacy = loadLocalBudget() // first sign-in: bring over a budget kept by the old browser-only version
        if (legacy) { forgetLocalBudget(); const loaded = showing(legacy); save(legacy); return loaded }
      }
      if (pending) {
        // Unsent edit on this device: send it. The server decides which is newer; if it refuses the edit
        // (a later save from another device), flush reloads the server's copy.
        flushRef.current()
        return { budget: pending.budget, version }
      }
      serverCopy.save(userId, { budget: data.budget, savedAt: data.savedAt })
      setState("saved")
      return showing(data.budget)
    },
  })

  // Back online: send what's waiting. Gone offline: say so if there's anything unsent.
  useEffect(() => onlineManager.subscribe((online) => {
    if (online) flushRef.current()
    else if (outbox.load(userId)) setState("offline")
  }), [userId])

  // Send anything pending when the tab is hidden or closed
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushRef.current() }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [])

  // What the editor shows: what was on this device, until the server's copy replaces it (version > 0).
  const loaded = query.data
  const initial = loaded && (loaded.version > 0 || !start) ? loaded.budget : start ?? undefined
  return {
    initial,
    version: loaded?.version ?? 0,
    isLoading: !initial && query.isPending,
    loadError: initial ? null : query.error,
    save,
    state,
    retry: flush,
  }
}
