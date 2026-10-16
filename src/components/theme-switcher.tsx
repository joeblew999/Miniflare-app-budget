import { useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACCENTS, type Mode, getAccent, getMode, setAccent, setMode } from "@/lib/theme"

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function ThemeSwitcher() {
  const [mode, setModeState] = useState<Mode>(getMode)
  const [accent, setAccentState] = useState(getAccent)
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={mode} aria-label="Colour mode"
        onValueChange={(v) => { if (v) { setMode(v as Mode); setModeState(v as Mode) } }}>
        <ToggleGroupItem value="light" aria-label="Light"><Sun /></ToggleGroupItem>
        <ToggleGroupItem value="dark" aria-label="Dark"><Moon /></ToggleGroupItem>
        <ToggleGroupItem value="system" aria-label="Match system"><Monitor /></ToggleGroupItem>
      </ToggleGroup>
      <Select value={accent} onValueChange={(v) => { setAccent(v); setAccentState(v) }}>
        <SelectTrigger size="sm" aria-label="Accent colour" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ACCENTS.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              <span className="size-3 rounded-full border" style={{ background: t.primary }} />
              {cap(t.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
