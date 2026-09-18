import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  StatusBar,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import ScanScreen from "./src/screens/ScanScreen";
import OrdersScreen from "./src/screens/OrdersScreen";
import ProductsScreen from "./src/screens/ProductsScreen";
import { colors } from "./src/theme";

type Tab = "scan" | "orders" | "products";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "scan", label: "Scan", icon: "📷" },
  { key: "orders", label: "Orders", icon: "🧾" },
  { key: "products", label: "Products", icon: "📦" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("scan");

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="dark" />
      <View style={styles.appbar}>
        <Text style={styles.brand}>📷 Order Scanner</Text>
      </View>

      <View style={{ flex: 1 }}>
        {/* Scan stays mounted to preserve an in-progress scan. */}
        <View style={{ flex: 1, display: tab === "scan" ? "flex" : "none" }}>
          <ScanScreen />
        </View>
        {tab === "orders" && <OrdersScreen />}
        {tab === "products" && <ProductsScreen />}
      </View>

      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
              <Text style={{ fontSize: 20, opacity: active ? 1 : 0.5 }}>{t.icon}</Text>
              <Text style={[styles.tabLabel, active && { color: colors.brand, fontWeight: "700" }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  appbar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  brand: { fontSize: 18, fontWeight: "800", color: colors.brand },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: "#fff",
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8 },
  tabLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
