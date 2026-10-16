// Runtime theme: light/dark/system mode plus an accent from the generated shadcn themes.
// Accent values come from src/themes.css (npm run theme:gen); this file only picks one.
import themeData from "@/themes.json"

export type Mode = "light" | "dark" | "system"
export interface AccentTheme { name: string; preset: string; primary: string }

export const ACCENTS: AccentTheme[] = themeData.themes
export const DEFAULT_ACCENT: string = themeData.default

const MODE_KEY = "theme-mode"
const ACCENT_KEY = "theme-accent"

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export const getMode = (): Mode => (read(MODE_KEY) as Mode) || "system"
export const getAccent = (): string => {
  const a = read(ACCENT_KEY)
  return a && ACCENTS.some((t) => t.name === a) ? a : DEFAULT_ACCENT
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches

export function applyTheme(mode: Mode = getMode(), accent: string = getAccent()) {
  const el = document.documentElement
  el.classList.toggle("dark", mode === "dark" || (mode === "system" && systemDark()))
  // The default accent is already the base theme in index.css, so it needs no attribute
  if (accent === DEFAULT_ACCENT) el.removeAttribute("data-accent")
  else el.setAttribute("data-accent", accent)
}

export function setMode(mode: Mode) { write(MODE_KEY, mode); applyTheme(mode) }
export function setAccent(accent: string) { write(ACCENT_KEY, accent); applyTheme(undefined, accent) }

export function watchSystemMode() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme())
}
