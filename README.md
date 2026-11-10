# Bloeisel Koffie Loyalty

A mobile-first digital stamp card for Bloeisel Koffie: customers collect a sticker with every coffee and the 10th cup is free. Staff scan the customer's pink QR code at the till to add stickers and redeem rewards.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

| Route | What it is |
| --- | --- |
| `/` | Landing page with a link to each portal |
| `/app/join` | Sign up or find an existing card (try **Explore the demo card**) |
| `/app` | Customer card, rewards, visit history, profile |
| `/app/qr` | Full-screen pink QR for the barista to scan |
| `/admin` | Staff portal: PIN **1234** (demo only) |

**Try the live sync:** open `/app/qr` (demo card) in one tab and `/admin/scan` in another. Enter code `LRT7K2` and add a sticker. The customer tab celebrates instantly.

## Design system

- **Tokens:** every colour, radius, shadow and motion curve lives in `src/styles/tokens.css`. To match the live brand exactly, change the values there.
- **Type:** Fraunces (display, soft serif) + Poppins (UI).
- **Stickers:** `src/components/Sticker.tsx` uses the supplied takeaway-cup icon (`src/assets/cup-icon.svg`) on a scalloped "blossom" die-cut in four colourways, plus a caramel reward sticker.
- **Illustration:** the *Coffee Break* Lottie (`src/assets/coffee-break.json`) is recoloured to the brand palette at load time by `src/lib/recolorLottie.ts`. Edit `COFFEE_BREAK_BRAND_MAP` to retune it.
- **Logo:** `src/components/Logo.tsx` is a placeholder blossom-and-bean mark. Replace it with the official artwork and every screen updates.

## Data

`src/data/store.ts` is a local-first store (localStorage, synced between tabs) seeded with realistic demo data. All reads and writes go through its exported functions, so swapping in a real API is contained to that one file. The admin PIN is a demo lock, not real authentication; use proper staff accounts and server-side checks before going live.
