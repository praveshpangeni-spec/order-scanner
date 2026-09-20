import { Product, DraftItem, ExtractedItem } from "./types";
import { parseOrderText } from "./parser";
import { matchProducts, confidenceOf } from "./matcher";
import { normalize } from "./normalize";

let counter = 0;
function uid(): string {
  counter += 1;
  return `d${Date.now().toString(36)}${counter}`;
}

/** Price for a product at a given depot, falling back to the default price. */
export function priceFor(product: Product, location?: string | null): number | null {
  if (location && product.prices) {
    // match on the leading depot word, e.g. "Narayanghat" in "Narayanghat ST"
    const key = Object.keys(product.prices).find(
      (k) => normalize(location).startsWith(normalize(k)) || normalize(k).startsWith(normalize(location))
    );
    if (key && product.prices[key] != null) return product.prices[key];
  }
  return product.price != null ? product.price : null;
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

/**
 * Turn structured items from the vision model into confirmable draft items.
 * Uses the model's exact catalog name when it flagged one, otherwise falls back
 * to fuzzy-matching so the user still gets suggestions to pick from.
 */
export function draftFromItems(
  items: ExtractedItem[],
  products: Product[],
  location?: string | null
): DraftItem[] {
  // Index by canonical name AND aliases/code so an exact hit on any known
  // spelling maps straight to the product.
  const byName = new Map<string, Product>();
  for (const p of products) {
    byName.set(normalize(p.name), p);
    if (p.code) byName.set(normalize(String(p.code)), p);
    for (const a of p.aliases || []) byName.set(normalize(a), p);
  }

  return items.map((item) => {
    const candidates = matchProducts(item.product || item.raw, products);
    // Auto-select only on an exact catalog/alias match (this also rescues cases
    // where the model returned the right name but mis-set in_catalog). For
    // everything else we leave the product unset and just offer suggestions,
    // so a non-catalog item is never silently mapped to the wrong product.
    const product = byName.get(normalize(item.product)) || null;
    const confidence = product
      ? "high"
      : candidates.length
      ? confidenceOf(candidates[0].score)
      : "none";

    const price = product ? priceFor(product, location) : null;
    return {
      id: uid(),
      raw: item.quantity_raw ? `${item.raw}` : item.raw,
      product,
      candidates,
      confidence,
      quantity: item.quantity,
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
