import React, { forwardRef, useImperativeHandle, useCallback } from "react";

/**
 * OCR engine for mobile: posts the image to the hosted /api/ocr route
 * (Google Cloud Vision, key kept server-side). Same interface the Scan screen
 * used before, so nothing else changes.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://web-theta-wine-13.vercel.app";

export interface OcrEngineHandle {
  recognize: (dataUrl: string, onProgress?: (p: number) => void) => Promise<string>;
}

export const OcrEngine = forwardRef<OcrEngineHandle>((_props, ref) => {
  const recognize = useCallback(
    async (dataUrl: string, onProgress?: (p: number) => void) => {
      onProgress?.(0.3);
      const res = await fetch(`${API_BASE}/api/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `OCR failed (${res.status})`);
      onProgress?.(1);
      return (data.text as string) || "";
    },
    []
  );

  useImperativeHandle(ref, () => ({ recognize }), [recognize]);
  return null;
});

OcrEngine.displayName = "OcrEngine";
