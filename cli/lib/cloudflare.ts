// Minimal Cloudflare REST client for the CLI (Workers, D1, Workers Builds, API tokens).
// Credentials come from the environment: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, from fnox
// (env setup on your machine, env lease in a cloud session) or from Workers Builds.
// CLOUDFLARE_API_BASE overrides the endpoint.
import { fail, run } from "./run.ts"

const BASE = process.env.CLOUDFLARE_API_BASE ?? "https://api.cloudflare.com/client/v4"

interface CfEnvelope<T> {
  success: boolean
  result: T
  errors: { code: number; message: string }[]
}

export class CloudflareError extends Error {
  readonly status: number
  readonly codes: number[]
  constructor(message: string, status: number, codes: number[]) {
    super(message)
    this.status = status
    this.codes = codes
  }
}

export function credentials(): { token: string; accountId: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !accountId)
    fail("No Cloudflare token here. On your machine, `npm run env:setup` stores one in fnox; in a cloud session, `npm run env:lease` gets one.")
  return { token, accountId }
}

/**
 * Run fn with Cloudflare credentials in the environment. Without them, run this same command again under the fnox
 * production profile, which has them. Workers Builds brings its own, so it never re-runs there.
 */
export function withCloudflare(fn: () => void | Promise<void>): void {
  if (!process.env.CLOUDFLARE_API_TOKEN && !process.env.BUDGET_CLI_FNOX && !process.env.WORKERS_CI) {
    run("node", [process.argv[1], ...process.argv.slice(2)], { secrets: { profile: "production" }, env: { BUDGET_CLI_FNOX: "1" } })
    return
  }
  Promise.resolve().then(fn).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
}

/** init.token calls as a token that isn't in the environment (a new or parent token); init.account fills :account then. */
export async function cf<T>(method: string, path: string, body?: unknown, init: { raw?: string; contentType?: string; token?: string; account?: string } = {}): Promise<T> {
  const { token, accountId } = init.token ? { token: init.token, accountId: init.account ?? "" } : credentials()
  const url = BASE + path.replace(":account", accountId)
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  let payload: string | undefined = init.raw
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    payload = JSON.stringify(body)
  } else if (init.contentType) {
    headers["content-type"] = init.contentType
  }
  const res = await fetch(url, { method, headers, body: payload })
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null
  if (!res.ok || !json?.success) {
    const errors = json?.errors ?? []
    throw new CloudflareError(
      `${method} ${path} failed (${res.status}): ${errors.map((e) => `${e.code} ${e.message}`).join("; ") || res.statusText}`,
      res.status,
      errors.map((e) => e.code),
    )
  }
  return json.result
}

/** Like cf(), but returns null for 404s and "not found" errors. */
export async function cfMaybe<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    return await cf<T>(method, path, body)
  } catch (e) {
    if (e instanceof CloudflareError && (e.status === 404 || e.codes.includes(12040) || e.codes.includes(10007))) return null
    throw e
  }
}

/** 32 random bytes, base64. Generated on this machine and sent straight to Cloudflare; never printed. */
export function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Workers Builds configuration, shared by worker setup and env push.
export interface EnvVar { is_secret: boolean; value: string | null }
export interface BuildSettings {
  deploy_command: string
  build_command: string
  root_directory?: string
  build_token_uuid?: string
  build_caching_enabled?: boolean
  environment_variables?: Record<string, EnvVar>
}
export interface BuildConfig { previews_enabled: boolean; production_settings: BuildSettings; previews_base_config?: BuildSettings }

/** The Worker's tag (Workers Builds calls it external_script_id), or null if the Worker doesn't exist yet. */
export async function scriptTag(name: string): Promise<string | null> {
  const scripts = await cf<{ id: string; tag: string }[]>("GET", "/accounts/:account/workers/scripts")
  return scripts.find((s) => s.id === name)?.tag ?? null
}

// API tokens (account-owned), used by env setup and env issue.
export interface TokenPolicy { effect: string; resources: Record<string, unknown>; permission_groups: { id: string; name?: string }[] }
export interface ApiToken { id: string; name: string; status?: string; expires_on?: string; policies: TokenPolicy[]; value?: string }

/** Cloudflare wants RFC 3339 without milliseconds. */
export const expiresIn = (ms: number) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z")
