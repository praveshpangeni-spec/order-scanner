import React, { forwardRef, useImperativeHandle, useCallback } from "react";
import type { ExtractedItem } from "@order/shared";

/**
 * OCR engine for mobile: posts the image + catalog to the hosted /api/ocr route
 * (Gemini, key kept server-side) and returns structured order line items.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://web-theta-wine-13.vercel.app";

export interface OcrEngineHandle {
  recognize: (
    dataUrl: string,
    productNames: string[],
    onProgress?: (p: number) => void
  ) => Promise<ExtractedItem[]>;
}

export const OcrEngine = forwardRef<OcrEngineHandle>((_props, ref) => {
  const recognize = useCallback(
    async (dataUrl: string, productNames: string[], onProgress?: (p: number) => void) => {
      onProgress?.(0.3);
      const res = await fetch(`${API_BASE}/api/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, products: productNames }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `OCR failed (${res.status})`);
      onProgress?.(1);
      return (data.items as ExtractedItem[]) || [];
    },
    []
  );

  useImperativeHandle(ref, () => ({ recognize }), [recognize]);
  return null;
});

OcrEngine.displayName = "OcrEngine";
