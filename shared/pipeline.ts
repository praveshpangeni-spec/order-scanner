import { Product, DraftItem } from "./types";
import { parseOrderText } from "./parser";
import { matchProducts, confidenceOf } from "./matcher";

let counter = 0;
function uid(): string {
  counter += 1;
  return `d${Date.now().toString(36)}${counter}`;
}

/**
 * Turn raw OCR text + product catalog into confirmable draft items.
 * Price precedence: explicit price on the order line, else the catalog MP
 * of the matched product.
 */
export function buildDraft(text: string, products: Product[]): DraftItem[] {
  const lines = parseOrderText(text);
  return lines.map((line) => {
    const candidates = matchProducts(line.productText, products);
    const top = candidates[0] ?? null;
    const product = top ? top.product : null;
    const confidence = top ? confidenceOf(top.score) : "none";
    const price =
      line.price != null ? line.price : product?.price != null ? product.price : null;
    return {
      id: uid(),
      raw: line.raw,
      product,
      candidates,
      confidence,
      quantity: line.quantity,
      price,
    } as DraftItem;
  });
}

export function draftLineTotal(item: DraftItem): number {
  const q = item.quantity ?? 0;
  const p = item.price ?? 0;
  return Math.round(q * p * 100) / 100;
}

export function draftTotal(items: DraftItem[]): number {
  return Math.round(items.reduce((s, i) => s + draftLineTotal(i), 0) * 100) / 100;
}
