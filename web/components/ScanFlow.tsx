"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product, DraftItem, MatchConfidence, Month } from "@order/shared";
import { draftFromItems, priceFor } from "@order/shared";
import { extractImages, getUsage, type ScanUsage } from "@/lib/ocr";
import {
  getProducts,
  createOrder,
  listMonths,
  createMonth,
  getActiveMonth,
  setActiveMonth,
  LOCATIONS,
  PARTIES,
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

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Find the fixed party for a location that best matches a scanned name. */
function matchParty(scanned: string, parties: string[]): string {
  const q = norm(scanned);
  if (!q) return "";
  for (const p of parties) if (norm(p) === q) return p;
  for (const p of parties) if (norm(p).includes(q) || q.includes(norm(p))) return p;
  const first = q.split(" ")[0];
  for (const p of parties) if (norm(p).split(" ").includes(first)) return p;
  return "";
}

export default function ScanFlow() {
  const [products, setProducts] = useState<Product[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [phase, setPhase] = useState<"input" | "ocr" | "review" | "saved">("input");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ i: number; pct: number } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<ScanUsage | null>(null);

  const [months, setMonths] = useState<Month[]>([]);
  const [month, setMonth] = useState<string>("");
  const [newMonth, setNewMonth] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
  const [party, setParty] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProducts().then(setProducts).catch((e) => setError(String(e)));
    getUsage().then(setUsage).catch(() => {});
    listMonths()
      .then((ms) => {
        setMonths(ms);
        const active = getActiveMonth();
        if (active && ms.some((m) => m.name === active)) setMonth(active);
        else if (ms.length) setMonth(ms[0].name);
      })
      .catch((e) => setError(String(e)));
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
  const partyOptions = PARTIES[location] || [];

  async function addMonth() {
    const name = newMonth.trim();
    if (!name) return;
    try {
      await createMonth(name);
      setMonths(await listMonths());
      setMonth(name);
      setActiveMonth(name);
      setNewMonth("");
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

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
      const { header, items, usage: u } = await extractImages(
        files,
        products.map((p) => p.name),
        (i, info) => setProgress({ i, pct: Math.round(info.progress * 100) })
      );
      if (u) setUsage(u);
      let loc = location;
      if (header.location) {
        const m = LOCATIONS.find(
          (l) =>
            l.toLowerCase() === header.location!.toLowerCase() ||
            header.location!.toLowerCase().includes(l.toLowerCase())
        );
        if (m) {
          loc = m;
          setLocation(m);
        }
      }
      if (header.customer) {
        const p = matchParty(header.customer, PARTIES[loc] || []);
        if (p) setParty(p);
      }
      const draft = draftFromItems(items, products, loc);
      setRows(draft.map((d) => ({ ...d, include: d.product != null && d.confidence !== "none" })));
      setPhase("review");
    } catch (e: any) {
      if (e?.usage) setUsage(e.usage);
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
      rs.map((r) =>
        r.id === id
          ? { ...r, product: p, price: p ? priceFor(p, location) : r.price, include: p != null, confidence: p ? "high" : "none" }
          : r
      )
    );
  }
  function addManualRow() {
    setRows((rs) => [
      ...rs,
      { id: "m-" + Date.now() + Math.random().toString(36).slice(2), raw: "", product: null, candidates: [], confidence: "none", quantity: null, price: null, include: true },
    ]);
  }

  const included = rows.filter((r) => r.include);
  const canSave =
    !!month && !!party && included.length > 0 && included.every((r) => r.product && (r.quantity ?? 0) > 0);

  async function save() {
    setError(null);
    try {
      await createOrder({
        month,
        location,
        customer: party,
        image_count: files.length,
        items: included.map((r) => ({
          product_id: r.product?.id ?? null,
          product_name: r.product?.name ?? r.raw,
          product_code: r.product?.code ?? null,
          unit: r.product?.unit ?? null,
          quantity: r.quantity ?? 0,
          unit_price: r.product ? priceFor(r.product, location) ?? 0 : 0,
          line_total: (r.quantity ?? 0) * (r.product ? priceFor(r.product, location) ?? 0 : 0),
          raw_text: r.raw || null,
        })),
      });
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
    setParty("");
    setPhase("input");
  }

  return (
    <div className="space-y-5">
      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Running in <strong>local mode</strong> — data is saved in this browser only.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {usage && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
            usage.remaining <= 0
              ? "border-red-200 bg-red-50 text-red-700"
              : usage.remaining <= 5
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          <span>
            Free scans today: <strong>{usage.used}/{usage.limit}</strong>
            {usage.remaining > 0 ? ` · ${usage.remaining} left` : " · limit reached"}
          </span>
          <span>
            Resets{" "}
            {new Date(usage.resetsAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {/* Month bar — always visible */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Month</span>
          <select className="input min-w-[10rem]" value={month} onChange={(e) => { setMonth(e.target.value); setActiveMonth(e.target.value); }}>
            <option value="">— select month —</option>
            {months.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">New month</span>
            <input className="input" placeholder="e.g. Sep 2026" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
          </label>
          <button className="btn-ghost" onClick={addMonth} disabled={!newMonth.trim()}>Create</button>
        </div>
      </div>

      {phase === "saved" ? (
        <div className="card p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 text-lg font-semibold">Saved to {month}</h2>
          <p className="mt-1 text-sm text-slate-600">{savedCount} products · {party} ({location})</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={reset}>Scan another</button>
            <Link href="/orders" className="btn-ghost">View order book</Link>
          </div>
        </div>
      ) : (
        <>
          {!month && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Create or select a month above before scanning.
            </div>
          )}

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Party &amp; depot</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Location / Depot</span>
                <select className="input" value={location} onChange={(e) => { setLocation(e.target.value); setParty(""); }}>
                  {LOCATIONS.map((l) => (<option key={l}>{l}</option>))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Party</span>
                <select className="input" value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="">— select party —</option>
                  {partyOptions.map((p) => (<option key={p} value={p}>{p}</option>))}
                </select>
              </label>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Order images</h2>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            <div className="flex flex-wrap gap-3">
              {previews.map((src, i) => (<img key={i} src={src} alt="" className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />))}
              <button onClick={() => fileRef.current?.click()} className="flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand hover:text-brand">
                <span className="text-2xl">＋</span>Add photo
              </button>
            </div>
            {phase === "input" && (
              <button className="btn-primary mt-4" disabled={files.length === 0 || !month} onClick={runScan}>
                Scan {files.length > 0 ? `${files.length} image${files.length > 1 ? "s" : ""}` : ""}
              </button>
            )}
          </div>

          {phase === "ocr" && (
            <div className="card p-6 text-center text-sm text-slate-600">
              <div className="mx-auto mb-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-brand transition-all" style={{ width: `${progress?.pct ?? 0}%` }} />
              </div>
              Reading image {(progress?.i ?? 0) + 1} of {files.length}… {progress?.pct ?? 0}%
            </div>
          )}

          {phase === "review" && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  {party || "(no party)"} · {location} · {month} — {included.length} products
                </h2>
                <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={addManualRow}>＋ Add line</button>
              </div>
              <div className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">No lines detected. Add lines manually or retake the photo.</p>
                )}
                {rows.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <input type="checkbox" className="mt-2 h-4 w-4 accent-teal-600" checked={r.include} onChange={(e) => setRow(r.id, { include: e.target.checked })} />
                    <div className="min-w-0 flex-1">
                      {r.raw && (
                        <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                          <span className={`badge ${confColor[r.confidence]}`}>{r.confidence}</span>
                          <span className="truncate">“{r.raw}”</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <select className="input flex-1" value={r.product?.id ?? ""} onChange={(e) => chooseProduct(r.id, e.target.value)}>
                          <option value="">— choose product —</option>
                          {sortedProducts.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                        </select>
                        <input type="number" min={0} className="input w-24" placeholder="Qty" value={r.quantity ?? ""} onChange={(e) => setRow(r.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
                      </div>
                    </div>
                    <button onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="mt-1 text-slate-300 hover:text-red-500" title="Remove">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-4 py-3">
                <button className="btn-primary" disabled={!canSave} onClick={save}>Confirm &amp; save</button>
              </div>
              {!canSave && (
                <p className="px-4 pb-3 text-xs text-amber-600">
                  Needs a month, a party, and every selected line to have a product and quantity.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
