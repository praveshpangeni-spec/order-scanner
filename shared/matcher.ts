import { Product, MatchCandidate, MatchConfidence } from "./types";
import { normalize, compact, tokens, diceCoefficient, packSize } from "./normalize";

const STOPWORDS = new Set(["THE", "OF", "AND", "FOR", "WITH", "GM", "GMS", "ML", "MG"]);

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(tokens(a).filter((t) => !STOPWORDS.has(t)));
  const tb = new Set(tokens(b).filter((t) => !STOPWORDS.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** How well does the query's most distinctive (longest) token appear in target. */
function bestTokenHit(query: string, target: string): number {
  const qt = tokens(query).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const tt = tokens(target);
  if (qt.length === 0 || tt.length === 0) return 0;
  let best = 0;
  for (const q of qt) {
    for (const t of tt) {
      const d = diceCoefficient(q, t);
      if (d > best) best = d;
    }
  }
  return best;
}

/** Score one product name variant against a query string, 0..1. */
function scoreVariant(query: string, name: string): number {
  const dice = diceCoefficient(compact(query), compact(name));
  const jac = tokenJaccard(query, name);
  const tokenHit = bestTokenHit(query, name);
  let score = 0.5 * dice + 0.35 * jac + 0.15 * tokenHit;

  // Pack-size agreement is a strong signal for disambiguating variants
  // (e.g. CANDID POWDER 50 GM vs 100 GM).
  const pq = packSize(query);
  const pn = packSize(name);
  if (pq && pn) {
    if (pq === pn) score += 0.12;
    else score -= 0.18;
  }
  return Math.max(0, Math.min(1, score));
}

/** All name variants for a product (canonical name + aliases). */
function variants(p: Product): string[] {
  const v = [p.name];
  if (p.aliases) v.push(...p.aliases);
  if (p.code) v.push(String(p.code));
  return v;
}

export interface MatchOptions {
  /** Only return candidates at or above this score (default 0.28). */
  minScore?: number;
  /** Max candidates to return (default 5). */
  limit?: number;
}

/** Rank products for a single order line's product text. */
export function matchProducts(
  query: string,
  products: Product[],
  opts: MatchOptions = {}
): MatchCandidate[] {
  const minScore = opts.minScore ?? 0.28;
  const limit = opts.limit ?? 5;
  const q = query.trim();
  if (!q) return [];

  const scored: MatchCandidate[] = products.map((product) => {
    let best = 0;
    for (const name of variants(product)) {
      const s = scoreVariant(q, name);
      if (s > best) best = s;
    }
    // Exact code match short-circuits to near-certain.
    if (product.code && normalize(q).includes(normalize(String(product.code)))) {
      best = Math.max(best, 0.95);
    }
    return { product, score: best };
  });

  return scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function confidenceOf(score: number): MatchConfidence {
  if (score >= 0.72) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.3) return "low";
  return "none";
}
