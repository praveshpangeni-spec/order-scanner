"use client";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "@order/shared";
import {
  getProducts,
  upsertProduct,
  deleteProduct,
  replaceProducts,
  LOCATIONS,
  isSupabaseConfigured,
} from "@/lib/db";

interface EditForm {
  name: string;
  price: string;
  unit: string;
  category: string;
  aliases: string;
}
const CATEGORIES = ["DERMA", "SKIN CARE", "HAIR CARE"];
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
import { readProductFile, rowsToProducts, ColumnMap } from "@/lib/xlsx";

const FIELDS: { key: keyof ColumnMap; label: string; required?: boolean }[] = [
  { key: "name", label: "Product name", required: true },
  { key: "price", label: "Price (MP)" },
  { key: "code", label: "Code" },
  { key: "unit", label: "Unit / size" },
  { key: "category", label: "Category" },
];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // import state
  const [importRows, setImportRows] = useState<Record<string, any>[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<ColumnMap>({ name: "" });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setProducts(await getProducts());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
    );
  }, [products, query]);

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { headers, rows } = await readProductFile(file);
      setHeaders(headers);
      setImportRows(rows);
      // best-guess column mapping
      const guess: ColumnMap = { name: headers[0] || "" };
      for (const h of headers) {
        const lh = h.toLowerCase();
        if (/name|product|item/.test(lh) && !guess.name) guess.name = h;
        if (/price|mrp|mp|rate/.test(lh)) guess.price = h;
        if (/code|sku/.test(lh)) guess.code = h;
        if (/unit|size|pack/.test(lh)) guess.unit = h;
        if (/categor|group|type/.test(lh)) guess.category = h;
      }
      setMap(guess);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function confirmImport(mode: "replace" | "merge") {
    if (!importRows) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = rowsToProducts(importRows, map);
      if (mode === "replace") {
        await replaceProducts(parsed);
      } else {
        for (const p of parsed) await upsertProduct(p);
      }
      setImportRows(null);
      setHeaders([]);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Remove this product?")) return;
    await deleteProduct(id);
    if (editId === id) setEditId(null);
    load();
  }

  // ---- edit / add ----
  const [editId, setEditId] = useState<string | null>(null); // product id, or "new"
  const [form, setForm] = useState<EditForm>({ name: "", price: "", unit: "", category: "", aliases: "" });

  function startEdit(p: Product) {
    setEditId(p.id);
    setForm({
      name: p.name,
      price: p.price != null ? String(p.price) : "",
      unit: p.unit || "",
      category: p.category || "",
      aliases: (p.aliases || []).join(", "),
    });
  }
  function startAdd() {
    setEditId("new");
    setForm({ name: "", price: "", unit: "", category: CATEGORIES[0], aliases: "" });
  }

  async function saveEdit() {
    const name = form.name.trim();
    if (!name) {
      setError("Product name is required.");
      return;
    }
    const priceNum = form.price.trim() === "" ? null : Number(form.price);
    if (priceNum != null && !Number.isFinite(priceNum)) {
      setError("Price must be a number.");
      return;
    }
    const existing = editId && editId !== "new" ? products.find((p) => p.id === editId) : null;
    const id = existing ? existing.id : slug(name);
    if (!existing && products.some((p) => p.id === id)) {
      setError("A product with this name already exists.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upsertProduct({
        id,
        code: existing?.code ?? id,
        name,
        unit: form.unit.trim() || null,
        category: form.category.trim() || null,
        price: priceNum,
        // Pricing is uniform across depots.
        prices: priceNum != null ? Object.fromEntries(LOCATIONS.map((l) => [l, priceNum])) : null,
        aliases: form.aliases
          .split(/[,;]/)
          .map((a) => a.trim())
          .filter(Boolean),
      });
      setEditId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const editor = (
    <div className="space-y-2 bg-slate-50/70 px-4 py-3">
      <label className="block text-xs">
        <span className="mb-1 block text-slate-500">Product name *</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Price (MP)</span>
          <input className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Unit / size</span>
          <input className="input" placeholder="30GM" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-slate-500">Category</span>
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">—</option>
            {Array.from(new Set([...CATEGORIES, form.category].filter(Boolean))).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs">
        <span className="mb-1 block text-slate-500">Other spellings (comma separated) — helps the scanner match handwriting</span>
        <input className="input" placeholder="e.g. lulican 30, lulican cream" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost !py-1.5 !px-3 text-xs" disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
        <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={busy} onClick={saveEdit}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-slate-500">{products.length} in catalog</p>
        </div>
        <label className="btn-primary cursor-pointer">
          ⬆ Import list
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => onImportFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — catalog is stored in this browser.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {importRows && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Map columns ({importRows.length} rows found)
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="mb-1 block text-slate-600">
                  {f.label}
                  {f.required && <span className="text-red-500"> *</span>}
                </span>
                <select
                  className="input"
                  value={(map[f.key] as string) || ""}
                  onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}
                >
                  <option value="">— none —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={!map.name || busy}
              onClick={() => confirmImport("replace")}
            >
              Replace catalog
            </button>
            <button
              className="btn-ghost"
              disabled={!map.name || busy}
              onClick={() => confirmImport("merge")}
            >
              Merge into catalog
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setImportRows(null);
                setHeaders([]);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search products…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-ghost shrink-0" onClick={startAdd}>＋ Add product</button>
      </div>

      {editId === "new" && (
        <div className="card overflow-hidden">
          <div className="px-4 pt-3 text-sm font-semibold text-slate-700">New product</div>
          {editor}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {filtered.map((p) => (
            <div key={p.id}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-slate-400">
                    {[p.category, p.unit, (p.aliases || []).length ? `${(p.aliases || []).length} spellings` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="text-sm tabular-nums text-slate-600">
                  {p.price != null ? p.price.toFixed(2) : "—"}
                </div>
                <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => (editId === p.id ? setEditId(null) : startEdit(p))}>
                  {editId === p.id ? "Close" : "Edit"}
                </button>
                <button
                  className="text-slate-300 hover:text-red-500"
                  onClick={() => onDelete(p.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
              {editId === p.id && editor}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No products match.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
