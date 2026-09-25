import { NextRequest, NextResponse } from "next/server";
import {
  generate,
  parseJson,
  readUsage,
  bumpUsage,
  cors,
  hasKey,
  GeminiError,
  lineRules,
  headerRules,
  ITEM_SCHEMA,
  HEADER_SCHEMA,
} from "@/lib/ocrServer";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    orders: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { header: HEADER_SCHEMA, items: { type: "ARRAY", items: ITEM_SCHEMA } },
        required: ["items"],
      },
    },
  },
  required: ["orders"],
};

function prompt(catalog: string[], n: number): string {
  return `You are given ${n} images. EACH image is a SEPARATE wholesale order from a (usually different) party.
Return "orders": an array with EXACTLY ${n} objects, one per image, in the SAME ORDER as the images. Do not merge images.
For each order object:
${headerRules()}
Put its lines under "items". ${lineRules()}

CATALOG (official product names):
${catalog.length ? catalog.join("\n") : "(none)"}`;
}

export async function POST(req: NextRequest) {
  if (!hasKey()) {
    return NextResponse.json({ error: "OCR is not configured (GEMINI_API_KEY missing)." }, { status: 500, headers: cors() });
  }
  let images: string[] = [];
  let products: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body.images)) images = body.images.filter((x: any) => typeof x === "string");
    if (Array.isArray(body.products)) products = body.products.filter((x: any) => typeof x === "string");
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: cors() });
  }
  if (images.length === 0) {
    return NextResponse.json({ error: "No images provided." }, { status: 400, headers: cors() });
  }

  const parts: any[] = [{ text: prompt(products, images.length) }];
  for (const img of images) {
    const m = img.match(/^data:([^;]+);base64,/);
    const mimeType = m ? m[1] : "image/jpeg";
    const idx = img.indexOf(",");
    parts.push({ inline_data: { mime_type: mimeType, data: idx >= 0 ? img.slice(idx + 1) : img } });
  }

  try {
    const text = await generate(parts, SCHEMA);
    const obj = parseJson(text) || {};
    const orders = Array.isArray(obj.orders) ? obj.orders : [];
    await bumpUsage(1); // one request regardless of image count
    const usage = await readUsage();
    return NextResponse.json({ orders, usage }, { headers: cors() });
  } catch (e: any) {
    const quota = e instanceof GeminiError && e.quotaHit;
    const usage = await readUsage();
    const hint = quota
      ? "Daily free-tier scan limit reached. It resets at the time shown, or enable Gemini API billing."
      : "The OCR service is busy. Please try again.";
    return NextResponse.json(
      { error: `${hint} (${e?.message || "failed"})`, usage: quota ? { ...usage, remaining: 0 } : usage },
      { status: quota ? 503 : 502, headers: cors() }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}
