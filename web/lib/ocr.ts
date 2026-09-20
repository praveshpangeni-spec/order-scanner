"use client";
import type { ExtractedItem, ExtractedHeader } from "@order/shared";

export interface ExtractResult {
  header: ExtractedHeader;
  items: ExtractedItem[];
}

export type OcrProgress = (info: { status: string; progress: number }) => void;

/** Downscale very large images to keep the upload small and OCR fast. */
async function prepImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 2200;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) =>
      canvas.toBlob((b) => res(b || file), "image/jpeg", 0.9)
    );
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
  if (!res.ok) throw new Error(data?.error || `OCR failed (${res.status})`);
  onProgress?.({ status: "done", progress: 1 });
  return { header: (data.header as ExtractedHeader) || {}, items: (data.items as ExtractedItem[]) || [] };
}

/** Extract from several images; concatenates items, keeps the first header found. */
export async function extractImages(
  files: Blob[],
  productNames: string[],
  onProgress?: (fileIndex: number, info: { status: string; progress: number }) => void
): Promise<ExtractResult> {
  const all: ExtractedItem[] = [];
  let header: ExtractedHeader = {};
  for (let i = 0; i < files.length; i++) {
    const r = await extractImage(files[i], productNames, (info) => onProgress?.(i, info));
    all.push(...r.items);
    if (!header.customer && !header.location) header = r.header;
  }
  return { header, items: all };
}
