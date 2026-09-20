import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Server-side OCR via Google Cloud Vision (DOCUMENT_TEXT_DETECTION handles
 * handwriting). The API key stays on the server (never shipped to clients).
 * Both the web app (same-origin) and the mobile app (cross-origin) POST here.
 */
export async function POST(req: NextRequest) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OCR is not configured (GOOGLE_VISION_API_KEY missing)." },
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
  // Accept a data URL or a bare base64 string.
  const content = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;

  try {
    const resp = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              imageContext: { languageHints: ["en"] },
            },
          ],
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "Vision API error." },
        { status: 502, headers: cors() }
      );
    }
    const r = data?.responses?.[0];
    const text: string = r?.fullTextAnnotation?.text || "";
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
