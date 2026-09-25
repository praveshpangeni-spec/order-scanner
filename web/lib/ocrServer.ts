// Server-only Gemini plumbing shared by /api/ocr (single order) and
// /api/ocr-batch (many orders in one request). Not a client module.
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

export const DAILY_LIMIT = Number(process.env.NEXT_PUBLIC_SCAN_DAILY_LIMIT || "20");
export function hasKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

const FALLBACK_MODELS = (process.env.GEMINI_MODELS ||
  "gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

let modelCache: { at: number; models: string[] } | null = null;
async function discoverModels(key: string): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
    );
    const d = await r.json();
    const names: string[] = (d?.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: any) => String(m.name || "").replace(/^models\//, ""))
      .filter((n: string) => /flash/i.test(n) && !/(vision|thinking|image|audio|tts|embedding|live)/i.test(n));
    const rank = (n: string) => {
      let s = 0;
      if (/lite/i.test(n)) s -= 2;
      if (/preview|exp/i.test(n)) s += 5;
      if (/latest/i.test(n)) s -= 1;
      return s;
    };
    const ordered = names.sort((a, b) => rank(a) - rank(b));
    if (ordered.length) modelCache = { at: Date.now(), models: ordered.slice(0, 6) };
    return ordered.slice(0, 6);
  } catch {
    return [];
  }
}

export function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function ptDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function nextResetISO(): string {
  const now = new Date();
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const mid = new Date(pt);
  mid.setHours(24, 0, 0, 0);
  return new Date(now.getTime() + (mid.getTime() - pt.getTime())).toISOString();
}
export async function readUsage() {
  let used = 0;
  if (sb) {
    const { data } = await sb.from("scan_usage").select("count").eq("day", ptDay()).maybeSingle();
    used = data?.count || 0;
  }
  return { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used), resetsAt: nextResetISO() };
}
/** Increment the shared daily counter by `by` (defaults to 1 request). */
export async function bumpUsage(by = 1) {
  if (!sb) return;
  const day = ptDay();
  const { data } = await sb.from("scan_usage").select("count").eq("day", day).maybeSingle();
  await sb.from("scan_usage").upsert({ day, count: (data?.count || 0) + by });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiError extends Error {
  quotaHit: boolean;
  constructor(message: string, quotaHit = false) {
    super(message);
    this.quotaHit = quotaHit;
  }
}

/** Run one structured generateContent across the model-fallback chain. Returns
 *  the raw text; throws GeminiError (with quotaHit) if all models fail. */
export async function generate(parts: any[], schema: any): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const discovered = await discoverModels(key);
  const models = discovered.length ? discovered : FALLBACK_MODELS;
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: schema },
  });

  let lastErr = "OCR request failed.";
  let quotaHit = false;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const TRIES = 2;
    let advance = false;
    for (let attempt = 0; attempt < TRIES && !advance; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
        }
        const msg: string = data?.error?.message || `Gemini error ${resp.status}`;
        lastErr = msg;
        if (resp.status === 429 || /quota|rate limit/i.test(msg)) {
          quotaHit = true;
          advance = true;
        } else if (resp.status === 404 || /not found|not supported/i.test(msg)) {
          advance = true;
        } else if (![500, 502, 503].includes(resp.status) && !/overload|unavailable|try again/i.test(msg)) {
          throw new GeminiError(msg);
        }
      } catch (e: any) {
        if (e instanceof GeminiError) throw e;
        lastErr = e?.message || lastErr;
      }
      if (!advance && attempt < TRIES - 1) await sleep(Math.min(2000, 500 * 2 ** attempt) + Math.random() * 250);
    }
  }
  throw new GeminiError(lastErr, quotaHit);
}

/** JSON parse with code-fence stripping. */
export function parseJson(text: string): any {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const DEPOTS = ["Narayanghat", "Butwal", "Pokhara", "Birganj"];

/** Instructions for reading ONE order's lines. Shared by both routes. */
export function lineRules(): string {
  return `For each ordered line return:
- "raw": the line exactly as written.
- "product": if it clearly matches a CATALOG name, output that EXACT catalog name; else the product as written.
- "in_catalog": true only when "product" is an exact catalog name.
- "quantity": ordered quantity as an integer. "60 ph"/"10 pcs"/"160 tb"->that number; "170+22"/"2880+720" (base+free)->the FIRST number; "1x3 (60ph)"->the explicit piece count (60). Skip rows with no quantity.
- "quantity_raw": the original quantity text.
- "unit": ph/pcs/tb/box/strip if present else "".
Ignore titles, dates, addresses, phone numbers, stamps, signatures, column headers and blank rows.`;
}

export function headerRules(): string {
  return `Also read the order HEADER:
- "customer": the party/shop/distributor name. "" if not visible.
- "location": closest match from: ${DEPOTS.join(", ")} ("Birgunj"="Birganj"). "" if none.
- "date": the order date if written, else "".`;
}

export const ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    raw: { type: "STRING" },
    product: { type: "STRING" },
    in_catalog: { type: "BOOLEAN" },
    quantity: { type: "NUMBER" },
    quantity_raw: { type: "STRING" },
    unit: { type: "STRING" },
  },
  required: ["raw", "product", "in_catalog", "quantity"],
};
export const HEADER_SCHEMA = {
  type: "OBJECT",
  properties: { customer: { type: "STRING" }, location: { type: "STRING" }, date: { type: "STRING" } },
};
