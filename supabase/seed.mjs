// Replace the product catalog in Supabase with supabase/products.seed.json.
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
  prices: p.prices ?? null,
  aliases: p.aliases ?? [],
}));

const supabase = createClient(url, key);

// Replace the whole catalog so renamed/removed products don't linger.
await supabase.from("products").delete().neq("id", "");

let { error } = await supabase.from("products").insert(rows);
if (error && /prices/i.test(error.message)) {
  console.warn("No 'prices' column yet — inserting without per-depot prices.");
  console.warn("Run:  alter table products add column if not exists prices jsonb;  then reseed.");
  const stripped = rows.map(({ prices, ...r }) => r);
  ({ error } = await supabase.from("products").insert(stripped));
}
if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}
const { count } = await supabase.from("products").select("*", { count: "exact", head: true });
console.log(`Seeded ${rows.length} products. Catalog now has ${count} rows.`);
