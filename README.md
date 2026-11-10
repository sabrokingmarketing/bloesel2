# Bloeisel Koffie Loyalty

A mobile-first digital stamp card for Bloeisel Koffie: customers collect a sticker with every coffee and the 10th cup is free. Staff scan the customer's pink QR code at the till to add stickers and redeem rewards. Cards sync across devices through a small API and a Postgres database.

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
| `/app/join` | Create a card, or learn how to move an existing one |
| `/app` | Customer card, rewards, visit history, profile |
| `/app/qr` | Full-screen pink QR for the barista; updates live |
| `/app/claim#…` | One-time link that moves a card onto this phone |
| `/admin` | Staff portal (PIN) |
| `/q/<id>` | Printed campaign QR codes: counts the scan, then redirects |

## Deploy on Vercel

1. Import the repo at vercel.com/new. Vercel detects Vite; keep the defaults.
2. **Storage → Marketplace → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
3. **Settings → Environment Variables:** add `SESSION_SECRET` (run `openssl rand -base64 48`) and `ADMIN_PIN` (4 to 8 digits; 6+ recommended).
4. Redeploy. Tables are created automatically on the first request.
5. Optional: run `DATABASE_URL=<your Neon URL> npm run db:seed` once to load the sample data.

The deployed app refuses to start without a real database, session secret and admin PIN, so it can never fall back to a throwaway database or a default PIN.

## How it works

- **Frontend:** React + Vite. `src/data/store.ts` is the only file that talks to the API.
- **API:** `server/routes.ts`, served by one Vercel Function (`api/router.ts`) and by the Vite dev server in development. Validation with zod; structured JSON logs with a request ID on every response.
- **Database:** Postgres. Migrations in `server/schema.ts` are append-only and run under an advisory lock.
- **Sync:** the customer's phone polls `/api/me` every 3 seconds while the QR screen is open (15 seconds elsewhere, and immediately when the app comes back into view). Staff screens refresh every 10 seconds.

### Security model

- **Customers** don't have passwords. Joining issues a random device token (only its SHA-256 is stored), so a card lives on the phone that created it. A phone number alone can never open someone's card.
- **Moving a card** uses a one-time link that expires after 15 minutes. The member makes one in **Profile → Move to a new phone**, or a barista makes one at the till (**Customers → Send card to a new phone**). Using the link signs every other phone out, so a lost phone stops working.
- **Staff** sign in with the shop PIN (scrypt-hashed) and get a signed, HttpOnly, SameSite=Strict cookie for 12 hours. Five wrong PINs from one network locks it for 15 minutes. Changing the PIN signs out every other till.
- **Till actions** carry an idempotency key, and the card row is locked while it changes. A double tap or a retried request on a bad connection can't add two stickers, and two tills can't race.

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
