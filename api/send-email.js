import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RELAY_URL = process.env.ACS_DRIVE_RELAY_URL;
const RELAY_SECRET = process.env.ACS_UPLOAD_SECRET;

function risposta(res, status, body) {
  return res.status(status).json(body);
}

async function verificaOperatore(admin, token) {
  if (!token) return null;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return null;
  const { data: profilo } = await admin
    .from('istruttori')
    .select('nome,ruolo,attivo')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (!profilo || profilo.attivo !== true || !['admin', 'operatore'].includes(profilo.ruolo)) return null;
  return profilo;
}

function creaMessaggio(tipo, i) {
  const nome = String(i.nome || '').trim();
  const cognome = String(i.cognome || '').trim();
  const persona = `${nome}${cognome ? ` ${cognome}` : ''}`.trim();
  const corso = String(i.corso_selezionato || '').trim();
  const motivo = String(i.motivo_rifiuto || '').trim();

  if (tipo === 'iscrizione_ricevuta') {
    return {
      subject: 'ACS - Iscrizione ricevuta',
      body: `Ciao ${persona},\n\nla tua iscrizione${corso ? ` al corso "${corso}"` : ''} è stata ricevuta.\nRiceverai una mail di conferma dalla segreteria dopo la verifica.\n\nAssociazione Cani Salvataggio`,
    };
  }
  if (tipo === 'iscrizione_approvata') {
    return {
      subject: 'ACS - Iscrizione approvata!',
      body: `Ciao ${persona},\n\nla tua iscrizione${corso ? ` al corso "${corso}"` : ''} è stata approvata!\n\nCi vediamo presto 🐶\nAssociazione Cani Salvataggio`,
    };
  }
  if (tipo === 'iscrizione_rifiutata') {
    return {
      subject: 'ACS - Iscrizione non approvata',
      body: `Ciao ${persona},\n\nla tua iscrizione${corso ? ` al corso "${corso}"` : ''} non è stata approvata.${motivo ? `\n\nMotivo: ${motivo}` : ''}\n\nAssociazione Cani Salvataggio`,
    };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return risposta(res, 405, { ok: false, errore: 'Metodo non consentito' });
  }
  if (!SUPABASE_URL || !SECRET_KEY || !RELAY_URL || !RELAY_SECRET) {
    return risposta(res, 500, { ok: false, errore: 'Configurazione email incompleta sul server' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tipo = String(body.tipo || '');
    const iscrizioneId = String(body.iscrizioneId || '');
    if (!['iscrizione_ricevuta', 'iscrizione_approvata', 'iscrizione_rifiutata'].includes(tipo) || !iscrizioneId) {
      return risposta(res, 400, { ok: false, errore: 'Richiesta email non valida' });
    }

    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (tipo !== 'iscrizione_ricevuta') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const profilo = await verificaOperatore(admin, token);
      if (!profilo) return risposta(res, 401, { ok: false, errore: 'Sessione non valida' });
    }

    const { data: iscrizione, error: iscrizioneError } = await admin
      .from('iscrizioni')
      .select('id,nome,cognome,email,corso_selezionato,stato,motivo_rifiuto')
      .eq('id', iscrizioneId)
      .maybeSingle();
    if (iscrizioneError || !iscrizione) return risposta(res, 404, { ok: false, errore: 'Iscrizione non trovata' });
    if (!iscrizione.email) return risposta(res, 200, { ok: true, skipped: true, motivo: 'Email non presente' });

    const stato = String(iscrizione.stato || '').toLowerCase();
    if (tipo === 'iscrizione_ricevuta' && !stato.includes('attesa')) return risposta(res, 409, { ok: false, errore: 'Stato iscrizione non compatibile' });
    if (tipo === 'iscrizione_approvata' && !stato.includes('approvat')) return risposta(res, 409, { ok: false, errore: 'Iscrizione non approvata' });
    if (tipo === 'iscrizione_rifiutata' && !stato.includes('rifiutat')) return risposta(res, 409, { ok: false, errore: 'Iscrizione non rifiutata' });

    const { error: claimError } = await admin.from('email_eventi').insert({
      iscrizione_id: iscrizioneId,
      tipo,
      destinatario: iscrizione.email,
    });
    if (claimError) {
      if (String(claimError.code) === '23505') return risposta(res, 200, { ok: true, gia_inviata: true });
      return risposta(res, 500, { ok: false, errore: claimError.message });
    }

    const messaggio = creaMessaggio(tipo, iscrizione);
    const relayResponse = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: RELAY_SECRET,
        action: 'sendEmail',
        to: iscrizione.email,
        subject: messaggio.subject,
        body: messaggio.body,
      }),
      redirect: 'follow',
    });

    const testo = await relayResponse.text();
    let relayData = null;
    try { relayData = JSON.parse(testo); } catch (_) {}
    if (!relayResponse.ok || !relayData?.ok) {
      await admin.from('email_eventi').delete().eq('iscrizione_id', iscrizioneId).eq('tipo', tipo);
      return risposta(res, 502, { ok: false, errore: relayData?.errore || 'Invio email non riuscito' });
    }

    return risposta(res, 200, { ok: true });
  } catch (err) {
    return risposta(res, 500, { ok: false, errore: err?.message || 'Errore interno invio email' });
  }
}
