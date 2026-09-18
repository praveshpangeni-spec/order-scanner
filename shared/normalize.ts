// Text normalization helpers shared by the parser and matcher.

/** Uppercase, strip punctuation to spaces, collapse whitespace. Keeps digits. */
export function normalize(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compact form used for pack-size comparison: glue a number to a following
 * unit so "30 ML" and "30ML" compare equal, and drop spaces entirely.
 */
export function compact(input: string): string {
  return normalize(input)
    .replace(/(\d)\s+(GM|GMS|ML|MG|G|L|%|S)\b/g, "$1$2")
    .replace(/\s+/g, "");
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(" ") : [];
}

/** Character bigrams of a string (spaces removed) for Dice similarity. */
export function bigrams(input: string): string[] {
  const s = input.replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient over character bigrams. Robust to OCR typos. */
export function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 && B.length === 0) return a === b ? 1 : 0;
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) || 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

/** Extract a pack-size token like "30ML", "100GM", "5%" if present. */
export function packSize(input: string): string | null {
  const m = compact(input).match(/\d+(?:GM|GMS|ML|MG|G|L|%)?/);
  return m ? m[0] : null;
}
