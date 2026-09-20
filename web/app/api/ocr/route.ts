import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Server-side OCR via the Gemini API (Google AI Studio) — free tier, no
 * billing/credit card required, and strong at reading handwriting. The API key
 * stays on the server. Both web (same-origin) and mobile (cross-origin) POST here.
 *
 * Set GEMINI_API_KEY in the environment. Get a free key at
 * https://aistudio.google.com/apikey
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const PROMPT = `You are transcribing a handwritten wholesale product order (pharmaceutical / FMCG).
Output one line per order item, in the form: <product name as written> <quantity>
Rules:
- Keep the product name and any pack size exactly as written (e.g. "candid cream 20gm").
- Put the quantity (a number) at the END of each line.
- One item per line. Ignore headers, dates, customer names, totals, and page numbers.
- Output ONLY the order lines. No commentary, no bullet points, no extra text.`;

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OCR is not configured (GEMINI_API_KEY missing)." },
      { status: 500, headers: cors() }
    );
  }

  let image: string | undefined;
  try {
    ({ image } = await req.json());
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

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mimeType, data: content } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "Gemini API error." },
        { status: 502, headers: cors() }
      );
    }
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
    return NextResponse.json({ text }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "OCR request failed." },
      { status: 502, headers: cors() }
    );
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
