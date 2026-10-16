import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Plus, X, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  type Currency, type DraftBudget, type DraftLine, type Freq, type Kind, type Period,
  FREQ_LABEL, FROM_MONTH, PERIOD_WORD, START, convert, fmt, monthlyTHB,
} from "@shared/budget"

const BAR_COLORS = ["var(--chart-5)", "var(--chart-3)", "var(--chart-1)", "var(--chart-4)", "var(--chart-2)"]

interface BudgetEditorProps {
  initial: DraftBudget
  /** Called after every edit (not on first render), and when the live exchange rate changes. */
  onChange: (b: DraftBudget) => void
  /** Today's exchange rate, or null when it can't be fetched (offline): then the last one saved is used. */
  liveRate: { rate: number; date: string } | null
  /** Extra controls for the header, e.g. save status and account. */
  toolbar?: ReactNode
}

const rateDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

export function BudgetEditor({ initial, onChange, liveRate, toolbar }: BudgetEditorProps) {
  const [b, setB] = useState<DraftBudget>(initial)
  // The rate is always the live one. The budget keeps the last one, for when it can't be fetched (offline).
  const live = liveRate?.rate
  const rate = live ?? b.rate
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => {
    const newRate = live !== undefined && live !== b.rate
    if (b !== initial || newRate) onChangeRef.current(newRate ? { ...b, rate: live } : b) // not for the untouched start
  }, [b, initial, live])

  const f = FROM_MONTH[b.period]
  const toAUD = (thb: number) => convert(thb, "THB", "AUD", rate)
  const tagName = (id: string) => b.tags.find((t) => t.id === id)?.name ?? ""

  const monthly = useMemo(() => ({
    income: b.income.map((l) => monthlyTHB(l, rate)),
    expense: b.expense.map((l) => monthlyTHB(l, rate)),
  }), [b, rate])
  const inM = monthly.income.reduce((a, v) => a + v, 0)
  const outM = monthly.expense.reduce((a, v) => a + v, 0)
  const leftM = inM - outM
  const over = leftM < 0

  // ---- updates ----
  const patch = (fn: (d: DraftBudget) => void) =>
    setB((prev) => { const d = structuredClone(prev); fn(d); return d })
  const updateLine = (kind: Kind, id: string, fn: (l: DraftLine) => void) =>
    patch((d) => { const l = d[kind].find((x) => x.id === id); if (l) fn(l) })
  const addLine = (kind: Kind) =>
    patch((d) => { d[kind].push({ id: "l" + d.nextId++, name: "", amount: "", cur: "THB", freq: "month", tags: [] }) })
  const removeLine = (kind: Kind, id: string) =>
    patch((d) => { d[kind] = d[kind].filter((x) => x.id !== id) })
  const addTag = (name: string) =>
    patch((d) => { d.tags.push({ id: "t" + d.nextId++, name }) })
  const removeTag = (id: string) =>
    patch((d) => {
      d.tags = d.tags.filter((t) => t.id !== id)
      for (const l of [...d.income, ...d.expense]) l.tags = l.tags.filter((t) => t !== id)
    })

  // ---- totals by tag (selected period) ----
  const byTag = useMemo(() => {
    const m: Record<string, { i: number; e: number }> = { none: { i: 0, e: 0 } }
    b.tags.forEach((t) => (m[t.id] = { i: 0, e: 0 }))
    ;(["income", "expense"] as Kind[]).forEach((kind) =>
      b[kind].forEach((l, idx) => {
        const v = monthly[kind][idx] * f
        const ids = l.tags.filter((t) => m[t])
        ;(ids.length ? ids : ["none"]).forEach((t) => (m[t][kind === "income" ? "i" : "e"] += v))
      }),
    )
    return m
  }, [b, monthly, f])

  const pct = inM ? Math.round((outM / inM) * 100) : 0
  const barBase = Math.max(inM, outM) || 1

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      {toolbar && <div className="-mb-2 flex flex-wrap items-center justify-end gap-2 border-b pb-3">{toolbar}</div>}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Baht &amp; Dollar Budget</h1>
          <p className="text-muted-foreground">Income and costs in Thai baht or Australian dollars. Every total shows both.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <ThemeSwitcher />
          <div className="grid gap-0.5 px-1" aria-live="polite">
            <span className="text-sm text-muted-foreground">Exchange rate</span>
            <span id="rate" className="font-mono tabular-nums">฿{rate.toFixed(2)} per A$1</span>
            <span className="text-xs text-muted-foreground">
              {liveRate ? `ECB rate, ${rateDate(liveRate.date)}` : "Last known rate"}
            </span>
          </div>
          <Button variant="outline" onClick={() => setB(structuredClone(START) as DraftBudget)} title="Reset to starting figures">
            <RotateCcw /> Reset
          </Button>
        </div>
      </header>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardAction>
            <Tabs value={b.period} onValueChange={(v) => patch((d) => { d.period = v as Period })}>
              <TabsList>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="year">Year</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Income" thb={inM * f} aud={toAUD(inM * f)} />
            <Stat label="Spending" thb={outM * f} aud={toAUD(outM * f)} />
            <Stat label={over ? "Short by" : "Left over"} thb={Math.abs(leftM) * f} aud={toAUD(Math.abs(leftM) * f)}
              tone={over ? "bad" : "good"} />
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
            {monthly.expense.map((v, i) => (
              <span key={i} style={{ width: `${(v / barBase) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
            ))}
          </div>
          <p className={over ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {!inM ? "Add an income line to see how far it goes."
              : over ? `Spending is ${pct}% of income. You'd need ${fmt(-leftM * f, "THB")} (${fmt(toAUD(-leftM * f), "AUD")}) more ${PERIOD_WORD[b.period]}.`
              : `Spending is ${pct}% of income.`}
          </p>
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>Totals {PERIOD_WORD[b.period]}. Rename a tag by editing it. A line with two tags counts in both.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Income ฿</TableHead>
                <TableHead className="text-right">Income A$</TableHead>
                <TableHead className="text-right">Spending ฿</TableHead>
                <TableHead className="text-right">Spending A$</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono tabular-nums">
              {b.tags.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="min-w-40 font-sans">
                    <Input aria-label="Tag name" value={t.name}
                      onChange={(e) => patch((d) => { const x = d.tags.find((y) => y.id === t.id); if (x) x.name = e.target.value })} />
                  </TableCell>
                  <MoneyCells thb={byTag[t.id]?.i ?? 0} aud={toAUD(byTag[t.id]?.i ?? 0)} />
                  <MoneyCells thb={byTag[t.id]?.e ?? 0} aud={toAUD(byTag[t.id]?.e ?? 0)} />
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label={`Remove tag ${t.name}`} onClick={() => removeTag(t.id)}><X /></Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-sans italic text-muted-foreground">No tag</TableCell>
                <MoneyCells thb={byTag.none.i} aud={toAUD(byTag.none.i)} />
                <MoneyCells thb={byTag.none.e} aud={toAUD(byTag.none.e)} />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
          <AddTag onAdd={addTag} />
        </CardContent>
      </Card>

      <Ledger kind="income" title="Income" itemLabel="Where it comes from" addLabel="Add income"
        b={b} monthly={monthly.income} tagName={tagName} toAUD={toAUD}
        onChange={updateLine} onAdd={addLine} onRemove={removeLine} />
      <Ledger kind="expense" title="Expenses" itemLabel="What it's for" addLabel="Add expense"
        b={b} monthly={monthly.expense} tagName={tagName} toAUD={toAUD}
        onChange={updateLine} onAdd={addLine} onRemove={removeLine} />

      <p className="max-w-prose text-xs text-muted-foreground">
        Monthly figures use 365 days, 52 weeks and 4 quarters a year. The exchange rate is the European Central
        Bank's daily reference rate, updated each working day; a bank or Wise transfer lands a little lower. Your budget is saved to your account as you type.
      </p>
    </div>
  )
}

function Stat({ label, thb, aud, tone }: { label: string; thb: number; aud: number; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary dark:text-foreground" : ""
  return (
    <div className="grid gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-xl font-medium tabular-nums ${color}`}>{fmt(thb, "THB")}</span>
      <span className={`font-mono text-xl font-medium tabular-nums ${color}`}>{fmt(aud, "AUD")}</span>
    </div>
  )
}

function MoneyCells({ thb, aud }: { thb: number; aud: number }) {
  return (
    <>
      <TableCell className="text-right">{thb ? fmt(thb, "THB") : "–"}</TableCell>
      <TableCell className="text-right">{aud ? fmt(aud, "AUD") : "–"}</TableCell>
    </>
  )
}

function AddTag({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <form className="flex max-w-sm gap-2"
      onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) { onAdd(n); setName("") } }}>
      <Input placeholder="New tag name" aria-label="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit"><Plus /> Add tag</Button>
    </form>
  )
}

interface LedgerProps {
  kind: Kind
  title: string
  itemLabel: string
  addLabel: string
  b: DraftBudget
  monthly: number[]
  tagName: (id: string) => string
  toAUD: (thb: number) => number
  onChange: (kind: Kind, id: string, fn: (l: DraftLine) => void) => void
  onAdd: (kind: Kind) => void
  onRemove: (kind: Kind, id: string) => void
}

function Ledger({ kind, title, itemLabel, addLabel, b, monthly, tagName, toAUD, onChange, onAdd, onRemove }: LedgerProps) {
  const lines = b[kind]
  const total = monthly.reduce((a, v) => a + v, 0)
  const cols = "md:grid-cols-[minmax(0,1fr)_7rem_6rem_8rem_6rem_5.5rem_2.25rem]"
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="font-mono tabular-nums">
          Total {fmt(total, "THB")} · {fmt(toAUD(total), "AUD")} a month
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        <div className={`hidden gap-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground md:grid ${cols}`}>
          <span>{itemLabel}</span><span>Amount</span><span>Currency</span><span>How often</span>
          <span className="text-right">฿ / month</span><span className="text-right">A$ / month</span><span />
        </div>
        {lines.map((l, i) => {
          const unused = b.tags.filter((t) => !l.tags.includes(t.id))
          return (
            <div key={l.id} className="grid gap-2 border-t py-3">
              <div className={`grid grid-cols-2 items-center gap-2 ${cols}`}>
                <Input className="col-span-2 md:col-span-1" aria-label={itemLabel} value={l.name} placeholder={itemLabel}
                  onChange={(e) => onChange(kind, l.id, (x) => { x.name = e.target.value })} />
                <Input type="number" min="0" step="any" aria-label="Amount" className="font-mono tabular-nums" value={l.amount}
                  onChange={(e) => onChange(kind, l.id, (x) => { x.amount = e.target.value })} />
                <ToggleGroup type="single" variant="outline" value={l.cur} aria-label="Currency"
                  onValueChange={(v) => v && onChange(kind, l.id, (x) => { x.cur = v as Currency })}
                  className="[&_[data-state=on]]:bg-primary [&_[data-state=on]]:text-primary-foreground">
                  <ToggleGroupItem value="THB" aria-label="Thai baht">฿</ToggleGroupItem>
                  <ToggleGroupItem value="AUD" aria-label="Australian dollars">A$</ToggleGroupItem>
                </ToggleGroup>
                <Select value={l.freq} onValueChange={(v) => onChange(kind, l.id, (x) => { x.freq = v as Freq })}>
                  <SelectTrigger aria-label="How often" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQ_LABEL) as Freq[]).map((k) => <SelectItem key={k} value={k}>{FREQ_LABEL[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="font-mono text-sm tabular-nums md:text-right">{fmt(monthly[i], "THB")}</span>
                <span className="font-mono text-sm tabular-nums md:text-right">{fmt(toAUD(monthly[i]), "AUD")}</span>
                <Button variant="ghost" size="icon" aria-label="Remove line" className="justify-self-end"
                  onClick={() => onRemove(kind, l.id)}><X /></Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {l.tags.map((id) => (
                  <Badge key={id} variant="secondary" asChild>
                    <button type="button" aria-label={`Remove tag ${tagName(id)}`}
                      onClick={() => onChange(kind, l.id, (x) => { x.tags = x.tags.filter((t) => t !== id) })}>
                      {tagName(id)} <X />
                    </button>
                  </Badge>
                ))}
                {unused.length > 0 && (
                  <Select value="" onValueChange={(v) => onChange(kind, l.id, (x) => { x.tags.push(v) })}>
                    <SelectTrigger size="sm" aria-label="Add a tag" className="h-6 border-dashed text-xs text-muted-foreground">
                      <SelectValue placeholder="+ tag" />
                    </SelectTrigger>
                    <SelectContent>
                      {unused.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )
        })}
        <Button className="mt-2 justify-self-start" onClick={() => onAdd(kind)}><Plus /> {addLabel}</Button>
      </CardContent>
    </Card>
  )
}
