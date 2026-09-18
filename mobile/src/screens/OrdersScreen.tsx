import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import type { Order, OrderItem } from "@order/shared";
import { listOrders, getAllItems, deleteOrder, isSupabaseConfigured } from "../db";
import { exportOrders } from "../export";
import { colors, money } from "../theme";

export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, it] = await Promise.all([listOrders(), getAllItems()]);
      setOrders(o);
      setItems(it);
    } catch (e) {
      Alert.alert("Error", String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const itemsOf = (id: string) => items.filter((i) => i.order_id === id);
  const grandTotal = orders.reduce((s, o) => s + (o.total || 0), 0);

  async function onExport() {
    if (orders.length === 0) return;
    setBusy(true);
    try {
      await exportOrders(orders, items);
    } catch (e) {
      Alert.alert("Export failed", String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDelete(id: string) {
    Alert.alert("Delete order", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteOrder(id);
          load();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Orders</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {orders.length} orders · {money(grandTotal)}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.btnPrimary, (orders.length === 0 || busy) && { opacity: 0.5 }]}
          disabled={orders.length === 0 || busy}
          onPress={onExport}
        >
          <Text style={styles.btnPrimaryText}>⬇ Export Excel</Text>
        </TouchableOpacity>
      </View>

      {!isSupabaseConfigured && (
        <Text style={styles.banner}>Local mode — orders are stored on this device only.</Text>
      )}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }}>
            No orders yet. Scan one from the Scan tab.
          </Text>
        }
        renderItem={({ item: o }) => {
          const its = itemsOf(o.id);
          const isOpen = open === o.id;
          return (
            <View style={styles.card}>
              <TouchableOpacity style={styles.rowBetween} onPress={() => setOpen(isOpen ? null : o.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "600", color: colors.text }}>
                    {o.customer || o.reference || "Order"}
                  </Text>
                  <Text style={{ color: colors.faint, fontSize: 12 }}>
                    {o.created_at.slice(0, 16).replace("T", " ")} · {its.length} items
                    {o.location ? ` · ${o.location}` : ""}
                  </Text>
                </View>
                <Text style={{ fontWeight: "700", color: colors.text }}>{money(o.total)}</Text>
              </TouchableOpacity>
              {isOpen && (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 8 }}>
                  {its.map((it) => (
                    <View key={it.id} style={styles.itemRow}>
                      <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
                        {it.product_name}
                      </Text>
                      <Text style={{ width: 36, textAlign: "right", color: colors.muted }}>{it.quantity}</Text>
                      <Text style={{ width: 64, textAlign: "right", color: colors.muted }}>{money(it.unit_price)}</Text>
                      <Text style={{ width: 72, textAlign: "right", fontWeight: "600" }}>{money(it.line_total)}</Text>
                    </View>
                  ))}
                  {!!o.note && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Note: {o.note}</Text>}
                  <TouchableOpacity onPress={() => onDelete(o.id)} style={{ marginTop: 8 }}>
                    <Text style={{ color: colors.danger, fontSize: 12 }}>Delete order</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 8 },
  h1: { fontSize: 20, fontWeight: "700", color: colors.text },
  banner: { color: "#854d0e", backgroundColor: "#fef9c3", marginHorizontal: 16, padding: 8, borderRadius: 8, fontSize: 12 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  btnPrimary: { backgroundColor: colors.brand, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimaryText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
