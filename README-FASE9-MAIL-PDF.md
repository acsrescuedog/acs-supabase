# ACS Fase 9 - Mail con modulo PDF personalizzato e logo ACS

## Cosa cambia
- Quando l'Admin assegna un pacchetto, la mail contiene:
  - numero pacchetto;
  - pacchetto scelto;
  - ingressi;
  - importo;
  - IBAN e causale suggerita;
  - link per caricare modulo firmato + bonifico;
  - PDF personalizzato allegato.
- Il PDF parte dal modello `MODULO UNICO ISCRIZIONE.pdf`: viene personalizzato con i dati disponibili in Anagrafica e sostituisce il vecchio elenco fisso dei corsi con il pacchetto realmente assegnato.
- Tutto il resto delle condizioni del PDF originale rimane invariato.
- Tutte le mail inviate tramite `api/send-email.js` e la mail pacchetto hanno in fondo logo ACS + `Associazione Cani Salvataggio`.

## File da caricare su GitHub
Sostituire/aggiungere:
- `package.json`
- `api/send-package-email.js`
- `api/send-email.js`
- `public/templates/MODULO-UNICO-ISCRIZIONE.pdf`

Vercel installerà automaticamente la nuova dipendenza `pdf-lib` al deploy.

## Apps Script
Sostituire il codice del progetto `ACS Drive Relay` con:
- `apps-script/ACS-Drive-Relay-v3.gs.txt`

Poi: `Deploy -> Manage deployments -> Edit -> New version -> Deploy`.
L'URL `/exec` e `ACS_UPLOAD_SECRET` non devono cambiare.

## Nessuna query SQL
Questa patch non modifica database, RLS o funzioni Supabase.

## Test
1. Assegnare un pacchetto a un cane con email valida.
2. Verificare che arrivi la mail con logo nel footer.
3. Verificare l'allegato PDF personalizzato.
4. Aprire il link `Completa adesione al pacchetto`.
5. Caricare PDF firmato + bonifico come già previsto.
