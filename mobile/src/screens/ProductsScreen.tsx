import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import type { Product } from "@order/shared";
import { getProducts, resetProductsToSeed, isSupabaseConfigured } from "../db";
import { colors } from "../theme";

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");

  async function load() {
    try {
      setProducts(await getProducts());
    } catch (e) {
      Alert.alert("Error", String(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)
    );
  }, [products, query]);

  function onReset() {
    Alert.alert("Reset catalog", "Restore the bundled product list?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        onPress: async () => {
          setProducts(await resetProductsToSeed());
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Products</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{products.length} in catalog</Text>
        </View>
        <TouchableOpacity style={styles.btnGhost} onPress={onReset}>
          <Text style={styles.btnGhostText}>Reset</Text>
        </TouchableOpacity>
      </View>
      {!isSupabaseConfigured && (
        <Text style={styles.banner}>
          Local mode — manage the full catalog (import a list) from the web app.
        </Text>
      )}
      <View style={{ paddingHorizontal: 16 }}>
        <TextInput style={styles.input} placeholder="Search products…" value={query} onChangeText={setQuery} />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "500" }}>{item.name}</Text>
              <Text style={{ color: colors.faint, fontSize: 12 }}>
                {[item.category, item.code].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={{ color: colors.muted }}>{item.price != null ? item.price.toFixed(2) : "—"}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 8 },
  h1: { fontSize: 20, fontWeight: "700", color: colors.text },
  banner: { color: "#854d0e", backgroundColor: "#fef9c3", marginHorizontal: 16, padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: "#fff" },
  btnGhostText: { color: colors.text, fontWeight: "500" },
});
