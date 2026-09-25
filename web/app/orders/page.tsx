"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Product, Order, OrderItem, Month } from "@order/shared";
import { priceFor } from "@order/shared";
import {
  getProducts,
  listOrders,
  getAllItems,
  listMonths,
  LOCATIONS,
  PARTIES,
  isSupabaseConfigured,
} from "@/lib/db";
import { exportMatrixXlsx } from "@/lib/xlsx";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [month, setMonth] = useState("");
  const [selectedLocs, setSelectedLocs] = useState<string[]>([LOCATIONS[0]]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, o, it, ms] = await Promise.all([
          getProducts(),
          listOrders(),
          getAllItems(),
          listMonths(),
        ]);
        setProducts(p);
        setOrders(o);
        setItems(it);
        setMonths(ms);
        if (ms.length) setMonth(ms[0].name);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const allSelected = selectedLocs.length === LOCATIONS.length;
  function toggleLoc(loc: string) {
    setSelectedLocs((s) => (s.includes(loc) ? s.filter((x) => x !== loc) : [...s, loc]));
  }
  function toggleAll() {
    setSelectedLocs(allSelected ? [] : [...LOCATIONS]);
  }

  const ordered = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  // Parties = union across selected depots (merged by name). qty summed.
  const { parties, qty, colTotals } = useMemo(() => {
    const ordersById = new Map(orders.map((o) => [o.id, o]));
    const displayByNorm: Record<string, string> = {};
    for (const loc of selectedLocs)
      for (const p of PARTIES[loc] || []) if (!displayByNorm[norm(p)]) displayByNorm[norm(p)] = p;
    const parties = Object.values(displayByNorm).sort((a, b) => a.localeCompare(b));

    const qty: Record<string, Record<string, number>> = {};
    for (const p of parties) qty[p] = {};
    for (const it of items) {
      const o = ordersById.get(it.order_id);
      if (!o || o.month !== month || !selectedLocs.includes(o.location || "")) continue;
      const party = displayByNorm[norm(o.customer || "")];
      if (!party) continue;
      const k = it.product_id || it.product_name;
      qty[party][k] = (qty[party][k] || 0) + (it.quantity || 0);
    }
    const colTotals: Record<string, number> = {};
    for (const p of parties) {
      let sum = 0;
      for (const prod of ordered) {
        const q = qty[p][prod.id] ?? qty[p][prod.name] ?? 0;
        sum += q * (priceFor(prod, null) ?? 0);
      }
      colTotals[p] = Math.round(sum * 100) / 100;
    }
    return { parties, qty, colTotals };
  }, [orders, items, selectedLocs, ordered, month]);

  const monthOrders = orders.filter((o) => o.month === month);

  function doExport() {
    exportMatrixXlsx(month, LOCATIONS, PARTIES, products, monthOrders, items);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Order book</h1>
          <p className="text-sm text-slate-500">Party-wise sales · {monthOrders.length} scans this month</p>
        </div>
        <button className="btn-primary" disabled={!month} onClick={doExport}>
          ⬇ Export Excel (all depots + combined)
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — this data lives in this browser only.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <select className="input max-w-[12rem]" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">— select month —</option>
          {months.map((m) => (<option key={m.id} value={m.name}>{m.name}</option>))}
        </select>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={toggleAll}
            className={`rounded-full px-3 py-1 text-xs font-medium ${allSelected ? "bg-brand text-white" : "border border-slate-300 bg-white text-slate-600"}`}
          >
            All
          </button>
          {LOCATIONS.map((l) => {
            const on = selectedLocs.includes(l);
            return (
              <button
                key={l}
                onClick={() => toggleLoc(l)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "bg-teal-100 text-teal-800" : "border border-slate-300 bg-white text-slate-500"}`}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>
      {selectedLocs.length > 1 && (
        <p className="text-xs text-slate-400">
          Showing {allSelected ? "all depots" : selectedLocs.join(", ")} combined — a party in multiple depots is summed.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !month ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {months.length === 0 ? (
            <>No months yet. <Link href="/" className="font-medium text-brand">Create one and scan →</Link></>
          ) : "Create a month and scan orders to fill this in."}
        </div>
      ) : selectedLocs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">Select at least one depot.</div>
      ) : (
        <>
          <p className="text-xs text-slate-400">Swipe the table sideways to see all parties →</p>
          <div className="card overflow-x-auto">
            <table className="border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left align-bottom">
                  <th className="sticky left-0 z-10 w-32 min-w-[8rem] max-w-[8rem] bg-slate-50 px-2 py-2 font-semibold">
                    Product
                  </th>
                  {parties.map((p) => (
                    <th
                      key={p}
                      className="min-w-[4.5rem] max-w-[5.5rem] whitespace-normal break-words px-2 py-2 text-right align-bottom font-semibold leading-tight"
                    >
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((prod) => (
                  <tr key={prod.id} className="border-t border-slate-100">
                    <td
                      className="sticky left-0 z-10 w-32 min-w-[8rem] max-w-[8rem] truncate bg-white px-2 py-1.5"
                      title={`${prod.name} · MP ${(priceFor(prod, null) ?? 0).toFixed(2)}`}
                    >
                      {prod.name}
                    </td>
                    {parties.map((p) => {
                      const q = qty[p]?.[prod.id] ?? qty[p]?.[prod.name] ?? 0;
                      return (
                        <td key={p} className={`px-2 py-1.5 text-right tabular-nums ${q ? "font-medium" : "text-slate-300"}`}>
                          {q || "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="sticky left-0 z-10 w-32 min-w-[8rem] max-w-[8rem] bg-slate-50 px-2 py-2">TOTAL</td>
                  {parties.map((p) => (
                    <td key={p} className="px-2 py-2 text-right tabular-nums">
                      {colTotals[p] ? colTotals[p].toLocaleString(undefined, { maximumFractionDigits: 0 }) : "·"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
