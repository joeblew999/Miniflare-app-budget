// Project facts the CLI needs, read from the repo itself (wrangler.jsonc, git remote).
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"
import { capture, fail, root } from "./run.ts"

export const WRANGLER = path.join(root, "wrangler.jsonc")
export const PREVIEW_MIGRATIONS = path.join(root, "wrangler.preview-migrations.jsonc")

/** Workers Builds settings. The commands are this repo's own CLI. */
export const BUILD = {
  productionBranch: "main",
  buildCommand: "npm run app:build",
  deployCommand: "npm run worker:ci",
  previewCommand: "npm run worker:preview",
}

interface WranglerConfig {
  name: string
  secrets?: { required?: string[] }
  previews?: { d1_databases?: { binding: string; database_name: string; database_id?: string }[] }
}

export function wrangler(): WranglerConfig {
  return parse(readFileSync(WRANGLER, "utf8")) as WranglerConfig
}

export function workerName(): string {
  return wrangler().name
}

export function requiredSecrets(): string[] {
  return wrangler().secrets?.required ?? []
}

export function stagingDatabase(): { name: string; id?: string } {
  const db = wrangler().previews?.d1_databases?.[0]
  if (!db) fail("wrangler.jsonc has no previews.d1_databases entry for the staging database.")
  return { name: db.database_name, id: db.database_id }
}

/** Point both config files at the staging database id. Returns true if a file changed. */
export function writeStagingDatabaseId(id: string): boolean {
  let changed = false
  const edit = (file: string, jsonPath: (string | number)[]) => {
    const text = readFileSync(file, "utf8")
    const next = applyEdits(text, modify(text, jsonPath, id, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
    if (next !== text) { writeFileSync(file, next); changed = true }
  }
  edit(WRANGLER, ["previews", "d1_databases", 0, "database_id"])
  edit(PREVIEW_MIGRATIONS, ["d1_databases", 0, "database_id"])
  return changed
}

/** GitHub owner/repo from the origin remote, plus the numeric ids Workers Builds needs. */
export async function githubRepo(): Promise<{ owner: string; ownerId: string; repo: string; repoId: string }> {
  const url = capture("git", ["remote", "get-url", "origin"]).trim()
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i)
  if (!m) fail(`The origin remote (${url}) is not a GitHub repository.`)
  const [, owner, repo] = m
  let data: { id: number; name: string; owner: { id: number; login: string } }
  try {
    data = JSON.parse(capture("gh", ["api", `repos/${owner}/${repo}`]))
  } catch {
    const headers: Record<string, string> = { accept: "application/vnd.github+json" }
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
    if (!res.ok) fail(`Couldn't read ${owner}/${repo} from GitHub (${res.status}). Log in with \`gh auth login\` or set GITHUB_TOKEN.`)
    data = await res.json() as typeof data
  }
  return { owner: data.owner.login, ownerId: String(data.owner.id), repo: data.name, repoId: String(data.id) }
}
