"use client";
import type { ExtractedItem, ExtractedHeader } from "@order/shared";

export interface ScanUsage {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface ExtractResult {
  header: ExtractedHeader;
  items: ExtractedItem[];
  usage?: ScanUsage;
}

/** Current shared daily scan usage (free-tier counter). */
export async function getUsage(): Promise<ScanUsage | null> {
  try {
    const res = await fetch("/api/ocr", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as ScanUsage;
  } catch {
    return null;
  }
}

export type OcrProgress = (info: { status: string; progress: number }) => void;

/**
 * Downscale + compress hard so the upload is small (matters a lot on slow mobile
 * data). ~1400px longest edge at JPEG 0.6 keeps text crisp for OCR while cutting
 * payload several-fold versus the original photo.
 */
async function prepImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 1400;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.6)
    );
    // Only use the re-encoded version if it's actually smaller.
    return out && out.size < file.size ? out : out || file;
  } catch {
    return file;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Extract header + structured order lines from one image via /api/ocr (Gemini). */
export async function extractImage(
  file: Blob,
  productNames: string[],
  onProgress?: OcrProgress
): Promise<ExtractResult> {
  onProgress?.({ status: "preparing", progress: 0.1 });
  const img = await prepImage(file);
  const dataUrl = await blobToDataUrl(img);
  onProgress?.({ status: "reading", progress: 0.4 });
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl, products: productNames }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.error || `OCR failed (${res.status})`);
    err.usage = data?.usage;
    throw err;
  }
  onProgress?.({ status: "done", progress: 1 });
  return {
    header: (data.header as ExtractedHeader) || {},
    items: (data.items as ExtractedItem[]) || [],
    usage: data.usage as ScanUsage | undefined,
  };
}

/** Extract from several images; concatenates items, keeps the first header found. */
export async function extractImages(
  files: Blob[],
  productNames: string[],
  onProgress?: (fileIndex: number, info: { status: string; progress: number }) => void
): Promise<ExtractResult> {
  const all: ExtractedItem[] = [];
  let header: ExtractedHeader = {};
  let usage: ScanUsage | undefined;
  for (let i = 0; i < files.length; i++) {
    const r = await extractImage(files[i], productNames, (info) => onProgress?.(i, info));
    all.push(...r.items);
    if (!header.customer && !header.location) header = r.header;
    if (r.usage) usage = r.usage;
  }
  return { header, items: all, usage };
}
