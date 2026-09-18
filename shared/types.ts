// Shared domain types used by both the web (Next.js) and mobile (Expo) apps.

export interface Product {
  id: string;
  name: string;
  code?: string | null;
  unit?: string | null;
  category?: string | null;
  price?: number | null;
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

/** Maps arbitrary spreadsheet columns to product fields when importing a list. */
export interface ProductColumnMap {
  name: string;
  code?: string;
  unit?: string;
  price?: string;
  aliases?: string; // comma/semicolon separated in the cell
}
