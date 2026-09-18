import { ParsedLine } from "./types";

const UNIT_QTY =
  /\b(\d+(?:\.\d+)?)\s*(pcs|pc|nos|no|units?|ctns?|boxe?s?|pkts?|packs?|doze?n?|strips?|tubes?)\b/i;
const PACK_SIZE = /\b\d+(?:\.\d+)?\s*(?:gms?|ml|mg|g|l|%)\b/gi;
const CURRENCY =
  /(?:rs\.?|npr|inr|₹|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|\b([0-9][0-9,]*\.[0-9]{1,2})\b/i;
const X_MULT = /(?:^|\s)(\d+)\s*[x×]\s|\s[x×]\s*(\d+)\b/i;
const LEADING_NUM = /^\s*(\d+)\s*[).:\-]\s+/;

function toNum(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** True if the line is worth treating as a product line (has letters). */
function hasLetters(s: string): boolean {
  return /[a-z]/i.test(s);
}

/** Parse a single OCR text line into {productText, quantity, price}. */
export function parseLine(raw: string): ParsedLine | null {
  let work = ` ${raw} `;
  let price: number | null = null;
  let quantity: number | null = null;

  // 1. Price: currency-tagged or a decimal number.
  const priceM = work.match(CURRENCY);
  if (priceM) {
    price = toNum(priceM[1] ?? priceM[2]);
    work = work.replace(priceM[0], " ");
  }

  // 2. Shield pack sizes so their numbers aren't read as quantity.
  const shields: string[] = [];
  work = work.replace(PACK_SIZE, (m) => {
    shields.push(m.trim());
    return ` \u0000${shields.length - 1}\u0000 `;
  });

  // 3. Quantity: explicit unit > x-multiplier > leading number > last bare int.
  const unitM = work.match(UNIT_QTY);
  if (unitM) {
    quantity = toNum(unitM[1]);
    work = work.replace(unitM[0], " ");
  } else {
    const xM = work.match(X_MULT);
    if (xM) {
      quantity = toNum(xM[1] ?? xM[2]);
      work = work.replace(xM[0], " ");
    } else {
      const leadM = work.match(LEADING_NUM);
      if (leadM) {
        quantity = toNum(leadM[1]);
        work = work.replace(leadM[0], " ");
      } else {
        const bare = work.match(/\b\d+\b/g);
        if (bare && bare.length) {
          quantity = toNum(bare[bare.length - 1]);
          // remove only the last occurrence
          const idx = work.lastIndexOf(bare[bare.length - 1]);
          work = work.slice(0, idx) + " " + work.slice(idx + bare[bare.length - 1].length);
        }
      }
    }
  }

  // 4. Restore pack sizes into the product text.
  work = work.replace(/\u0000(\d+)\u0000/g, (_m, i) => shields[Number(i)] ?? "");

  const productText = work.replace(/\s+/g, " ").trim();
  if (!hasLetters(productText)) return null;

  return { raw: raw.trim(), productText, quantity, price };
}

/** Split full OCR text into candidate product lines. */
export function parseOrderText(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2)
    .map(parseLine)
    .filter((l): l is ParsedLine => l !== null);
}
