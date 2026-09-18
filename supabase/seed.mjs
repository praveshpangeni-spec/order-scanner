// Seed the product catalog into Supabase.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node supabase/seed.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "products.seed.json"), "utf-8"));
const rows = seed.map((p) => ({
  id: p.code,
  name: p.name,
  code: p.code,
  unit: p.unit ?? null,
  category: p.category ?? null,
  price: p.price ?? null,
  aliases: [],
}));

const supabase = createClient(url, key);
const { error, count } = await supabase
  .from("products")
  .upsert(rows, { onConflict: "id", count: "exact" });
if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}
const { count: total } = await supabase
  .from("products")
  .select("*", { count: "exact", head: true });
console.log(`Seeded ${rows.length} products. Catalog now has ${total} rows.`);
