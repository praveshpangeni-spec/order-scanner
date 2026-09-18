"use client";
import Tesseract from "tesseract.js";

export type OcrProgress = (info: { status: string; progress: number }) => void;

/** Downscale very large images so OCR stays fast on phones. */
async function prepImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) =>
      canvas.toBlob((b) => res(b || file), "image/png")
    );
  } catch {
    return file;
  }
}

/** Run on-device OCR (Tesseract, English) and return recognized text. */
export async function ocrImage(
  file: Blob,
  onProgress?: OcrProgress
): Promise<string> {
  const img = await prepImage(file);
  const { data } = await Tesseract.recognize(img, "eng", {
    logger: (m: any) => {
      if (onProgress && typeof m.progress === "number")
        onProgress({ status: m.status, progress: m.progress });
    },
  });
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
