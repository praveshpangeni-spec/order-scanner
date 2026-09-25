"use client";
import * as XLSX from "xlsx";
import type { Order, OrderItem, Product } from "@order/shared";
import { toExportRows, priceFor } from "@order/shared";
import seed from "./products.seed.json";

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function colLetter(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** Canonical product order from the master seed (names lower-cased). */
const SEED_ORDER: string[] = (seed as any[]).map((p) => String(p.name).toLowerCase());
function seedIndex(name: string): number {
  const i = SEED_ORDER.indexOf(name.toLowerCase());
  return i < 0 ? 9999 : i;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Build one party-wise SALES & STOCK sheet and append it to the workbook. */
function buildSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  title: string,
  parties: string[],
  qty: Record<string, Record<string, number>>,
  ordered: Product[],
  mpOf: (p: Product) => number
) {
  const N = ordered.length;
  const aoa: (string | number)[][] = [];
  const titleRow: (string | number)[] = [title, ""];
  for (const p of parties) titleRow.push(p, "");
  aoa.push(titleRow);
  const hdr: (string | number)[] = ["PRODUCTS", "MP"];
  for (const _ of parties) hdr.push("SALES", "STOCK");
  aoa.push(hdr);
  for (const prod of ordered) {
    const row: (string | number)[] = [prod.name, mpOf(prod)];
    for (const p of parties) {
      const q = qty[p]?.[prod.id] ?? qty[p]?.[prod.name] ?? 0;
      row.push(q === 0 ? "" : q, "");
    }
    aoa.push(row);
  }
  const totalRow: (string | number)[] = ["TOTAL", ""];
  for (const _ of parties) totalRow.push("", "");
  aoa.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const firstDataRow = 3;
  const lastDataRow = 2 + N;
  const totalRowNum = 3 + N;
  const mpRange = `$B${firstDataRow}:$B${lastDataRow}`;
  parties.forEach((p, k) => {
    const salesCol = colLetter(2 + k * 2);
    let value = 0;
    for (const prod of ordered) {
      const q = qty[p]?.[prod.id] ?? qty[p]?.[prod.name] ?? 0;
      value += q * mpOf(prod);
    }
    ws[`${salesCol}${totalRowNum}`] = {
      t: "n",
      v: Math.round(value * 100) / 100,
      f: `SUMPRODUCT(${salesCol}${firstDataRow}:${salesCol}${lastDataRow},${mpRange})`,
    };
  });
  ws["!cols"] = [{ wch: 34 }, { wch: 8 }, ...parties.flatMap(() => [{ wch: 10 }, { wch: 8 }])];
  ws["!merges"] = parties.map((_, k) => ({ s: { r: 0, c: 2 + k * 2 }, e: { r: 0, c: 3 + k * 2 } }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 28));
}

/**
 * Build the party-wise SALES & STOCK workbook for one month: one sheet per
 * depot PLUS a combined "All Locations" sheet (same party merged across
 * depots). MP is uniform across depots. Bottom row = live SUMPRODUCT(sales, MP).
 */
export function exportMatrixXlsx(
  monthName: string,
  locations: string[],
  partiesByLoc: Record<string, string[]>,
  products: Product[],
  orders: Order[],
  items: OrderItem[]
) {
  const wb = XLSX.utils.book_new();
  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const ordered = [...products].sort((a, b) => seedIndex(a.name) - seedIndex(b.name));
  const mpOf = (p: Product) => priceFor(p, null) ?? p.price ?? 0;

  // Per-depot sheets.
  for (const loc of locations) {
    const parties = partiesByLoc[loc] || [];
    const partySet = new Set(parties.map(norm));
    const qty: Record<string, Record<string, number>> = {};
    for (const p of parties) qty[p] = {};
    const byNorm: Record<string, string> = {};
    for (const p of parties) byNorm[norm(p)] = p;
    for (const it of items) {
      const o = ordersById.get(it.order_id);
      if (!o || o.location !== loc) continue;
      const party = byNorm[norm(o.customer || "")];
      if (!party) continue;
      const k = it.product_id || it.product_name;
      qty[party][k] = (qty[party][k] || 0) + (it.quantity || 0);
    }
    buildSheet(wb, loc, `PARTY WISE / UNIT WISE SALES & STOCK — ${monthName} — ${loc}`, parties, qty, ordered, mpOf);
  }

  // Combined sheet: union of parties across all depots, merged by name.
  const displayByNorm: Record<string, string> = {};
  for (const loc of locations) for (const p of partiesByLoc[loc] || []) if (!displayByNorm[norm(p)]) displayByNorm[norm(p)] = p;
  const allParties = Object.values(displayByNorm).sort((a, b) => a.localeCompare(b));
  const qtyAll: Record<string, Record<string, number>> = {};
  for (const p of allParties) qtyAll[p] = {};
  for (const it of items) {
    const o = ordersById.get(it.order_id);
    if (!o) continue;
    const party = displayByNorm[norm(o.customer || "")];
    if (!party) continue;
    const k = it.product_id || it.product_name;
    qtyAll[party][k] = (qtyAll[party][k] || 0) + (it.quantity || 0);
  }
  buildSheet(wb, "All Locations", `PARTY WISE / UNIT WISE SALES & STOCK — ${monthName} — ALL LOCATIONS`, allParties, qtyAll, ordered, mpOf);

  const safe = monthName.replace(/[^A-Za-z0-9_-]+/g, "-");
  download(wb, `sales-${safe || "month"}.xlsx`);
}

/** Export orders + items to an .xlsx download. */
export function exportOrdersXlsx(orders: Order[], items: OrderItem[]) {
  const byOrder = new Map<string, OrderItem[]>();
  for (const it of items) {
    const a = byOrder.get(it.order_id) || [];
    a.push(it);
    byOrder.set(it.order_id, a);
  }
  const data = orders.map((order) => ({
    order,
    items: byOrder.get(order.id) || [],
  }));
  const rows = toExportRows(data);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 30 },
    { wch: 14 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const stamp = new Date().toISOString().slice(0, 10);
  download(wb, `orders-${stamp}.xlsx`);
}

export interface SheetPreview {
  headers: string[];
  rows: Record<string, any>[];
}

/** Read an uploaded product-list file (.xlsx/.csv) into headers + rows. */
export async function readProductFile(file: File): Promise<SheetPreview> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

export interface ColumnMap {
  name: string;
  code?: string;
  unit?: string;
  price?: string;
  category?: string;
}

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Turn imported rows + a column mapping into Product objects. */
export function rowsToProducts(rows: Record<string, any>[], map: ColumnMap): Product[] {
  const out: Product[] = [];
  for (const r of rows) {
    const name = String(r[map.name] ?? "").trim();
    if (!name) continue;
    const priceRaw = map.price ? r[map.price] : null;
    const price =
      priceRaw === "" || priceRaw == null ? null : Number(priceRaw);
    const code = map.code ? String(r[map.code] ?? "").trim() : slug(name);
    out.push({
      id: code || slug(name),
      name,
      code: code || slug(name),
      unit: map.unit ? String(r[map.unit] ?? "").trim() || null : null,
      category: map.category ? String(r[map.category] ?? "").trim() || null : null,
      price: Number.isFinite(price as number) ? (price as number) : null,
      aliases: [],
    });
  }
  return out;
}
