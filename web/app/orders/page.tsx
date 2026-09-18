"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Order, OrderItem } from "@order/shared";
import { listOrders, getAllItems, deleteOrder, isSupabaseConfigured } from "@/lib/db";
import { exportOrdersXlsx } from "@/lib/xlsx";

function money(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [o, it] = await Promise.all([listOrders(), getAllItems()]);
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

  async function onDelete(id: string) {
    if (!confirm("Delete this order? This cannot be undone.")) return;
    await deleteOrder(id);
    load();
  }

  const itemsOf = (id: string) => items.filter((i) => i.order_id === id);
  const grandTotal = orders.reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Orders</h1>
          <p className="text-sm text-slate-500">
            {orders.length} orders · {money(grandTotal)} total
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={orders.length === 0}
          onClick={() => exportOrdersXlsx(orders, items)}
        >
          ⬇ Export Excel
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Local mode — these orders live in this browser only.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          No orders yet.{" "}
          <Link href="/" className="font-medium text-brand">
            Scan your first order →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const its = itemsOf(o.id);
            const isOpen = open === o.id;
            return (
              <div key={o.id} className="card overflow-hidden">
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => setOpen(isOpen ? null : o.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {o.customer || o.reference || "Order"}
                      </span>
                      {o.location && (
                        <span className="badge bg-teal-50 text-teal-700">{o.location}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {o.created_at.slice(0, 16).replace("T", " ")} · {its.length} items
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{money(o.total)}</div>
                    <div className="text-xs text-slate-400">{isOpen ? "▲" : "▼"}</div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-slate-400">
                          <th className="py-1">Product</th>
                          <th className="py-1 text-right">Qty</th>
                          <th className="py-1 text-right">Price</th>
                          <th className="py-1 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {its.map((it) => (
                          <tr key={it.id} className="border-t border-slate-100">
                            <td className="py-1.5">
                              {it.product_name}
                              {it.unit ? (
                                <span className="text-slate-400"> · {it.unit}</span>
                              ) : null}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {money(it.unit_price)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {money(it.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {o.note && (
                      <p className="mt-2 text-xs text-slate-500">Note: {o.note}</p>
                    )}
                    <div className="mt-3 flex justify-end">
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => onDelete(o.id)}
                      >
                        Delete order
                      </button>
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
