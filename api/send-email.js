import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RELAY_URL = process.env.ACS_DRIVE_RELAY_URL;
const RELAY_SECRET = process.env.ACS_UPLOAD_SECRET;

function risposta(res, status, body) { return res.status(status).json(body); }
function htmlEscape(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function originFromReq(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'acs-supabase.vercel.app').split(',')[0];
  return `${proto}://${host}`;
}
async function fetchLogo(origin) {
  try {
    const r = await fetch(`${origin}/icon-192.png`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch (_) { return null; }
}
async function verificaOperatore(admin, token) {
  if (!token) return null;
  const { data:userData, error:userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return null;
  const { data:profilo } = await admin.from('istruttori').select('nome,ruolo,attivo').eq('auth_user_id',userData.user.id).maybeSingle();
  if (!profilo || profilo.attivo !== true || !['admin','istruttore','operatore'].includes(profilo.ruolo)) return null;
  return profilo;
}
function creaMessaggio(tipo, i) {
  const nome = String(i.nome || '').trim();
  const cognome = String(i.cognome || '').trim();
  const persona = `${nome}${cognome ? ` ${cognome}` : ''}`.trim();
  const corso = String(i.corso_selezionato || '').trim();
  const motivo = String(i.motivo_rifiuto || '').trim();
  if (tipo === 'iscrizione_ricevuta') return { subject:'ACS - Registrazione ricevuta', body:`Ciao ${persona},\n\nla tua richiesta è stata ricevuta.\nRiceverai una comunicazione dalla segreteria dopo la verifica.\n\nAssociazione Cani Salvataggio`, intro:`Ciao <strong>${htmlEscape(persona)}</strong>,`, contenuto:'la tua richiesta è stata ricevuta. Riceverai una comunicazione dalla segreteria dopo la verifica.' };
  if (tipo === 'iscrizione_approvata') return { subject:'ACS - Registrazione approvata!', body:`Ciao ${persona},\n\nla tua registrazione${corso ? ` per "${corso}"` : ''} è stata approvata.\n\nCi vediamo presto!\nAssociazione Cani Salvataggio`, intro:`Ciao <strong>${htmlEscape(persona)}</strong>,`, contenuto:`la tua registrazione${corso ? ` per <strong>${htmlEscape(corso)}</strong>` : ''} è stata approvata.` };
  if (tipo === 'iscrizione_rifiutata') return { subject:'ACS - Registrazione non approvata', body:`Ciao ${persona},\n\nla tua registrazione non è stata approvata.${motivo ? `\n\nMotivo: ${motivo}` : ''}\n\nAssociazione Cani Salvataggio`, intro:`Ciao <strong>${htmlEscape(persona)}</strong>,`, contenuto:`la tua registrazione non è stata approvata.${motivo ? `<br><br><strong>Motivo:</strong> ${htmlEscape(motivo)}` : ''}` };
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return risposta(res,405,{ok:false,errore:'Metodo non consentito'}); }
  if (!SUPABASE_URL || !SECRET_KEY || !RELAY_URL || !RELAY_SECRET) return risposta(res,500,{ok:false,errore:'Configurazione email incompleta sul server'});
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tipo = String(body.tipo || '');
    const iscrizioneId = String(body.iscrizioneId || '');
    if (!['iscrizione_ricevuta','iscrizione_approvata','iscrizione_rifiutata'].includes(tipo) || !iscrizioneId) return risposta(res,400,{ok:false,errore:'Richiesta email non valida'});
    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth:{persistSession:false,autoRefreshToken:false} });
    if (tipo !== 'iscrizione_ricevuta') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
      const profilo = await verificaOperatore(admin, token);
      if (!profilo) return risposta(res,401,{ok:false,errore:'Sessione non valida'});
    }
    const { data:iscrizione, error:iscrizioneError } = await admin.from('iscrizioni').select('id,nome,cognome,email,corso_selezionato,stato,motivo_rifiuto').eq('id',iscrizioneId).maybeSingle();
    if (iscrizioneError) return risposta(res,500,{ok:false,errore:iscrizioneError.message});
    if (!iscrizione) return risposta(res,404,{ok:false,errore:'Iscrizione non trovata'});
    if (!iscrizione.email) return risposta(res,200,{ok:true,skipped:true,motivo:'Email non presente'});
    const stato = String(iscrizione.stato || '').toLowerCase();
    if (tipo === 'iscrizione_ricevuta' && !stato.includes('attesa')) return risposta(res,409,{ok:false,errore:'Stato iscrizione non compatibile'});
    if (tipo === 'iscrizione_approvata' && !stato.includes('approvat')) return risposta(res,409,{ok:false,errore:'Iscrizione non approvata'});
    if (tipo === 'iscrizione_rifiutata' && !stato.includes('rifiutat')) return risposta(res,409,{ok:false,errore:'Iscrizione non rifiutata'});
    const { error:claimError } = await admin.from('email_eventi').insert({ iscrizione_id:iscrizioneId, tipo, destinatario:iscrizione.email });
    if (claimError) {
      if (String(claimError.code) === '23505') return risposta(res,200,{ok:true,gia_inviata:true});
      return risposta(res,500,{ok:false,errore:claimError.message});
    }
    const msg = creaMessaggio(tipo, iscrizione);
    const origin = originFromReq(req);
    const logo = await fetchLogo(origin);
    const logoSrc = logo ? 'cid:acslogo' : `${origin}/icon-192.png`;
    const htmlBody = `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px;margin:auto"><p>${msg.intro}</p><p>${msg.contenuto}</p><div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb"><img src="${logoSrc}" alt="ACS" width="84" height="84" style="display:block;margin:0 auto 8px auto;width:84px;height:84px;object-fit:contain"><div style="font-weight:700;color:#173650">Associazione Cani Salvataggio</div></div></div>`;
    const relayResponse = await fetch(RELAY_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({secret:RELAY_SECRET,action:'sendEmail',to:iscrizione.email,subject:msg.subject,body:msg.body,htmlBody,inlineImages:logo?[{name:'acslogo',mimeType:'image/png',base64:logo}]:[]}),redirect:'follow'});
    const testo = await relayResponse.text(); let relayData=null; try{relayData=JSON.parse(testo)}catch{}
    if (!relayResponse.ok || !relayData?.ok) {
      await admin.from('email_eventi').delete().eq('iscrizione_id',iscrizioneId).eq('tipo',tipo);
      return risposta(res,502,{ok:false,errore:relayData?.errore || 'Invio email non riuscito'});
    }
    return risposta(res,200,{ok:true});
  } catch (err) { return risposta(res,500,{ok:false,errore:err?.message || 'Errore interno invio email'}); }
}
