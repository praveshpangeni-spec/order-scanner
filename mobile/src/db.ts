import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Product, Order, OrderItem } from "@order/shared";
import seed from "./products.seed.json";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { storage: AsyncStorage, persistSession: false, autoRefreshToken: false },
      })
    : null;

export const isSupabaseConfigured = Boolean(url && key);

export const LOCATIONS = [
  "Narayanghat ST",
  "Butwal ST",
  "Pokhara ST",
  "Birganj ST",
  "Narayanghat SD",
];

const K = {
  products: "order_ocr_products",
  orders: "order_ocr_orders",
  items: "order_ocr_items",
};

function uuid(): string {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function write<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
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
    aliases: [],
  }));
}

// ---------- Products ----------
export async function getProducts(): Promise<Product[]> {
  if (supabase) {
    const { data, error } = await supabase.from("products").select("*").order("name");
    if (error) throw error;
    return data as Product[];
  }
  let local = await read<Product[]>(K.products, []);
  if (local.length === 0) {
    local = seededProducts();
    await write(K.products, local);
  }
  return local;
}

export async function resetProductsToSeed(): Promise<Product[]> {
  const s = seededProducts();
  if (supabase) {
    await supabase.from("products").delete().neq("id", "");
    await supabase.from("products").insert(s);
  } else {
    await write(K.products, s);
  }
  return s;
}

// ---------- Orders ----------
export interface NewOrderInput {
  reference?: string | null;
  customer?: string | null;
  location?: string | null;
  note?: string | null;
  image_count: number;
  items: Array<Omit<OrderItem, "id" | "order_id">>;
}

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const total =
    Math.round(input.items.reduce((s, i) => s + (i.line_total || 0), 0) * 100) / 100;
  const order: Order = {
    id: uuid(),
    created_at: new Date().toISOString(),
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
  await write(K.orders, [order, ...(await read<Order[]>(K.orders, []))]);
  await write(K.items, [...items, ...(await read<OrderItem[]>(K.items, []))]);
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
  return read<Order[]>(K.orders, []);
}

export async function getAllItems(): Promise<OrderItem[]> {
  if (supabase) {
    const { data, error } = await supabase.from("order_items").select("*");
    if (error) throw error;
    return data as OrderItem[];
  }
  return read<OrderItem[]>(K.items, []);
}

export async function deleteOrder(orderId: string): Promise<void> {
  if (supabase) {
    await supabase.from("order_items").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("id", orderId);
    return;
  }
  await write(
    K.orders,
    (await read<Order[]>(K.orders, [])).filter((o) => o.id !== orderId)
  );
  await write(
    K.items,
    (await read<OrderItem[]>(K.items, [])).filter((i) => i.order_id !== orderId)
  );
}
