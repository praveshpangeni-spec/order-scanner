"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Product, Order, OrderItem } from "@order/shared";
import { priceFor } from "@order/shared";
import {
  getProducts,
  listOrders,
  getAllItems,
  monthOptions,
  updateOrderWithItems,
  deleteOrder,
  LOCATIONS,
  PARTIES,
  isSupabaseConfigured,
} from "@/lib/db";

interface Line {
  key: string;
  product_id: string | null;
  quantity: number | null;
}
interface Draft {
  month: string;
  location: string;
  customer: string;
  lines: Line[];
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function HistoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, o, it] = await Promise.all([getProducts(), listOrders(), getAllItems()]);
      setProducts(p);
      setOrders(o);
      setItems(it);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );
  const itemsOf = (id: string) => items.filter((i) => i.order_id === id);
  const months = useMemo(() => monthOptions(orders), [orders]);

  const shown = orders
    .filter((o) => (monthFilter ? o.month === monthFilter : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  function startEdit(o: Order) {
    setEditingId(o.id);
    setDraft({
      month: o.month || "",
      location: o.location || LOCATIONS[0],
      customer: o.customer || "",
      lines: itemsOf(o.id).map((it, i) => ({
        key: "l" + i,
        product_id: it.product_id,
        quantity: it.quantity,
      })),
    });
  }

  function patchDraft(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }
  function setLine(key: string, p: Partial<Line>) {
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) } : d));
  }
  function addLine() {
    setDraft((d) => (d ? { ...d, lines: [...d.lines, { key: "l" + Date.now(), product_id: null, quantity: null }] } : d));
  }
  function removeLine(key: string) {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.key !== key) } : d));
  }

  async function save() {
    if (!editingId || !draft) return;
    const valid = draft.lines.filter((l) => l.product_id && (l.quantity ?? 0) > 0);
    if (!draft.customer || !draft.month || valid.length === 0) {
      setError("Need a month, a party, and at least one line with product + quantity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateOrderWithItems(editingId, {
        month: draft.month,
        location: draft.location,
        customer: draft.customer,
        items: valid.map((l) => {
          const p = productById.get(l.product_id!);
          const price = p ? priceFor(p, draft.location) ?? 0 : 0;
          return {
            product_id: l.product_id,
            product_name: p?.name ?? "",
            product_code: p?.code ?? null,
            unit: p?.unit ?? null,
            quantity: l.quantity ?? 0,
            unit_price: price,
            line_total: Math.round((l.quantity ?? 0) * price * 100) / 100,
            raw_text: null,
          };
        }),
      });
      setEditingId(null);
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this order permanently?")) return;
    setBusy(true);
    try {
      await deleteOrder(id);
      if (editingId === id) {
        setEditingId(null);
        setDraft(null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const partyOptions = (loc: string, current: string) => {
    const list = PARTIES[loc] || [];
    return current && !list.includes(current) ? [current, ...list] : list;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">History</h1>
        <p className="text-sm text-slate-500">{orders.length} orders · tap Edit to change any one</p>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — this data lives in this browser only.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <select className="input max-w-[14rem]" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
        <option value="">All months</option>
        {months.map((m) => (<option key={m} value={m}>{m}</option>))}
      </select>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          No orders yet. <Link href="/" className="font-medium text-brand">Scan one →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((o) => {
            const its = itemsOf(o.id);
            const isEditing = editingId === o.id;
            return (
              <div key={o.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.customer || "(no party)"}</span>
                      {o.location && <span className="badge bg-teal-50 text-teal-700">{o.location}</span>}
                      {o.month && <span className="badge bg-slate-100 text-slate-600">{o.month}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {(o.created_at || "").slice(0, 16).replace("T", " ")} · {its.length} items · value {money(o.total || 0)}
                    </div>
                  </div>
                  {!isEditing && (
                    <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => startEdit(o)}>Edit</button>
                  )}
                </div>

                {isEditing && draft && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="text-xs">
                        <span className="mb-1 block text-slate-600">Month</span>
                        <select className="input" value={draft.month} onChange={(e) => patchDraft({ month: e.target.value })}>
                          <option value="">— month —</option>
                          {months.map((m) => (<option key={m} value={m}>{m}</option>))}
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-slate-600">Depot</span>
                        <select className="input" value={draft.location} onChange={(e) => patchDraft({ location: e.target.value, customer: "" })}>
                          {LOCATIONS.map((l) => (<option key={l}>{l}</option>))}
                        </select>
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-slate-600">Party</span>
                        <select className="input" value={draft.customer} onChange={(e) => patchDraft({ customer: e.target.value })}>
                          <option value="">— party —</option>
                          {partyOptions(draft.location, draft.customer).map((p) => (<option key={p} value={p}>{p}</option>))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 space-y-2">
                      {draft.lines.map((l) => (
                        <div key={l.key} className="flex items-center gap-2">
                          <select className="input flex-1" value={l.product_id ?? ""} onChange={(e) => setLine(l.key, { product_id: e.target.value || null })}>
                            <option value="">— choose product —</option>
                            {sortedProducts.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            className="input w-20"
                            placeholder="Qty"
                            value={l.quantity ?? ""}
                            onChange={(e) => setLine(l.key, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                          />
                          <button className="text-slate-300 hover:text-red-500" onClick={() => removeLine(l.key)} title="Remove">✕</button>
                        </div>
                      ))}
                      <button className="text-xs font-medium text-brand" onClick={addLine}>＋ Add line</button>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button className="text-xs text-red-500 hover:underline" disabled={busy} onClick={() => onDelete(o.id)}>
                        Delete order
                      </button>
                      <div className="flex gap-2">
                        <button className="btn-ghost !py-1.5 !px-3 text-xs" disabled={busy} onClick={() => { setEditingId(null); setDraft(null); }}>
                          Cancel
                        </button>
                        <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={busy} onClick={save}>
                          {busy ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
