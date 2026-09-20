import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * Structured order extraction via the Gemini API (Google AI Studio) — free tier,
 * no billing card, and strong at reading handwriting AND printed order forms.
 * The key stays server-side. Returns { items: ExtractedItem[] }.
 *
 * Get a free key: https://aistudio.google.com/apikey  ->  set GEMINI_API_KEY.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

function buildPrompt(catalog: string[]): string {
  const list = catalog.length ? catalog.join("\n") : "(none provided)";
  return `You extract a wholesale product order from an image. It may be a handwritten note, a numbered list, or a PRINTED order form / order book with a quantity column. Read the whole image carefully.

Return one object per ordered line. For each line:
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
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

  // The free tier sometimes returns 429/503 "overloaded" — retry with backoff.
  const MAX_TRIES = 4;
  let lastErr = "OCR request failed.";
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
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
        return NextResponse.json({ items: parseItems(text), raw: text }, { headers: cors() });
      }
      const msg: string = data?.error?.message || `Gemini error ${resp.status}`;
      const retriable =
        [429, 500, 502, 503].includes(resp.status) ||
        /overload|high demand|try again|unavailable|rate/i.test(msg);
      lastErr = msg;
      if (!retriable) {
        return NextResponse.json({ error: msg }, { status: 502, headers: cors() });
      }
    } catch (e: any) {
      lastErr = e?.message || lastErr;
    }
    if (attempt < MAX_TRIES - 1) await sleep(700 * (attempt + 1) + Math.random() * 300);
  }
  return NextResponse.json(
    { error: `The OCR model is busy right now. Please try again. (${lastErr})` },
    { status: 503, headers: cors() }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseItems(text: string): any[] {
  if (!text) return [];
  let t = text.trim();
  // Strip code fences if the model wrapped the JSON.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try {
    const obj = JSON.parse(t);
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj?.items)) return obj.items;
  } catch {
    /* fall through */
  }
  return [];
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
