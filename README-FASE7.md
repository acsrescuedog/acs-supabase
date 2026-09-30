# ACS Fase 7 - Prova, Pacchetti e verifica ingressi

## Ordine installazione
1. Supabase > SQL Editor: eseguire `supabase/FASE7-FLUSSO-PROVA-PACCHETTI.sql`.
2. GitHub: sostituire `src/App.jsx` e `api/drive-upload.js`.
3. GitHub: aggiungere `api/send-package-email.js`.
4. Commit e attendere il deploy Vercel.

## Flusso introdotto
- Home: Lezione di prova / Prenota lezione / Verifica ingressi / Area Staff.
- Nuovo cliente: può prenotare solo un turno il cui tipo contiene `prova` oppure `prima lezione`.
- Utente registrato: la prenotazione ordinaria richiede pacchetto attivo e almeno 1 ingresso.
- La prenotazione NON scala ingressi.
- Admin o Istruttore confermano la presenza: solo allora viene scalato 1 ingresso.
- La lezione di prova non scala ingressi.
- Admin assegna un Pacchetto dalla scheda cane; il sistema invia il link personale via email.
- Utente accetta, carica modulo PDF firmato + ricevuta bonifico.
- Admin verifica e attiva il pacchetto; solo allora gli ingressi diventano disponibili.
- `Carnet` resta come nome tecnico delle vecchie tabelle per compatibilità, ma nell'interfaccia è unificato come `Pacchetto`.
- Istruttore: Anagrafica + Presenze; nessun accesso a prezzi, pagamenti, pacchetti o setup.

## Importante
Per mostrare i turni di prova, l'Admin deve creare almeno una disponibilità con tipo lezione contenente la parola `Prova`, per esempio `Lezione di prova`.

Le variabili Vercel già usate restano le stesse:
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SECRET_KEY
- ACS_DRIVE_RELAY_URL
- ACS_UPLOAD_SECRET
