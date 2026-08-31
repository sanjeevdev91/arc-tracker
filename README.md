# Arc Tracker

A minimal, premium daily-routine and habit tracker: check off routines, view a color-coded
calendar of your consistency, track streaks, and see your stats — installable as a real PWA
on iPhone and desktop.

## Run it locally

```bash
npm install
npm run dev
```

Open the printed local URL in your browser.

## Deploy it for real (so you can Add to Home Screen)

The easiest free options are **Vercel** or **Netlify** — both auto-detect Vite projects.

**Vercel**
1. Push this folder to a GitHub repo (or run `npx vercel` from inside this folder).
2. Import the repo at vercel.com → it will detect the Vite build automatically → Deploy.
3. You'll get a `https://your-app.vercel.app` URL.

**Netlify**
1. Run `npm run build` (creates a `dist/` folder).
2. Drag the `dist/` folder into netlify.com's "Deploy manually" box, or connect the GitHub repo.

Once deployed to a real HTTPS URL:
- **iPhone**: open the URL in Safari → tap the Share icon → **Add to Home Screen**. Arc Tracker
  will launch full-screen with its own icon, no Safari chrome, and safe-area support for the
  Dynamic Island / home indicator.
- **Desktop**: Chrome/Edge will show an install icon in the address bar for the same
  full standalone experience.

## Data storage — and how to get real cross-device sync

Out of the box, this build saves your routines and history to the browser's `localStorage`.
That means:
- ✅ Your data persists between visits and works fully offline.
- ⚠️ It is **local to that one browser** — checking something off on your iPhone will not
  automatically appear on your desktop, because there's no backend to sync through.

To get true cross-device sync (iPhone ↔ desktop), swap the two `localStorage` calls in
`src/App.jsx` (search for `STORAGE_KEY`) for calls to a small cloud database. The two most
common no-backend-code options:

- **Firebase (Firestore)** — free tier, a few lines of setup, real-time sync across devices
  out of the box.
- **Supabase** — free tier, Postgres-backed, also has simple real-time subscriptions.

Both just require replacing the `localStorage.getItem` / `localStorage.setItem` calls with
`get`/`set` calls against a document keyed by a user ID (e.g. sign in with email/Google via
Firebase Auth, then store each user's `{ routines, logs, darkMode }` object under their UID).
Happy to write that integration for you if you tell me which one you'd like to use.

## Project structure

```
├── index.html          entry HTML with PWA meta tags
├── public/
│   ├── manifest.json    installable app metadata
│   ├── sw.js             offline service worker
│   ├── icon-192.png      app icon
│   ├── icon-512.png      app icon
│   └── apple-touch-icon.png   iOS home screen icon
└── src/
    ├── main.jsx          app entry + service worker registration
    ├── App.jsx           the entire Arc Tracker app
    └── index.css         minimal reset
```
