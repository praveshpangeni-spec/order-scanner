"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product, DraftItem, MatchConfidence } from "@order/shared";
import { draftFromItems } from "@order/shared";
import { extractImages } from "@/lib/ocr";
import {
  getProducts,
  createOrder,
  LOCATIONS,
  isSupabaseConfigured,
} from "@/lib/db";

interface Row extends DraftItem {
  include: boolean;
}

const confColor: Record<MatchConfidence, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-orange-100 text-orange-700",
  none: "bg-slate-100 text-slate-500",
};

function money(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ScanFlow() {
  const [products, setProducts] = useState<Product[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [phase, setPhase] = useState<"input" | "ocr" | "review" | "saved">("input");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ i: number; pct: number } | null>(null);
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [location, setLocation] = useState(LOCATIONS[0]);
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProducts().then(setProducts).catch((e) => setError(String(e)));
  }, []);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  function onFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list);
    setFiles(arr);
    setPreviews(arr.map((f) => URL.createObjectURL(f)));
  }

  async function runScan() {
    if (files.length === 0) return;
    setError(null);
    setPhase("ocr");
    setProgress({ i: 0, pct: 0 });
    try {
      const items = await extractImages(
        files,
        products.map((p) => p.name),
        (i, info) => setProgress({ i, pct: Math.round(info.progress * 100) })
      );
      const draft = draftFromItems(items, products);
      setRows(
        draft.map((d) => ({
          ...d,
          include: d.product != null && d.confidence !== "none",
        }))
      );
      setPhase("review");
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase("input");
    }
  }

  function setRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function chooseProduct(id: string, productId: string) {
    const p = productId ? productById.get(productId) || null : null;
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const price = r.price != null ? r.price : p?.price ?? null;
        return {
          ...r,
          product: p,
          price,
          include: p != null,
          confidence: p ? "high" : "none",
        };
      })
    );
  }

  function addManualRow() {
    setRows((rs) => [
      ...rs,
      {
        id: "manual-" + Date.now() + Math.random().toString(36).slice(2),
        raw: "",
        product: null,
        candidates: [],
        confidence: "none",
        quantity: null,
        price: null,
        include: true,
      },
    ]);
  }

  const included = rows.filter((r) => r.include);
  const lineTotal = (r: Row) => (r.quantity ?? 0) * (r.price ?? 0);
  const total = included.reduce((s, r) => s + lineTotal(r), 0);
  const canSave =
    included.length > 0 && included.every((r) => r.product && (r.quantity ?? 0) > 0);

  async function save() {
    setError(null);
    try {
      await createOrder({
        reference: reference || null,
        customer: customer || null,
        location: location || null,
        note: note || null,
        image_count: files.length,
        items: included.map((r) => ({
          product_id: r.product?.id ?? null,
          product_name: r.product?.name ?? r.raw,
          product_code: r.product?.code ?? null,
          unit: r.product?.unit ?? null,
          quantity: r.quantity ?? 0,
          unit_price: r.price ?? 0,
          line_total: Math.round(lineTotal(r) * 100) / 100,
          raw_text: r.raw || null,
        })),
      });
      setSavedTotal(total);
      setSavedCount(included.length);
      setPhase("saved");
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  function reset() {
    setFiles([]);
    setPreviews([]);
    setRows([]);
    setPhase("input");
    setCustomer("");
    setReference("");
    setNote("");
  }

  return (
    <div className="space-y-5">
      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Running in <strong>local mode</strong> — data is saved in this browser only. Add
          Supabase keys in <code>.env.local</code> to sync across devices.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {phase === "saved" ? (
        <div className="card p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 text-lg font-semibold">Order saved</h2>
          <p className="mt-1 text-sm text-slate-600">
            {savedCount} items · Total {money(savedTotal)}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={reset}>
              Scan another
            </button>
            <Link href="/orders" className="btn-ghost">
              View orders
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Order details</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Location / Depot</span>
                <select
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Customer / Party</span>
                <input
                  className="input"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="e.g. Ramesh Medical"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Reference / Bill no.</span>
                <input
                  className="input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="optional"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Note</span>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Order images</h2>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
            <div className="flex flex-wrap gap-3">
              {previews.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="h-24 w-24 rounded-lg border border-slate-200 object-cover"
                />
              ))}
              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand hover:text-brand"
              >
                <span className="text-2xl">＋</span>
                Add photo
              </button>
            </div>
            {phase === "input" && (
              <button
                className="btn-primary mt-4"
                disabled={files.length === 0}
                onClick={runScan}
              >
                Scan {files.length > 0 ? `${files.length} image${files.length > 1 ? "s" : ""}` : ""}
              </button>
            )}
          </div>

          {phase === "ocr" && (
            <div className="card p-6 text-center text-sm text-slate-600">
              <div className="mx-auto mb-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${progress?.pct ?? 0}%` }}
                />
              </div>
              Reading image {(progress?.i ?? 0) + 1} of {files.length}… {progress?.pct ?? 0}%
              <p className="mt-1 text-xs text-slate-400">
                On-device OCR — the first run downloads the language model.
              </p>
            </div>
          )}

          {phase === "review" && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  Review &amp; confirm ({included.length} selected)
                </h2>
                <button
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                  onClick={addManualRow}
                >
                  ＋ Add line
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">
                    No lines detected. Add lines manually or try a clearer photo.
                  </p>
                )}
                {rows.map((r) => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-2 h-4 w-4 accent-teal-600"
                        checked={r.include}
                        onChange={(e) => setRow(r.id, { include: e.target.checked })}
                      />
                      <div className="min-w-0 flex-1">
                        {r.raw && (
                          <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                            <span className={`badge ${confColor[r.confidence]}`}>
                              {r.confidence}
                            </span>
                            <span className="truncate">“{r.raw}”</span>
                          </div>
                        )}
                        <div className="grid grid-cols-12 gap-2">
                          <select
                            className="input col-span-12 sm:col-span-6"
                            value={r.product?.id ?? ""}
                            onChange={(e) => chooseProduct(r.id, e.target.value)}
                          >
                            <option value="">— choose product —</option>
                            {sortedProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            className="input col-span-4 sm:col-span-2"
                            placeholder="Qty"
                            value={r.quantity ?? ""}
                            onChange={(e) =>
                              setRow(r.id, {
                                quantity: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input col-span-4 sm:col-span-2"
                            placeholder="Price"
                            value={r.price ?? ""}
                            onChange={(e) =>
                              setRow(r.id, {
                                price: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          />
                          <div className="col-span-4 flex items-center justify-end px-2 text-sm font-medium tabular-nums sm:col-span-2">
                            {money(lineTotal(r))}
                          </div>
                        </div>
                        {r.candidates.length > 1 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.candidates.slice(0, 3).map((c) => (
                              <button
                                key={c.product.id}
                                onClick={() => chooseProduct(r.id, c.product.id)}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-teal-100 hover:text-teal-700"
                              >
                                {c.product.name} · {(c.score * 100) | 0}%
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                        className="mt-1 text-slate-300 hover:text-red-500"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm text-slate-600">
                  Total{" "}
                  <span className="text-base font-semibold text-slate-900">
                    {money(total)}
                  </span>
                </div>
                <button className="btn-primary" disabled={!canSave} onClick={save}>
                  Confirm &amp; save
                </button>
              </div>
              {!canSave && included.length > 0 && (
                <p className="px-4 pb-3 text-xs text-amber-600">
                  Every selected line needs a product and a quantity greater than 0.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
