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

const SEED_HINT = "Create a month and scan orders to fill this in.";

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [month, setMonth] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
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

  const parties = PARTIES[location] || [];
  const orderedProducts = useMemo(() => products, [products]);

  // qty[party][productId] for the selected month + location
  const { qty, colTotals } = useMemo(() => {
    const ordersById = new Map(orders.map((o) => [o.id, o]));
    const qty: Record<string, Record<string, number>> = {};
    for (const p of parties) qty[p] = {};
    for (const it of items) {
      const o = ordersById.get(it.order_id);
      if (!o || o.month !== month || o.location !== location) continue;
      const party = (o.customer || "").trim();
      if (!qty[party]) continue;
      const k = it.product_id || it.product_name;
      qty[party][k] = (qty[party][k] || 0) + (it.quantity || 0);
    }
    const colTotals: Record<string, number> = {};
    for (const p of parties) {
      let sum = 0;
      for (const prod of orderedProducts) {
        const q = qty[p][prod.id] ?? qty[p][prod.name] ?? 0;
        sum += q * (priceFor(prod, location) ?? 0);
      }
      colTotals[p] = Math.round(sum * 100) / 100;
    }
    return { qty, colTotals };
  }, [orders, items, parties, orderedProducts, month, location]);

  const monthOrders = orders.filter((o) => o.month === month);

  function doExport() {
    exportMatrixXlsx(
      month,
      LOCATIONS,
      PARTIES,
      products,
      orders.filter((o) => o.month === month),
      items
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Order book</h1>
          <p className="text-sm text-slate-500">Party-wise sales · {monthOrders.length} scans this month</p>
        </div>
        <button className="btn-primary" disabled={!month} onClick={doExport}>⬇ Export Excel</button>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — this data lives in this browser only.
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <select className="input max-w-[12rem]" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">— select month —</option>
          {months.map((m) => (<option key={m.id} value={m.name}>{m.name}</option>))}
        </select>
        <select className="input max-w-[12rem]" value={location} onChange={(e) => setLocation(e.target.value)}>
          {LOCATIONS.map((l) => (<option key={l}>{l}</option>))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !month ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {months.length === 0 ? (
            <>No months yet. <Link href="/" className="font-medium text-brand">Create one and scan →</Link></>
          ) : SEED_HINT}
        </div>
      ) : (
        <div className="card overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 text-right font-semibold">MP</th>
                {parties.map((p) => (
                  <th key={p} className="whitespace-nowrap px-3 py-2 text-right font-semibold">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedProducts.map((prod) => (
                <tr key={prod.id} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5">{prod.name}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{(priceFor(prod, location) ?? 0).toFixed(2)}</td>
                  {parties.map((p) => {
                    const q = qty[p]?.[prod.id] ?? qty[p]?.[prod.name] ?? 0;
                    return (
                      <td key={p} className={`px-3 py-1.5 text-right tabular-nums ${q ? "font-medium" : "text-slate-300"}`}>
                        {q || "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">TOTAL (value)</td>
                <td className="px-3 py-2" />
                {parties.map((p) => (
                  <td key={p} className="px-3 py-2 text-right tabular-nums">
                    {colTotals[p] ? colTotals[p].toLocaleString(undefined, { maximumFractionDigits: 0 }) : "·"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
