import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Product, DraftItem, MatchConfidence } from "@order/shared";
import { buildDraft } from "@order/shared";
import { OcrEngine, OcrEngineHandle } from "../ocr";
import { getProducts, createOrder, LOCATIONS, isSupabaseConfigured } from "../db";
import { colors, confidenceStyle, money } from "../theme";

interface Row extends DraftItem {
  include: boolean;
}
type Phase = "input" | "ocr" | "review" | "saved";

export default function ScanScreen() {
  const ocrRef = useRef<OcrEngineHandle>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [images, setImages] = useState<string[]>([]); // data URLs
  const [phase, setPhase] = useState<Phase>("input");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState(0);
  const [savedInfo, setSavedInfo] = useState({ count: 0, total: 0 });

  const [location, setLocation] = useState(LOCATIONS[0]);
  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const [pickerRow, setPickerRow] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getProducts().then(setProducts).catch((e) => Alert.alert("Error", String(e)));
  }, []);

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function addImage(fromCamera: boolean) {
    const opts: ImagePicker.ImagePickerOptions = {
      base64: true,
      quality: 0.6,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    };
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Please allow access to continue.");
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true });
    if (res.canceled) return;
    const added = res.assets
      .filter((a) => a.base64)
      .map((a) => `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    setImages((prev) => [...prev, ...added]);
  }

  async function runScan() {
    if (images.length === 0 || !ocrRef.current) return;
    setPhase("ocr");
    setProgress(0);
    try {
      const parts: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const text = await ocrRef.current.recognize(images[i], (p) =>
          setProgress(Math.round(((i + p) / images.length) * 100))
        );
        parts.push(text);
      }
      const draft = buildDraft(parts.join("\n"), products);
      setRows(
        draft.map((d) => ({
          ...d,
          include: d.product != null && d.confidence !== "none",
        }))
      );
      setPhase("review");
    } catch (e) {
      Alert.alert("OCR failed", String(e));
      setPhase("input");
    }
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function chooseProduct(id: string, productId: string) {
    const p = productById.get(productId) || null;
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const price = r.price != null ? r.price : p?.price ?? null;
        return { ...r, product: p, price, include: true, confidence: "high" as MatchConfidence };
      })
    );
    setPickerRow(null);
    setSearch("");
  }

  function addManualRow() {
    setRows((rs) => [
      ...rs,
      {
        id: "manual-" + Date.now(),
        raw: "",
        product: null,
        candidates: [],
        confidence: "none",
        quantity: null,
        price: null,
        include: true,
      },
    ]);
  }

  const included = rows.filter((r) => r.include);
  const lineTotal = (r: Row) => (r.quantity ?? 0) * (r.price ?? 0);
  const total = included.reduce((s, r) => s + lineTotal(r), 0);
  const canSave = included.length > 0 && included.every((r) => r.product && (r.quantity ?? 0) > 0);

  async function save() {
    try {
      await createOrder({
        reference: reference || null,
        customer: customer || null,
        location,
        note: note || null,
        image_count: images.length,
        items: included.map((r) => ({
          product_id: r.product?.id ?? null,
          product_name: r.product?.name ?? r.raw,
          product_code: r.product?.code ?? null,
          unit: r.product?.unit ?? null,
          quantity: r.quantity ?? 0,
          unit_price: r.price ?? 0,
          line_total: Math.round(lineTotal(r) * 100) / 100,
          raw_text: r.raw || null,
        })),
      });
      setSavedInfo({ count: included.length, total });
      setPhase("saved");
    } catch (e) {
      Alert.alert("Could not save", String(e));
    }
  }

  function reset() {
    setImages([]);
    setRows([]);
    setPhase("input");
    setCustomer("");
    setReference("");
    setNote("");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <OcrEngine ref={ocrRef} />

      {phase === "saved" ? (
        <View style={styles.centered}>
          <Text style={{ fontSize: 44 }}>✅</Text>
          <Text style={styles.h2}>Order saved</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>
            {savedInfo.count} items · Total {money(savedInfo.total)}
          </Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={reset}>
            <Text style={styles.btnPrimaryText}>Scan another</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {!isSupabaseConfigured && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                Local mode — data is saved on this device only.
              </Text>
            </View>
          )}

          {/* Order details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Order details</Text>
            <Text style={styles.label}>Location / Depot</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              {LOCATIONS.map((l) => (
                <TouchableOpacity
                  key={l}
                  onPress={() => setLocation(l)}
                  style={[styles.chip, location === l && styles.chipActive]}
                >
                  <Text style={[styles.chipText, location === l && styles.chipTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput style={styles.input} placeholder="Customer / Party" value={customer} onChangeText={setCustomer} />
            <TextInput style={styles.input} placeholder="Reference / Bill no. (optional)" value={reference} onChangeText={setReference} />
            <TextInput style={styles.input} placeholder="Note (optional)" value={note} onChangeText={setNote} />
          </View>

          {/* Images */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Order images</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {images.map((src, i) => (
                <Image key={i} source={{ uri: src }} style={styles.thumb} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => addImage(true)}>
                <Text style={styles.btnGhostText}>📷 Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnGhost} onPress={() => addImage(false)}>
                <Text style={styles.btnGhostText}>🖼 Gallery</Text>
              </TouchableOpacity>
            </View>
            {phase === "input" && images.length > 0 && (
              <TouchableOpacity style={styles.btnPrimary} onPress={runScan}>
                <Text style={styles.btnPrimaryText}>
                  Scan {images.length} image{images.length > 1 ? "s" : ""}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {phase === "ocr" && (
            <View style={[styles.card, { alignItems: "center" }]}>
              <ActivityIndicator color={colors.brand} />
              <Text style={{ color: colors.muted, marginTop: 8 }}>Reading images… {progress}%</Text>
              <Text style={{ color: colors.faint, fontSize: 12, marginTop: 4, textAlign: "center" }}>
                On-device OCR — the first run downloads the language model.
              </Text>
            </View>
          )}

          {phase === "review" && (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Review ({included.length} selected)</Text>
                <TouchableOpacity onPress={addManualRow}>
                  <Text style={{ color: colors.brand, fontWeight: "600" }}>＋ Add line</Text>
                </TouchableOpacity>
              </View>
              {rows.length === 0 && (
                <Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 16 }}>
                  No lines detected. Add lines manually or retake the photo.
                </Text>
              )}
              {rows.map((r) => {
                const cs = confidenceStyle[r.confidence];
                return (
                  <View key={r.id} style={styles.lineRow}>
                    <TouchableOpacity
                      onPress={() => patchRow(r.id, { include: !r.include })}
                      style={[styles.checkbox, r.include && styles.checkboxOn]}
                    >
                      {r.include && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      {!!r.raw && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <View style={[styles.badge, { backgroundColor: cs.bg }]}>
                            <Text style={{ color: cs.fg, fontSize: 10 }}>{r.confidence}</Text>
                          </View>
                          <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12, flex: 1 }}>
                            “{r.raw}”
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.select}
                        onPress={() => {
                          setPickerRow(r.id);
                          setSearch("");
                        }}
                      >
                        <Text style={{ color: r.product ? colors.text : colors.faint }}>
                          {r.product ? r.product.name : "— choose product —"}
                        </Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center" }}>
                        <TextInput
                          style={[styles.input, styles.smallInput]}
                          placeholder="Qty"
                          keyboardType="numeric"
                          value={r.quantity != null ? String(r.quantity) : ""}
                          onChangeText={(t) => patchRow(r.id, { quantity: t === "" ? null : Number(t) })}
                        />
                        <TextInput
                          style={[styles.input, styles.smallInput]}
                          placeholder="Price"
                          keyboardType="numeric"
                          value={r.price != null ? String(r.price) : ""}
                          onChangeText={(t) => patchRow(r.id, { price: t === "" ? null : Number(t) })}
                        />
                        <Text style={{ flex: 1, textAlign: "right", fontWeight: "600" }}>
                          {money(lineTotal(r))}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                      <Text style={{ color: colors.faint, fontSize: 18, paddingLeft: 6 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              <View style={[styles.rowBetween, { marginTop: 12 }]}>
                <Text style={{ color: colors.muted }}>
                  Total <Text style={{ fontWeight: "700", color: colors.text, fontSize: 16 }}>{money(total)}</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.btnPrimary, { marginTop: 0 }, !canSave && { opacity: 0.5 }]}
                  disabled={!canSave}
                  onPress={save}
                >
                  <Text style={styles.btnPrimaryText}>Confirm & save</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Product picker modal */}
      <Modal visible={pickerRow != null} animationType="slide" onRequestClose={() => setPickerRow(null)}>
        <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 50 }}>
          <View style={{ padding: 16 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.h2}>Choose product</Text>
              <TouchableOpacity onPress={() => setPickerRow(null)}>
                <Text style={{ color: colors.brand, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder="Search products…"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filteredProducts}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickItem}
                onPress={() => pickerRow && chooseProduct(pickerRow, item.id)}
              >
                <Text style={{ color: colors.text }}>{item.name}</Text>
                <Text style={{ color: colors.faint }}>{item.price != null ? item.price.toFixed(2) : ""}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.text },
  banner: { backgroundColor: "#fef9c3", borderRadius: 8, padding: 10, marginBottom: 12 },
  bannerText: { color: "#854d0e", fontSize: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 8 },
  label: { fontSize: 12, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, color: colors.text, backgroundColor: "#fff" },
  smallInput: { flex: 0, width: 78, marginBottom: 0, textAlign: "center" },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, backgroundColor: "#fff" },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  thumb: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.brand, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  btnPrimaryText: { color: "#fff", fontWeight: "600" },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#fff" },
  btnGhostText: { color: colors.text, fontWeight: "500" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 2, backgroundColor: "#fff" },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  badge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  select: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff" },
  pickItem: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#fff" },
});
