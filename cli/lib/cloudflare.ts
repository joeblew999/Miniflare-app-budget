// Minimal Cloudflare REST client for the CLI (Workers, D1, Workers Builds).
// Credentials come from the environment (fnox production profile):
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_BASE overrides the endpoint (used by the CLI's own tests).
import { fail } from "./run.ts"

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
    fail("No Cloudflare token for this machine. On your Mac: `npm run env:setup` stores one in fnox.")
  return { token, accountId }
}

export async function cf<T>(method: string, path: string, body?: unknown, init: { raw?: string; contentType?: string; token?: string } = {}): Promise<T> {
  // init.token checks a token that isn't stored yet (env setup); it only reaches paths without :account.
  const { token, accountId } = init.token ? { token: init.token, accountId: "" } : credentials()
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
