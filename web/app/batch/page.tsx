"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product } from "@order/shared";
import { draftFromItems, priceFor } from "@order/shared";
import { extractBatch, getUsage, type ScanUsage } from "@/lib/ocr";
import {
  getProducts,
  createOrder,
  upcomingMonths,
  getActiveMonth,
  setActiveMonth,
  LOCATIONS,
  PARTIES,
  isSupabaseConfigured,
} from "@/lib/db";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function matchParty(scanned: string, parties: string[]): string {
  const q = norm(scanned || "");
  if (!q) return "";
  for (const p of parties) if (norm(p) === q) return p;
  for (const p of parties) if (norm(p).includes(q) || q.includes(norm(p))) return p;
  const first = q.split(" ")[0];
  for (const p of parties) if (norm(p).split(" ").includes(first)) return p;
  return "";
}
function matchLocation(scanned: string): string {
  const q = norm(scanned || "");
  if (!q) return "";
  return LOCATIONS.find((l) => norm(l) === q || q.includes(norm(l)) || norm(l).includes(q)) || "";
}

interface Line {
  key: string;
  product_id: string | null;
  quantity: number | null;
  raw: string;
  confidence: string;
}
interface Card {
  id: string;
  thumb: string;
  location: string;
  party: string;
  lines: Line[];
  include: boolean;
}

export default function BatchPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [phase, setPhase] = useState<"input" | "scanning" | "review" | "saved">("input");
  const [cards, setCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [usage, setUsage] = useState<ScanUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const months = useMemo(() => upcomingMonths(3), []);
  const [month, setMonth] = useState(months[0]);
  const [groupImages, setGroupImages] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProducts().then(setProducts).catch((e) => setError(String(e)));
    getUsage().then(setUsage).catch(() => {});
    const a = getActiveMonth();
    if (a && months.includes(a)) setMonth(a);
  }, [months]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    setFiles((p) => [...p, ...arr]);
    setPreviews((p) => [...p, ...arr.map((f) => URL.createObjectURL(f))]);
  }
  function removeFile(i: number) {
    setFiles((f) => f.filter((_, j) => j !== i));
    setPreviews((p) => p.filter((_, j) => j !== i));
  }

  function buildCards(results: { header: any; items: any[] }[]): Card[] {
    return results.map((r, i) => {
      const loc = matchLocation(r.header?.location) || LOCATIONS[0];
      const party = matchParty(r.header?.customer, PARTIES[loc] || []);
      const draft = draftFromItems(r.items || [], products, loc);
      const lines: Line[] = draft.map((d, k) => ({
        key: "l" + i + "-" + k,
        product_id: d.product?.id ?? null,
        quantity: d.quantity,
        raw: d.raw,
        confidence: d.confidence,
      }));
      const include = !!party && lines.some((l) => l.product_id && (l.quantity ?? 0) > 0);
      return { id: "c" + i, thumb: previews[i], location: loc, party, lines, include };
    });
  }

  async function runScan() {
    if (files.length === 0) return;
    setError(null);
    setPhase("scanning");
    setProgress({ done: 0, total: files.length });
    try {
      const { results, usage: u } = await extractBatch(
        files,
        products.map((p) => p.name),
        groupImages ? 4 : 1,
        (done, total) => setProgress({ done, total })
      );
      if (u) setUsage(u);
      setCards(buildCards(results));
      setPhase("review");
    } catch (e: any) {
      if (e?.usage) setUsage(e.usage);
      if (Array.isArray(e?.partial) && e.partial.length) {
        setCards(buildCards(e.partial));
        setPhase("review");
      } else {
        setPhase("input");
      }
      setError(e?.message || String(e));
    }
  }

  function patchCard(id: string, p: Partial<Card>) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }
  function setLine(cid: string, key: string, p: Partial<Line>) {
    setCards((cs) =>
      cs.map((c) => (c.id === cid ? { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) } : c))
    );
  }
  function addLine(cid: string) {
    setCards((cs) =>
      cs.map((c) =>
        c.id === cid ? { ...c, lines: [...c.lines, { key: "l" + Date.now(), product_id: null, quantity: null, raw: "", confidence: "none" }] } : c
      )
    );
  }
  function removeLine(cid: string, key: string) {
    setCards((cs) => cs.map((c) => (c.id === cid ? { ...c, lines: c.lines.filter((l) => l.key !== key) } : c)));
  }

  const included = cards.filter((c) => c.include);
  const cardValid = (c: Card) => !!c.party && c.lines.some((l) => l.product_id && (l.quantity ?? 0) > 0);
  const canSave = included.length > 0 && included.every(cardValid);

  async function saveAll() {
    setError(null);
    let ok = 0;
    try {
      for (const c of included) {
        const valid = c.lines.filter((l) => l.product_id && (l.quantity ?? 0) > 0);
        await createOrder({
          month,
          location: c.location,
          customer: c.party,
          image_count: 1,
          items: valid.map((l) => {
            const p = productById.get(l.product_id!);
            const price = p ? priceFor(p, c.location) ?? 0 : 0;
            return {
              product_id: l.product_id,
              product_name: p?.name ?? "",
              product_code: p?.code ?? null,
              unit: p?.unit ?? null,
              quantity: l.quantity ?? 0,
              unit_price: price,
              line_total: Math.round((l.quantity ?? 0) * price * 100) / 100,
              raw_text: l.raw || null,
            };
          }),
        });
        ok++;
      }
      setSavedCount(ok);
      setFiles([]);
      setPreviews([]);
      setCards([]);
      setPhase("saved");
    } catch (e: any) {
      setError(`Saved ${ok} of ${included.length}. ${e?.message || e}`);
    }
  }

  function reset() {
    setFiles([]);
    setPreviews([]);
    setCards([]);
    setPhase("input");
    setError(null);
  }

  const partyOptions = (loc: string, current: string) => {
    const list = PARTIES[loc] || [];
    return current && !list.includes(current) ? [current, ...list] : list;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Bulk scan</h1>
        <Link href="/" className="text-sm text-brand">Single scan →</Link>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — data is saved in this browser only.
        </div>
      )}
      {usage && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${usage.remaining <= 0 ? "border-red-200 bg-red-50 text-red-700" : usage.remaining <= 5 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600"}`}>
≈ Free scans used today: <strong>{usage.used}/{usage.limit}</strong>
          {groupImages ? " · grouping ~4 images per scan saves your quota" : " · one scan used per image"}
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {phase === "saved" ? (
        <div className="card p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 text-lg font-semibold">Saved {savedCount} orders to {month}</h2>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-primary" onClick={reset}>Scan more</button>
            <Link href="/orders" className="btn-ghost">View order book</Link>
          </div>
        </div>
      ) : phase === "review" ? (
        <>
          <div className="card p-3 text-sm">
            <span className="text-slate-600">Month: </span>
            <select className="input inline-block w-auto" value={month} onChange={(e) => { setMonth(e.target.value); setActiveMonth(e.target.value); }}>
              {months.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
            <span className="ml-3 text-slate-500">{included.length} of {cards.length} orders selected</span>
          </div>

          {cards.map((c) => (
            <div key={c.id} className={`card overflow-hidden ${c.include ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3 border-b border-slate-100 p-3">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-600" checked={c.include} onChange={(e) => patchCard(c.id, { include: e.target.checked })} />
                {c.thumb && <img src={c.thumb} alt="" className="h-14 w-14 rounded border border-slate-200 object-cover" />}
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-500">Depot</span>
                    <select className="input" value={c.location} onChange={(e) => patchCard(c.id, { location: e.target.value, party: "" })}>
                      {LOCATIONS.map((l) => (<option key={l}>{l}</option>))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-500">Party</span>
                    <select className="input" value={c.party} onChange={(e) => patchCard(c.id, { party: e.target.value })}>
                      <option value="">— select party —</option>
                      {partyOptions(c.location, c.party).map((p) => (<option key={p} value={p}>{p}</option>))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="space-y-2 p-3">
                {c.lines.map((l) => (
                  <div key={l.key} className="rounded-lg border border-slate-200 bg-white p-2">
                    <select className="input w-full" value={l.product_id ?? ""} onChange={(e) => setLine(c.id, l.key, { product_id: e.target.value || null })}>
                      <option value="">— choose product —</option>
                      {sortedProducts.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                    <div className="mt-2 flex items-center gap-2">
                      {l.raw && <span className="truncate text-xs text-slate-400">“{l.raw}”</span>}
                      <input type="number" min={0} className="input ml-auto w-20" placeholder="Qty" value={l.quantity ?? ""} onChange={(e) => setLine(c.id, l.key, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
                      <button className="text-slate-300 hover:text-red-500" onClick={() => removeLine(c.id, l.key)} title="Remove">✕</button>
                    </div>
                  </div>
                ))}
                <button className="text-xs font-medium text-brand" onClick={() => addLine(c.id)}>＋ Add line</button>
                {c.include && !cardValid(c) && (
                  <p className="text-xs text-amber-600">Needs a party and at least one product with quantity.</p>
                )}
              </div>
            </div>
          ))}

          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-slate-200 bg-white/95 py-3">
            <button className="btn-ghost" onClick={reset}>Cancel</button>
            <button className="btn-primary" disabled={!canSave} onClick={saveAll}>Save {included.length} orders</button>
          </div>
        </>
      ) : (
        <>
          <div className="card p-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Assign all scans to month</span>
              <select className="input w-auto" value={month} onChange={(e) => { setMonth(e.target.value); setActiveMonth(e.target.value); }}>
                {months.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={groupImages} onChange={(e) => setGroupImages(e.target.checked)} />
              Group images per request (uses fewer free scans, slightly less reliable)
            </label>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Order photos — one per party</h2>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                  <button onClick={() => removeFile(i)} className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-white">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => fileRef.current?.click()}>⬆ Upload images</button>
              <button className="btn-ghost" onClick={() => cameraRef.current?.click()}>📷 Take photo</button>
            </div>
            {files.length > 0 && (
              <button className="btn-primary mt-4 w-full sm:w-auto" onClick={runScan}>
                Scan {files.length} order{files.length > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {phase === "scanning" && (
            <div className="card p-6 text-center text-sm text-slate-600">
              <div className="mx-auto mb-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              Scanned {progress.done} of {progress.total} orders…
            </div>
          )}
        </>
      )}
    </div>
  );
}
