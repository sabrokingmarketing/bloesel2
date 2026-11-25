# Bloeisel Koffie Loyalty

A mobile-first digital stamp card for Bloeisel Koffie: customers collect a sticker with every coffee and the 10th cup is free. Customers collect stickers by scanning the counter QR by the till. Staff redeem the free coffee (and can add or correct stickers) from the member's page in Admin → Customers. Cards sync across devices through a small API and a Postgres database.

## Run it locally

```bash
npm install
npm run db:seed    # optional: sample café data + a link that opens the demo card
npm run dev        # app + API on http://localhost:5173
npm test           # API integration tests
npm run build      # type-check + production build
```

Locally there's nothing to install: the API uses [PGlite](https://pglite.dev), a real Postgres compiled to WebAssembly, stored in `.data/`. Set `DATABASE_URL` to use a real Postgres instead. The local staff PIN is `1234`.

| Route | What it is |
| --- | --- |
| `/` | Landing page |
| `/app/join` | Create a card (with a 4-digit PIN), or sign in with mobile number + PIN |
| `/app/reset#…` | Opened from the PIN reset email: choose a new PIN |
| `/app` | Customer card, rewards, visit history, profile |
| `/app/qr` | Full-screen pink QR for the barista; updates live |
| `/app/claim#…` | One-time link that moves a card onto this phone |
| `/app/stamp#c=…` | Opened by the counter sticker QR: adds one sticker to this phone's card |
| `/admin` | Staff portal (PIN) |
| `/q/<id>` | Printed campaign QR codes: counts the scan, then redirects |

## Deploy on Vercel

1. Import the repo at vercel.com/new. Vercel detects Vite; keep the defaults.
2. **Storage → Marketplace → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
3. **Settings → Environment Variables:** add `SESSION_SECRET` (run `openssl rand -base64 48`) and `ADMIN_PIN` (4 to 8 digits; 6+ recommended).
   For "Forgot your PIN?" emails, also add `RESEND_API_KEY` (from resend.com, with your domain verified there) and `EMAIL_FROM` (e.g. `Bloeisel <cards@bloeiselkoffie.co.za>`). Without them, the app tells customers to ask their barista instead.
4. Redeploy. Tables are created automatically on the first request.
5. Optional: run `DATABASE_URL=<your Neon URL> npm run db:seed` once to load the sample data.

The deployed app refuses to start without a real database, session secret and admin PIN, so it can never fall back to a throwaway database or a default PIN.

## How it works

- **Frontend:** React + Vite. `src/data/store.ts` is the only file that talks to the API.
- **API:** `server/routes.ts`, served by one Vercel Function (`api/router.ts`) and by the Vite dev server in development. Validation with zod; structured JSON logs with a request ID on every response.
- **Database:** Postgres. Migrations in `server/schema.ts` are append-only and run under an advisory lock.
- **Sync:** the customer's phone polls `/api/me` every 3 seconds while the QR screen is open (15 seconds elsewhere, and immediately when the app comes back into view). Staff screens refresh every 10 seconds.

### Security model

- **Customers** choose a 4-digit PIN (scrypt-hashed; trivial PINs refused) and sign in with mobile number + PIN. Five wrong PINs lock that number for 15 minutes, and a wrong number gets the same reply as a wrong PIN.
- **Staying signed in:** each phone gets a random device token (only its SHA-256 is stored) in an HttpOnly, SameSite=Lax cookie that lasts 120 days after the last visit. Page scripts can't read it.
- **Forgot PIN:** a single-use reset link valid for 30 minutes is emailed to the address on the card. The reply never says whether an address is on a card, the link is built from configuration (not the request's Host header), and completing a reset signs out every other phone.
- **Personal data:** staff screens only ever receive masked email addresses; PIN and token hashes are never sent to any browser; emails, PINs and links are never logged.
- **Headers:** a strict Content-Security-Policy, HSTS and frame blocking are set in `vercel.json` (`server/headers.ts`).
- **Moving a card** uses a one-time link that expires after 15 minutes. The member makes one in **Profile → Move to a new phone**, or a barista makes one at the till (**Customers → Send card to a new phone**). Using the link signs every other phone out, so a lost phone stops working.
- **Staff** sign in with the shop PIN (scrypt-hashed) and get a signed, HttpOnly, SameSite=Strict cookie. A till stays signed in for 30 days after it was last used (renewed at most once a day), and must re-enter the PIN 90 days after signing in however often it's used. **Sign out all other tills** (Settings) ends every other session at once. Five wrong PINs from one network locks it for 15 minutes. Changing the PIN signs out every other till.
- **Till actions** carry an idempotency key, and the card row is locked while it changes. A double tap or a retried request on a bad connection can't add two stickers, and two tills can't race.

### Counter sticker QR

Customers can collect a sticker themselves by scanning one printed QR at the till (Admin → QR Codes → Counter Sticker QR). It carries a random code, and each card can collect at most one counter sticker per visit window (3 hours by default, set on the same panel). A photo of the poster therefore can't be farmed from home for more than one sticker per window. The window can also be set to **No time limit**, where every scan adds a sticker; the panel then shows a warning, because a customer could keep scanning. The printed code itself never expires. If the code leaks, **Replace Code** makes every old print stop working. Counter stickers are marked "Counter QR" in the history. The free coffee is redeemed by staff from Admin → Customers: the customer shows their Rewards screen (name and member code) and staff tap **Redeem reward**. Members can also tap **Redeemed** on their own gold reward card at the counter; the card restarts, the history stays, and the gold card shows the redeemed date for the next 24 hours.

### Backups

Settings → **Export members (CSV)** downloads every member with their stickers, rewards and visit dates (South African time). Emails stay masked and PINs are never included. Neon's free plan only keeps a short restore history, so download a copy every month and keep it somewhere safe.

### Limits worth knowing

- The staff snapshot loads up to 5,000 members and 60 days of activity at once. That's plenty for one café; add pagination before it outgrows that.
- Sync is by polling, not push. A sticker typically appears on the customer's phone within about 3 seconds.
- There's one shared staff PIN, not individual staff accounts, so the activity log doesn't record which barista did what.

## Design system

- **Tokens:** every colour, radius, shadow and motion curve lives in `src/styles/tokens.css`.
- **Type:** Fraunces (display) + Poppins (UI).
- **Stickers:** `src/components/Sticker.tsx`, built on the supplied takeaway-cup icon.
- **Illustration:** the *Coffee Break* Lottie, recoloured to the brand palette by `src/lib/recolorLottie.ts`.
- **Logo:** `src/components/Logo.tsx` is a placeholder; replace it with the official artwork.
