import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, errore: 'Metodo non consentito' });
  if (!SUPABASE_URL || !SECRET_KEY) return json(res, 500, { ok: false, errore: 'SUPABASE_SECRET_KEY non configurata su Vercel' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { ok: false, errore: 'Sessione mancante' });

  const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(res, 401, { ok: false, errore: 'Sessione non valida' });

  const { data: caller } = await admin.from('istruttori').select('ruolo,attivo,username').eq('auth_user_id', userData.user.id).maybeSingle();
  if (!caller || caller.attivo !== true || caller.ruolo !== 'admin') return json(res, 403, { ok: false, errore: 'Solo Admin può gestire gli utenti' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const action = body.action;

  if (action === 'create') {
    const nome = String(body.nome || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const ruolo = ['admin','istruttore'].includes(body.ruolo) ? body.ruolo : 'istruttore';
    if (!nome || !username || password.length < 6) return json(res, 400, { ok: false, errore: 'Nome, username e password (minimo 6 caratteri) sono obbligatori' });
    if (!/^[a-z0-9._-]+$/.test(username)) return json(res, 400, { ok: false, errore: 'Username non valido' });

    const email = `${username}@acsrescuedog.local`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome, username, ruolo } });
    if (createError) return json(res, 400, { ok: false, errore: createError.message });

    const profilo = { auth_user_id: created.user.id, nome, username, ruolo, attivo: true };
    const { data: inserted, error: insertError } = await admin.from('istruttori').insert(profilo).select('nome,username,ruolo,attivo').single();
    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(res, 400, { ok: false, errore: insertError.message });
    }
    return json(res, 200, { ok: true, profilo: inserted });
  }

  if (action === 'delete') {
    const username = String(body.username || '').trim().toLowerCase();
    if (!username || username === caller.username) return json(res, 400, { ok: false, errore: 'Utente non valido' });
    const { data: profilo, error: profileError } = await admin.from('istruttori').select('id,auth_user_id,username').eq('username', username).maybeSingle();
    if (profileError || !profilo) return json(res, 404, { ok: false, errore: 'Utente non trovato' });
    const { error: deleteProfileError } = await admin.from('istruttori').delete().eq('id', profilo.id);
    if (deleteProfileError) return json(res, 400, { ok: false, errore: deleteProfileError.message });
    if (profilo.auth_user_id) {
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(profilo.auth_user_id);
      if (deleteAuthError) return json(res, 400, { ok: false, errore: deleteAuthError.message });
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { ok: false, errore: 'Azione non valida' });
}
