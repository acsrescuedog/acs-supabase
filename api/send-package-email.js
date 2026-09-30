import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RELAY_URL = process.env.ACS_DRIVE_RELAY_URL;
const RELAY_SECRET = process.env.ACS_UPLOAD_SECRET;

function out(res, status, body) { return res.status(status).json(body); }

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return out(res,405,{ok:false,errore:'Metodo non consentito'}); }
  if (!SUPABASE_URL || !SECRET_KEY || !RELAY_URL || !RELAY_SECRET) return out(res,500,{ok:false,errore:'Configurazione server incompleta'});

  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
    if (!token) return out(res,401,{ok:false,errore:'Sessione non valida'});
    const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth:{persistSession:false,autoRefreshToken:false} });
    const { data:userData, error:userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return out(res,401,{ok:false,errore:'Sessione non valida'});
    const { data:profilo } = await admin.from('istruttori').select('ruolo,attivo').eq('auth_user_id',userData.user.id).maybeSingle();
    if (!profilo || profilo.attivo !== true || profilo.ruolo !== 'admin') return out(res,403,{ok:false,errore:'Solo Admin può inviare la comunicazione del pacchetto'});

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acquistoId = String(body.acquistoId || '');
    if (!acquistoId) return out(res,400,{ok:false,errore:'Pacchetto mancante'});

    const { data:p, error:pe } = await admin.from('acquisti')
      .select('id,numero_pacchetto,cliente_nome,cliente_email,cane_nome,carnet_id,lezioni_totali,adesione_token,stato_pacchetto')
      .eq('id',acquistoId).maybeSingle();
    if (pe || !p) return out(res,404,{ok:false,errore:pe?.message || 'Pacchetto non trovato'});
    const { data:tipo } = await admin.from('carnet').select('nome,prezzo').eq('id',p.carnet_id).maybeSingle();
    if (!p.cliente_email) return out(res,400,{ok:false,errore:'Email cliente mancante'});

    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'acs-supabase.vercel.app').split(',')[0];
    const link = `${proto}://${host}/?pacchetto=${encodeURIComponent(p.adesione_token)}`;
    const prezzo = Number(tipo?.prezzo || 0).toLocaleString('it-IT',{style:'currency',currency:'EUR'});
    const subject = `ACS - Pacchetto #${p.numero_pacchetto} assegnato`;
    const testo = `Ciao ${p.cliente_nome || ''},\n\ndopo la lezione di prova ti è stato assegnato il pacchetto #${p.numero_pacchetto}: ${tipo?.nome || 'Pacchetto ACS'} (${p.lezioni_totali} ingressi).\nImporto: ${prezzo}.\n\nPer confermare l'adesione, caricare il modulo firmato e la ricevuta del bonifico usa questo link:\n${link}\n\nGli ingressi saranno attivati dopo la verifica da parte dell'Admin.\n\nAssociazione Cani Salvataggio`;

    const rr = await fetch(RELAY_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({secret:RELAY_SECRET,action:'sendEmail',to:p.cliente_email,subject,body:testo}),redirect:'follow'});
    const txt = await rr.text(); let rd=null; try{rd=JSON.parse(txt)}catch{}
    if (!rr.ok || !rd?.ok) return out(res,502,{ok:false,errore:rd?.errore || 'Invio email non riuscito'});

    await admin.from('acquisti').update({stato_pacchetto:'in_attesa_adesione',email_pacchetto_inviata_at:new Date().toISOString()}).eq('id',acquistoId);
    return out(res,200,{ok:true,link});
  } catch (err) { return out(res,500,{ok:false,errore:err?.message || 'Errore interno'}); }
}
