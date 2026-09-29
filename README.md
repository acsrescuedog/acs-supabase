# ACS — Associazione Cani Salvataggio

Frontend dell'app di gestione lezioni, anagrafica e carnet per il campo di
addestramento. React + Vite + Tailwind, pensato per essere ospitato su
Vercel e collegato a un backend Google Apps Script.

## 1. Sviluppo locale

```bash
npm install
npm run dev
```

Apri l'indirizzo che compare in console (di solito `http://localhost:5173`).

## 2. Collegare il backend

In `src/App.jsx`, in cima al file, c'è:

```js
const API_URL = "INSERISCI_QUI_URL_WEB_APP_APPS_SCRIPT"; // placeholder
```

Sostituisci il placeholder con l'URL ottenuto al passo 4 di
`ISTRUZIONI-SETUP.md` (Esegui distribuzione > App web). Poi, nei punti del
codice segnati con un commento `// chiamaAPI_...`, sostituisci la logica
finta (mock) con una vera `fetch(API_URL, ...)`.

## 3. Pubblicare su GitHub

```bash
git init
git add .
git commit -m "Prima versione ACS"
git branch -M main
git remote add origin https://github.com/<tuo-utente>/acs-app.git
git push -u origin main
```

## 4. Deploy su Vercel

1. Vai su [vercel.com](https://vercel.com) e collega il tuo account GitHub
2. "Add New Project" > seleziona il repository `acs-app`
3. Vercel riconosce automaticamente Vite: lascia le impostazioni di default
   (Build Command: `npm run build`, Output Directory: `dist`)
4. Deploy — otterrai un URL tipo `acs-app.vercel.app`

Ad ogni `git push` su `main`, Vercel ripubblica automaticamente la nuova
versione.

## 5. Icone e installazione sulla home

Le icone dell'app (`public/icon-192.png`, `public/icon-512.png`,
`public/favicon.png`) sono già generate dal logo. Se cambi il logo,
sostituisci questi tre file con le stesse dimensioni.

Il banner "Installa ACS" dentro l'app guida già l'utente passo passo
(Android, iPhone Safari, iPhone Chrome) — non serve altro.

## Struttura del progetto

```
├── public/
│   ├── manifest.json      # manifest PWA (nome, icone, colori)
│   ├── icon-192.png
│   ├── icon-512.png
│   └── favicon.png
├── src/
│   ├── App.jsx             # tutta l'app (viste cliente + istruttore)
│   ├── main.jsx             # entry point React
│   └── index.css            # Tailwind
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```
