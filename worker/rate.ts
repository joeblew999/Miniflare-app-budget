// Today's AUD to THB exchange rate: the European Central Bank's daily reference rate, via frankfurter.dev
// (free, no key). Cloudflare caches the answer for an hour, so most requests never leave the edge.
const SOURCE_URL = "https://api.frankfurter.dev/v1/latest?base=AUD&symbols=THB"
export const RATE_SOURCE = "European Central Bank, via frankfurter.dev"

export interface Rate { rate: number; date: string; source: string }

export async function fetchRate(): Promise<Rate> {
  const res = await fetch(SOURCE_URL, { cf: { cacheTtl: 3600, cacheEverything: true } })
  if (!res.ok) throw new Error(`rate source returned ${res.status}`)
  const body = await res.json() as { date?: string; rates?: { THB?: number } }
  const rate = body.rates?.THB
  if (!rate || !body.date) throw new Error(`unexpected rate response: ${JSON.stringify(body)}`)
  return { rate, date: body.date, source: RATE_SOURCE }
}
