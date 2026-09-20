// Shared domain types used by both the web (Next.js) and mobile (Expo) apps.

export interface Product {
  id: string;
  name: string;
  code?: string | null;
  unit?: string | null;
  category?: string | null;
  /** Default price (used when no per-location price applies). */
  price?: number | null;
  /** Per-depot price map, e.g. { Narayanghat: 80.19, Butwal: 80.19 }. */
  prices?: Record<string, number> | null;
  /** Extra names/spellings that should also match this product. */
  aliases?: string[];
}

/** A single raw line the parser pulled out of the OCR text. */
export interface ParsedLine {
  /** The original OCR line text. */
  raw: string;
  /** Text with the detected qty/price stripped out — used for product matching. */
  productText: string;
  quantity: number | null;
  price: number | null;
}

/** A product candidate for a parsed line, with a confidence score 0..1. */
export interface MatchCandidate {
  product: Product;
  score: number;
}

export type MatchConfidence = "high" | "medium" | "low" | "none";

/** One line of a draft order, shown to the user for confirmation. */
export interface DraftItem {
  id: string; // local id for list keys
  raw: string;
  /** Best matched product, or null if nothing matched. */
  product: Product | null;
  candidates: MatchCandidate[];
  confidence: MatchConfidence;
  quantity: number | null;
  price: number | null;
}

export interface Order {
  id: string;
  created_at: string;
  reference?: string | null;
  customer?: string | null;
  location?: string | null;
  note?: string | null;
  image_count: number;
  total: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_code?: string | null;
  unit?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  raw_text?: string | null;
}

/** The order header read from the image (for pre-filling the form). */
export interface ExtractedHeader {
  customer?: string;
  location?: string;
  date?: string;
}

/** A line item extracted from an order image by the vision model. */
export interface ExtractedItem {
  /** The order line exactly as written. */
  raw: string;
  /** Catalog product name (exact) if matched, else the product text as written. */
  product: string;
  /** True only when `product` is an exact catalog name. */
  in_catalog: boolean;
  /** Best-guess ordered quantity as a number. */
  quantity: number | null;
  /** Original quantity text, e.g. "170+22" or "1x3 (60ph)". */
  quantity_raw?: string;
  unit?: string;
}

/** Maps arbitrary spreadsheet columns to product fields when importing a list. */
export interface ProductColumnMap {
  name: string;
  code?: string;
  unit?: string;
  price?: string;
  aliases?: string; // comma/semicolon separated in the cell
}
