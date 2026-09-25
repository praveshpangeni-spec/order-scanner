"use client";
import type { Product, Order, OrderItem, Month } from "@order/shared";
import { supabase, isSupabaseConfigured } from "./supabase";
import seed from "./products.seed.json";
import partiesData from "./parties.json";

/** Known parties (customers) per depot, for suggestions. */
export const PARTIES: Record<string, string[]> = partiesData as Record<string, string[]>;

const LS = {
  products: "order_ocr_products",
  orders: "order_ocr_orders",
  items: "order_ocr_items",
  months: "order_ocr_months",
  activeMonth: "order_ocr_active_month",
};

export const LOCATIONS = ["Narayanghat", "Butwal", "Pokhara", "Birganj"];

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

function seededProducts(): Product[] {
  return (seed as any[]).map((p) => ({
    id: p.code,
    name: p.name,
    code: p.code,
    unit: p.unit ?? null,
    category: p.category ?? null,
    price: p.price ?? null,
    prices: p.prices ?? null,
    aliases: p.aliases ?? [],
  }));
}

export { isSupabaseConfigured };

// ---------- Months ----------
export async function listMonths(): Promise<Month[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("months")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as Month[];
  }
  return read<Month[]>(LS.months, []);
}

export async function createMonth(name: string): Promise<Month> {
  const m: Month = { id: uuid(), name: name.trim(), created_at: new Date().toISOString() };
  if (supabase) {
    const { error } = await supabase.from("months").insert(m);
    if (error) throw error;
  } else {
    write(LS.months, [m, ...read<Month[]>(LS.months, [])]);
  }
  return m;
}

export function getActiveMonth(): string | null {
  return read<string | null>(LS.activeMonth, null);
}
export function setActiveMonth(name: string | null): void {
  write(LS.activeMonth, name);
}

// ---------- Products ----------
export async function getProducts(): Promise<Product[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name");
    if (error) throw error;
    return data as Product[];
  }
  let local = read<Product[]>(LS.products, []);
  if (local.length === 0) {
    local = seededProducts();
    write(LS.products, local);
  }
  return local;
}

export async function replaceProducts(products: Product[]): Promise<void> {
  const withIds = products.map((p) => ({ ...p, id: p.id || uuid() }));
  if (supabase) {
    await supabase.from("products").delete().neq("id", "");
    const { error } = await supabase.from("products").insert(withIds);
    if (error) throw error;
    return;
  }
  write(LS.products, withIds);
}

export async function upsertProduct(p: Product): Promise<void> {
  const prod = { ...p, id: p.id || uuid() };
  if (supabase) {
    const { error } = await supabase.from("products").upsert(prod);
    if (error) throw error;
    return;
  }
  const list = read<Product[]>(LS.products, []);
  const i = list.findIndex((x) => x.id === prod.id);
  if (i >= 0) list[i] = prod;
  else list.push(prod);
  write(LS.products, list);
}

export async function deleteProduct(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    return;
  }
  write(
    LS.products,
    read<Product[]>(LS.products, []).filter((x) => x.id !== id)
  );
}

// ---------- Orders ----------
export interface NewOrderInput {
  reference?: string | null;
  customer?: string | null;
  location?: string | null;
  month?: string | null;
  note?: string | null;
  image_count: number;
  items: Array<Omit<OrderItem, "id" | "order_id">>;
}

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const total =
    Math.round(input.items.reduce((s, i) => s + (i.line_total || 0), 0) * 100) /
    100;
  const order: Order = {
    id: uuid(),
    created_at: new Date().toISOString(),
    month: input.month ?? null,
    reference: input.reference ?? null,
    customer: input.customer ?? null,
    location: input.location ?? null,
    note: input.note ?? null,
    image_count: input.image_count,
    total,
  };
  const items: OrderItem[] = input.items.map((it) => ({
    ...it,
    id: uuid(),
    order_id: order.id,
  }));

  if (supabase) {
    const { error: oErr } = await supabase.from("orders").insert(order);
    if (oErr) throw oErr;
    const { error: iErr } = await supabase.from("order_items").insert(items);
    if (iErr) throw iErr;
    return order;
  }
  write(LS.orders, [order, ...read<Order[]>(LS.orders, [])]);
  write(LS.items, [...items, ...read<OrderItem[]>(LS.items, [])]);
  return order;
}

export async function listOrders(): Promise<Order[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as Order[];
  }
  return read<Order[]>(LS.orders, []);
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId);
    if (error) throw error;
    return data as OrderItem[];
  }
  return read<OrderItem[]>(LS.items, []).filter((i) => i.order_id === orderId);
}

export async function getAllItems(): Promise<OrderItem[]> {
  if (supabase) {
    const { data, error } = await supabase.from("order_items").select("*");
    if (error) throw error;
    return data as OrderItem[];
  }
  return read<OrderItem[]>(LS.items, []);
}

export interface OrderEdit {
  month?: string | null;
  location?: string | null;
  customer?: string | null;
  note?: string | null;
  items: Array<Omit<OrderItem, "id" | "order_id">>;
}

/** Update an order's header fields and fully replace its line items. */
export async function updateOrderWithItems(orderId: string, edit: OrderEdit): Promise<void> {
  const total =
    Math.round(edit.items.reduce((s, i) => s + (i.line_total || 0), 0) * 100) / 100;
  const fields = {
    month: edit.month ?? null,
    location: edit.location ?? null,
    customer: edit.customer ?? null,
    note: edit.note ?? null,
    total,
  };
  const newItems: OrderItem[] = edit.items.map((it) => ({ ...it, id: uuid(), order_id: orderId }));

  if (supabase) {
    const { error: uErr } = await supabase.from("orders").update(fields).eq("id", orderId);
    if (uErr) throw uErr;
    await supabase.from("order_items").delete().eq("order_id", orderId);
    const { error: iErr } = await supabase.from("order_items").insert(newItems);
    if (iErr) throw iErr;
    return;
  }
  write(
    LS.orders,
    read<Order[]>(LS.orders, []).map((o) => (o.id === orderId ? { ...o, ...fields } : o))
  );
  write(LS.items, [
    ...read<OrderItem[]>(LS.items, []).filter((i) => i.order_id !== orderId),
    ...newItems,
  ]);
}

export async function deleteOrder(orderId: string): Promise<void> {
  if (supabase) {
    await supabase.from("order_items").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("id", orderId);
    return;
  }
  write(
    LS.orders,
    read<Order[]>(LS.orders, []).filter((o) => o.id !== orderId)
  );
  write(
    LS.items,
    read<OrderItem[]>(LS.items, []).filter((i) => i.order_id !== orderId)
  );
}
