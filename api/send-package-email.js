import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RELAY_URL = process.env.ACS_DRIVE_RELAY_URL;
const RELAY_SECRET = process.env.ACS_UPLOAD_SECRET;

function out(res, status, body) { return res.status(status).json(body); }

function originFromReq(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'acs-supabase.vercel.app').split(',')[0];
  return `${proto}://${host}`;
}

function euro(value) {
  return Number(value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Risorsa non disponibile (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

async function caricaLogo(origin) {
  try {
    const bytes = await fetchBytes(`${origin}/icon-192.png`);
    return Buffer.from(bytes).toString('base64');
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return out(res, 405, { ok:false, errore:'Metodo non consentito' });
  }
  if (!SUPABASE_URL || !SECRET_KEY || !RELAY_URL || !RELAY_SECRET) {
    return out(res, 500, { ok:false, errore:'Configurazione server incompleta' });
  }

  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return out(res, 401, { ok:false, errore:'Sessione non valida' });

    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth:{ persistSession:false, autoRefreshToken:false } });
    const { data:userData, error:userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return out(res, 401, { ok:false, errore:'Sessione non valida' });

    const { data:profilo } = await admin.from('istruttori')
      .select('ruolo,attivo')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();
    if (!profilo || profilo.attivo !== true || profilo.ruolo !== 'admin') {
      return out(res, 403, { ok:false, errore:'Solo Admin può inviare la comunicazione del pacchetto' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acquistoId = String(body.acquistoId || '');
    const subjectOverride = String(body.subject || '').trim();
    const messageOverride = String(body.message || '').trim();
    if (!acquistoId) return out(res, 400, { ok:false, errore:'Pacchetto mancante' });

    const { data:p, error:pe } = await admin.from('acquisti')
      .select('id,numero_pacchetto,cliente_nome,cliente_email,cane_nome,carnet_id,lezioni_totali')
      .eq('id', acquistoId)
      .maybeSingle();
    if (pe || !p) return out(res, 404, { ok:false, errore:pe?.message || 'Pacchetto non trovato' });

    const { data:tipo, error:tipoError } = await admin.from('carnet')
      .select('nome,prezzo,numero_lezioni')
      .eq('id', p.carnet_id)
      .maybeSingle();
    if (tipoError || !tipo) return out(res, 404, { ok:false, errore:tipoError?.message || 'Tipo pacchetto non trovato' });
    if (!p.cliente_email) return out(res, 400, { ok:false, errore:'Email cliente mancante in anagrafica' });

    const origin = originFromReq(req);
    const linkPrenota = `${origin}/?view=cliente`;
    const prezzo = euro(tipo.prezzo);
    const subject = subjectOverride || `ACS - Attribuzione pacchetto #${p.numero_pacchetto}`;
    const messaggio = messageOverride || `Ciao ${p.cliente_nome || ''},\n\nla Segreteria ACS ti comunica che è stato attribuito a ${p.cane_nome || 'il tuo cane'} il pacchetto "${tipo.nome}" di ${p.lezioni_totali} lezioni.\n\nPuoi prenotare le lezioni disponibili tramite il link indicato nella comunicazione.\n\nAssociazione Cani Salvataggio`;
    const messaggioHtml = htmlEscape(messaggio).replace(/\n/g, '<br>');

    const logoBase64 = await caricaLogo(origin);
    const logoSrc = logoBase64 ? 'cid:acslogo' : `${origin}/icon-192.png`;

    const testo = [
      messaggio,
      '',
      `Pacchetto: ${tipo.nome}`,
      `Lezioni: ${p.lezioni_totali}`,
      `Prezzo: ${prezzo}`,
      '',
      'Prenota una lezione:',
      linkPrenota,
      '',
      'Associazione Cani Salvataggio'
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:680px;margin:0;text-align:left">
        <div style="margin:0 0 18px 0">${messaggioHtml}</div>
        <div style="border:1px solid #dfe5ea;border-radius:12px;padding:16px;background:#f7f9fb;margin:16px 0;max-width:600px">
          <div style="font-size:18px;font-weight:700;color:#173650">${htmlEscape(tipo.nome)}</div>
          <div style="margin-top:8px">Lezioni: <strong>${Number(p.lezioni_totali || 0)}</strong></div>
          <div>Prezzo: <strong>${htmlEscape(prezzo)}</strong></div>
        </div>
        <div style="margin:22px 0">
          <a href="${htmlEscape(linkPrenota)}" style="background:#173650;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">Prenota una lezione</a>
        </div>
        <div style="margin-top:30px;padding-top:18px;border-top:1px solid #e5e7eb;text-align:left">
          <img src="${logoSrc}" alt="ACS" width="74" height="74" style="display:block;margin:0 0 8px 0;width:74px;height:74px;object-fit:contain">
          <div style="font-weight:700;color:#173650">Associazione Cani Salvataggio</div>
        </div>
      </div>`;

    const payload = {
      secret: RELAY_SECRET,
      action: 'sendEmail',
      to: p.cliente_email,
      subject,
      body: testo,
      htmlBody,
      inlineImages: logoBase64 ? [{ cid:'acslogo', name:'acslogo.png', mimeType:'image/png', base64:logoBase64 }] : [],
    };

    const rr = await fetch(RELAY_URL, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body:JSON.stringify(payload),
      redirect:'follow'
    });
    const txt = await rr.text();
    let rd = null;
    try { rd = JSON.parse(txt); } catch (_) {}
    if (!rr.ok || !rd?.ok) return out(res, 502, { ok:false, errore:rd?.errore || 'Invio email non riuscito' });

    await admin.from('acquisti')
      .update({ email_pacchetto_inviata_at:new Date().toISOString() })
      .eq('id', acquistoId);

    return out(res, 200, { ok:true, link_prenotazione:linkPrenota });
  } catch (err) {
    return out(res, 500, { ok:false, errore:err?.message || 'Errore interno' });
  }
}
