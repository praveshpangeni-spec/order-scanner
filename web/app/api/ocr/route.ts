import { NextRequest, NextResponse } from "next/server";
import {
  generate,
  parseJson,
  readUsage,
  bumpUsage,
  cors,
  hasKey,
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
    header: HEADER_SCHEMA,
    items: { type: "ARRAY", items: ITEM_SCHEMA },
  },
  required: ["items"],
};

function prompt(catalog: string[]): string {
  return `You extract a wholesale product order from an image (handwritten note, numbered list, or printed order form with a quantity column).
${headerRules()}
Return the lines under "items". ${lineRules()}

CATALOG (official product names):
${catalog.length ? catalog.join("\n") : "(none)"}`;
}

export async function GET() {
  return NextResponse.json(await readUsage(), { headers: cors() });
}

export async function POST(req: NextRequest) {
  if (!hasKey()) {
    return NextResponse.json({ error: "OCR is not configured (GEMINI_API_KEY missing)." }, { status: 500, headers: cors() });
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
  const m = image.match(/^data:([^;]+);base64,/);
  const mimeType = m ? m[1] : "image/jpeg";
  const idx = image.indexOf(",");
  const data = idx >= 0 ? image.slice(idx + 1) : image;

  try {
    const text = await generate(
      [{ text: prompt(products) }, { inline_data: { mime_type: mimeType, data } }],
      SCHEMA
    );
    const obj = parseJson(text) || {};
    await bumpUsage(1);
    const usage = await readUsage();
    return NextResponse.json(
      { header: obj.header || {}, items: Array.isArray(obj.items) ? obj.items : [], usage },
      { headers: cors() }
    );
  } catch (e: any) {
    const usage = await readUsage();
    const hint = "Couldn't read the image right now. Please try again in a minute.";
    return NextResponse.json(
      { error: hint, detail: e?.message || "failed", usage },
      { status: 503, headers: cors() }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}
