# Order Scanner

Read order images with **on-device OCR**, decode each line against your product
list, confirm quantity and price, save to a database, and export to Excel.
Two clients share one core:

- **web/** — Next.js app (works on desktop and mobile browsers; uses the phone camera)
- **mobile/** — Expo (React Native) app for Android/iOS
- **shared/** — the OCR-text parser + fuzzy product matcher + Excel row builder used by both

## How it works

1. Upload / photograph the order (one or more images).
2. On-device **Tesseract** OCR reads the text — no cloud, no API keys.
3. Each line is parsed into *product text + quantity + price* and fuzzy-matched
   against the catalog (`shared/matcher.ts`). Price falls back to the catalog MP
   when the order doesn't state one.
4. You review a draft: fix any product/qty/price, tick which lines to keep.
5. Confirm → the order is stored. Download everything as `.xlsx` anytime, from
   web or mobile.

The matcher combines a Sørensen–Dice bigram score, token overlap, and pack-size
agreement (so `CANDID POWDER 50 GM` and `100 GM` don't get confused). Confidence
is shown per line: high / medium / low / none.

## Product catalog

Seeded from the **NGT SD** sheet of `NGT SD RUNNING SALES 2025-26 sep.xlsx`
(28 Glenmark derma products with their MP price), in `supabase/products.seed.json`.
Import a different list anytime from the web app's **Products → Import list**
(map the Name / Price / Code / Unit / Category columns; replace or merge).

## Storage: local by default, Supabase optional

With no configuration the apps store everything **on the device / in the browser**,
so you can run them immediately. To sync across devices and share one database:

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Web: copy `web/.env.local.example` → `web/.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Mobile: copy `mobile/.env.example` → `mobile/.env` and fill in
   `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Run the web app

```bash
npm install            # from the repo root (installs shared + web)
npm run dev -w @order/web
# open http://localhost:3005
```

Build for production / deploy to Vercel: `npm run build -w @order/web`
(set the two `NEXT_PUBLIC_SUPABASE_*` env vars in Vercel).

## Run the mobile app

```bash
cd mobile
npm install --legacy-peer-deps
npx expo start          # scan the QR with Expo Go, or press a/i for emulator
```

OCR runs inside a hidden WebView using the same Tesseract build as the web app,
so it works in Expo Go. The first scan downloads the English language model
(needs internet once). Camera + gallery use `expo-image-picker`.

To ship real app-store builds, add an app icon/splash under `mobile/assets`,
then use EAS: `npx eas build -p android` / `-p ios`.

## Project layout

```
shared/     types, normalize, matcher, parser, pipeline, exportRows   (pure TS, no deps)
web/        app/ (scan, orders, products) · lib/ (db, ocr, xlsx, supabase)
mobile/     App.tsx · src/ (db, ocr, export, screens/)
supabase/   schema.sql · products.seed.json
```
