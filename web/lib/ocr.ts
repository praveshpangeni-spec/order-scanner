"use client";

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

/** OCR one image via the server-side /api/ocr route (Google Cloud Vision). */
export async function ocrImage(file: Blob, onProgress?: OcrProgress): Promise<string> {
  onProgress?.({ status: "preparing", progress: 0.1 });
  const img = await prepImage(file);
  const dataUrl = await blobToDataUrl(img);
  onProgress?.({ status: "reading", progress: 0.4 });
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `OCR failed (${res.status})`);
  onProgress?.({ status: "done", progress: 1 });
  return data.text || "";
}

/** OCR several images and concatenate their text. */
export async function ocrImages(
  files: Blob[],
  onProgress?: (fileIndex: number, info: { status: string; progress: number }) => void
): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    parts.push(await ocrImage(files[i], (info) => onProgress?.(i, info)));
  }
  return parts.join("\n");
}
