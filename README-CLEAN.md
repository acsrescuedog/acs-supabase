# ACS Clean - Supabase + Vercel + Google Drive

Versione completa ricostruita dalla base ACS, senza le patch temporanee applicate durante il debug.

## 1. GitHub
Sostituire il contenuto della repository con TUTTO il contenuto di questa cartella. `package.json` deve stare nella root.

## 2. Variabili Vercel già previste
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ACS_ADMIN_EMAIL`
- `SUPABASE_SECRET_KEY`
- `ACS_DRIVE_RELAY_URL`
- `ACS_UPLOAD_SECRET`

Non mettere mai `SUPABASE_SECRET_KEY` o `ACS_UPLOAD_SECRET` nel frontend o in GitHub.

## 3. Supabase
Sul progetto esistente eseguire una sola volta `supabase/FINAL-CLEAN.sql` per riallineare helper Auth e RPC dopo i test precedenti.

## 4. Google Apps Script
Usare `apps-script/ACS-Drive-Relay-v2.gs.txt` come codice del relay. Conservare la Script Property `ACS_UPLOAD_SECRET` e pubblicare come Web App eseguita dall'account ACS.

## 5. Test
1. Login `admin`.
2. Creare una scheda in Anagrafica.
3. Creare/cancellare un corso.
4. Eseguire un'iscrizione pubblica.
5. Approvare l'iscrizione e verificare Anagrafica + carnet/acquisto.
6. Verificare email e ricevuta Drive.

## Nota Auth
La sessione usa il flusso standard Supabase (`signInWithPassword`, `persistSession`, `autoRefreshToken`). Non vengono copiati o gestiti manualmente access/refresh token nel frontend.
