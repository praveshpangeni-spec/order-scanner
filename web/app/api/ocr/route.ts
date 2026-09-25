import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---- Daily free-tier scan counter (shared across all users via Supabase) ----
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;
const DAILY_LIMIT = Number(process.env.NEXT_PUBLIC_SCAN_DAILY_LIMIT || "20");

/** Google resets free-tier daily quota at midnight Pacific Time. */
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
async function readUsage() {
  let used = 0;
  if (sb) {
    const { data } = await sb.from("scan_usage").select("count").eq("day", ptDay()).maybeSingle();
    used = data?.count || 0;
  }
  return { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used), resetsAt: nextResetISO() };
}
async function bumpUsage() {
  if (!sb) return;
  const day = ptDay();
  const { data } = await sb.from("scan_usage").select("count").eq("day", day).maybeSingle();
  await sb.from("scan_usage").upsert({ day, count: (data?.count || 0) + 1 });
}

export async function GET() {
  return NextResponse.json(await readUsage(), { headers: cors() });
}

/**
 * Structured order extraction via the Gemini API (Google AI Studio) — free tier,
 * no billing card, and strong at reading handwriting AND printed order forms.
 * The key stays server-side. Returns { items: ExtractedItem[] }.
 *
 * Get a free key: https://aistudio.google.com/apikey  ->  set GEMINI_API_KEY.
 */

// Fallback list if model discovery fails. Each model has its own free-tier
// quota, so we try several in order (429/404 → next model).
const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Model names churn, so discover what THIS key can actually use (ListModels
// returns only accessible models — avoids "no longer available" 404s). Cached
// across warm invocations.
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
      if (/lite/i.test(n)) s -= 2; // prefer flash-lite: faster + higher free limit
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

const DEPOTS = ["Narayanghat", "Butwal", "Pokhara", "Birganj"];

function buildPrompt(catalog: string[]): string {
  const list = catalog.length ? catalog.join("\n") : "(none provided)";
  return `You extract a wholesale product order from an image. It may be a handwritten note, a numbered list, or a PRINTED order form / order book with a quantity column. Read the whole image carefully.

Also read the order HEADER and return it as "header":
- "customer": the party / shop / distributor name the order is from or to (e.g. "Rautoks Pharma", "Wings Medico"). Empty string if not visible.
- "location": if a city/depot is written, return the closest match from this list: ${DEPOTS.join(", ")} (note "Birgunj" = "Birganj"). Empty string if none.
- "date": the order date if written (as on the page), else empty string.

Return one object per ordered line under "items". For each line:
- "raw": the line exactly as written (product + quantity).
- "product": if the item clearly matches one of the CATALOG names below, output that EXACT catalog name (copy it verbatim). Otherwise output the product name as written on the order.
- "in_catalog": true ONLY when "product" is an exact catalog name.
- "quantity": the ordered quantity as an integer, using these rules:
    • "60 ph", "10 Pcs", "160 tb", "5 box" -> the number (60, 10, 160, 5).
    • "170+22" or "2880+720" (base + free-scheme) -> the FIRST/base number (170, 2880).
    • "1x3 (60ph)" or any explicit piece count in ph/pcs -> that piece count (60).
    • If no quantity is written for a row, SKIP that row entirely.
- "quantity_raw": the original quantity text exactly as written (e.g. "170+22", "1x3 (60ph)").
- "unit": one of ph, pcs, tb, box, strip if present, else "".

Only include real product order lines that have a quantity. Ignore titles, party/customer names, dates, addresses, phone numbers, stamps, signatures, column headers, and blank form rows.

CATALOG (official product names):
${list}`;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    header: {
      type: "OBJECT",
      properties: {
        customer: { type: "STRING" },
        location: { type: "STRING" },
        date: { type: "STRING" },
      },
    },
    items: {
      type: "ARRAY",
      items: {
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
      },
    },
  },
  required: ["items"],
};

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OCR is not configured (GEMINI_API_KEY missing)." },
      { status: 500, headers: cors() }
    );
  }

  let image: string | undefined;
  let products: string[] = [];
  try {
    const body = await req.json();
    image = body.image;
    if (Array.isArray(body.products)) products = body.products.filter((x: any) => typeof x === "string");
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: cors() });
  }
  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "No image provided." }, { status: 400, headers: cors() });
  }

  const commaIdx = image.indexOf(",");
  const mimeMatch = image.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const content = commaIdx >= 0 ? image.slice(commaIdx + 1) : image;

  const reqBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: buildPrompt(products) },
          { inline_data: { mime_type: mimeType, data: content } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let lastErr = "OCR request failed.";
  let quotaHit = false;

  const discovered = await discoverModels(key);
  const models = discovered.length ? discovered : MODELS;

  // Try each model in turn (separate free-tier quotas). Within a model, retry a
  // couple of times only for transient overload (503) — but on a quota error
  // (429) move straight to the next model instead of burning time.
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const OVERLOAD_TRIES = 3;
    let advanceModel = false;
    for (let attempt = 0; attempt < OVERLOAD_TRIES && !advanceModel; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: reqBody,
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          const text: string =
            data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
          const parsed = parseResult(text);
          await bumpUsage();
          const usage = await readUsage();
          return NextResponse.json({ ...parsed, usage, raw: text }, { headers: cors() });
        }
        const msg: string = data?.error?.message || `Gemini error ${resp.status}`;
        lastErr = msg;
        if (resp.status === 429 || /quota|rate limit/i.test(msg)) {
          quotaHit = true;
          advanceModel = true; // this model is rate-limited — try the next one
        } else if (resp.status === 404 || /not found|not supported/i.test(msg)) {
          advanceModel = true; // model unavailable — try the next one
        } else if (![500, 502, 503].includes(resp.status) && !/overload|unavailable|try again/i.test(msg)) {
          return NextResponse.json({ error: msg }, { status: 502, headers: cors() });
        }
      } catch (e: any) {
        lastErr = e?.message || lastErr;
      }
      if (!advanceModel && attempt < OVERLOAD_TRIES - 1)
        await sleep(Math.min(4000, 600 * 2 ** attempt) + Math.random() * 300);
    }
  }

  const hint = quotaHit
    ? "Daily free-tier scan limit reached. It resets at the time shown, or enable Gemini API billing for higher limits."
    : "The OCR service is busy. Please try again.";
  const usage = await readUsage();
  return NextResponse.json(
    { error: `${hint} (${lastErr})`, usage: quotaHit ? { ...usage, remaining: 0 } : usage },
    { status: 503, headers: cors() }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseResult(text: string): { header: any; items: any[] } {
  const empty = { header: {}, items: [] as any[] };
  if (!text) return empty;
  let t = text.trim();
  // Strip code fences if the model wrapped the JSON.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    const obj = JSON.parse(t);
    if (Array.isArray(obj)) return { header: {}, items: obj };
    return { header: obj?.header || {}, items: Array.isArray(obj?.items) ? obj.items : [] };
  } catch {
    return empty;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
