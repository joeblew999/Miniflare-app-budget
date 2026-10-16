// Loads the signed-in user's budget and saves edits back, debounced.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { type DraftBudget, toBudget } from "@shared/budget"
import { orpc } from "@/lib/api"
import { forgetLocalBudget, loadLocalBudget } from "@/lib/storage"

export type SaveState = "saved" | "pending" | "saving" | "error"

const DEBOUNCE_MS = 700

export function useBudget() {
  const query = useQuery({ ...orpc.budget.get.queryOptions(), staleTime: Infinity, refetchOnWindowFocus: false })
  const { mutate } = useMutation(orpc.budget.save.mutationOptions())
  const [state, setState] = useState<SaveState>("saved")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef<DraftBudget | null>(null)

  const flush = useCallback(() => {
    if (!latest.current) return
    const draft = latest.current
    latest.current = null
    setState("saving")
    mutate(toBudget(draft), {
      onSuccess: () => setState(latest.current ? "pending" : "saved"),
      onError: () => { latest.current ??= draft; setState("error") },
    })
  }, [mutate])

  const save = useCallback((draft: DraftBudget) => {
    latest.current = draft
    setState("pending")
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
  }, [flush])

  // First sign-in: bring over a budget kept by the old browser-only version
  const imported = useRef(false)
  const local = useMemo(() => (query.data?.isNew ? loadLocalBudget() : null), [query.data])
  useEffect(() => {
    if (!local || imported.current) return
    imported.current = true
    mutate(toBudget(local), { onSuccess: forgetLocalBudget })
  }, [local, mutate])

  // Save anything pending when the tab is hidden or closed
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") { clearTimeout(timer.current); flush() } }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [flush])

  const initial: DraftBudget | undefined = local ?? query.data?.budget
  return { initial, isLoading: query.isPending, loadError: query.error, save, state, retry: flush }
}
