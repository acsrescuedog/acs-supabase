import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RELAY_URL = process.env.ACS_DRIVE_RELAY_URL;
const RELAY_SECRET = process.env.ACS_UPLOAD_SECRET;
const IBAN = 'IT30A0623004604000015051783';

function out(res, status, body) { return res.status(status).json(body); }

function originFromReq(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'acs-supabase.vercel.app').split(',')[0];
  return `${proto}://${host}`;
}

function pdfSafe(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
}

function euro(value) {
  return Number(value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function wrapText(text, font, size, maxWidth) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) line = trial;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Risorsa non disponibile (${r.status}): ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function generaModuloPersonalizzato({ origin, pacchetto, tipo, cane }) {
  const templateBytes = await fetchBytes(`${origin}/templates/MODULO-UNICO-ISCRIZIONE.pdf`);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const h = page.getHeight();
  const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);

  const drawTop = (x, top, text, size = 9, font = normal) => {
    const value = pdfSafe(text);
    if (!value) return;
    page.drawText(value, { x, y: h - top, size, font, color: black });
  };

  // Scrive i dati sopra una riga pulita, evitando che il testo finisca
  // sopra le etichette o sotto gli underscore del modulo originale.
  const drawField = (x1, x2, lineTop, text, size = 9, font = normal) => {
    const value = pdfSafe(text);
    if (!value) return;
    const lineY = h - lineTop;
    page.drawRectangle({
      x: x1 - 1,
      y: lineY - 2,
      width: (x2 - x1) + 2,
      height: size + 7,
      color: white,
    });
    page.drawLine({
      start: { x: x1, y: lineY },
      end: { x: x2, y: lineY },
      thickness: 0.55,
      color: black,
    });
    const maxWidth = Math.max(10, x2 - x1 - 4);
    let finalSize = size;
    while (finalSize > 7 && font.widthOfTextAtSize(value, finalSize) > maxWidth) finalSize -= 0.5;
    page.drawText(value, { x: x1 + 2, y: lineY + 2, size: finalSize, font, color: black });
  };

  // Dati disponibili dall'anagrafica ACS, allineati esattamente alle righe del modulo.
  drawField(152, 498, 188.5, pacchetto.cliente_nome, 9.5);
  drawField(366, 468, 202.5, cane?.data_nascita_conduttore, 9);
  drawField(444, 529, 244.5, pacchetto.cliente_telefono, 9);
  drawField(198, 379, 258.5, pacchetto.cliente_email, 8.8);

  // Sostituisce il vecchio elenco fisso dei corsi con il pacchetto realmente assegnato.
  const areaTop = 270;
  const areaBottom = 520;
  page.drawRectangle({ x: 54, y: h - areaBottom, width: 490, height: areaBottom - areaTop, color: white });
  drawTop(247, 303, 'CHIEDE', 11, bold);
  drawTop(64, 329, 'di aderire al seguente pacchetto assegnato da ASD Rescue Dog / ACS:', 9.5);

  page.drawRectangle({ x: 64, y: h - 430, width: 466, height: 87, borderColor: black, borderWidth: 0.7 });
  drawTop(79, 369, `PACCHETTO #${pacchetto.numero_pacchetto} - ${tipo?.nome || 'Pacchetto ACS'}`, 11.5, bold);
  drawTop(79, 392, `Ingressi previsti: ${pacchetto.lezioni_totali}`, 9.5);
  drawTop(300, 392, `Importo: EUR ${Number(tipo?.prezzo || 0).toFixed(2).replace('.', ',')}`, 9.5);
  const descLines = wrapText(tipo?.descrizione || '', normal, 8.5, 420).slice(0, 2);
  descLines.forEach((line, i) => drawTop(79, 413 + i * 12, `Descrizione: ${i === 0 ? line : line}`, 8.5));
  drawTop(79, 458, 'Data ____________________', 9);
  drawTop(310, 458, 'Firma ____________________________________', 9);

  drawField(90, 329, 648.5, pacchetto.cane_nome, 9.5);
  drawField(354, 530, 648.5, cane?.razza, 9.5);
  drawField(128, 314, 662.5, cane?.data_nascita_cane, 9);
  drawField(476, 529, 662.5, cane?.sesso, 9);
  drawField(108, 432, 684.5, cane?.microchip, 9);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes).toString('base64');
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
    if (!acquistoId) return out(res, 400, { ok:false, errore:'Pacchetto mancante' });

    const { data:p, error:pe } = await admin.from('acquisti')
      .select('id,numero_pacchetto,cliente_nome,cliente_email,cliente_telefono,cane_nome,carnet_id,lezioni_totali,adesione_token,stato_pacchetto')
      .eq('id', acquistoId)
      .maybeSingle();
    if (pe || !p) return out(res, 404, { ok:false, errore:pe?.message || 'Pacchetto non trovato' });

    const { data:tipo, error:tipoError } = await admin.from('carnet')
      .select('nome,prezzo,numero_lezioni,descrizione')
      .eq('id', p.carnet_id)
      .maybeSingle();
    if (tipoError || !tipo) return out(res, 404, { ok:false, errore:tipoError?.message || 'Tipo pacchetto non trovato' });

    const { data:cane } = await admin.from('anagrafica')
      .select('cane_nome,proprietario_nome,proprietario_email,proprietario_telefono,razza,sesso,microchip,data_nascita_cane,data_nascita_conduttore')
      .eq('cane_nome', p.cane_nome)
      .maybeSingle();

    if (!p.cliente_email) return out(res, 400, { ok:false, errore:'Email cliente mancante' });

    const origin = originFromReq(req);
    const link = `${origin}/?pacchetto=${encodeURIComponent(p.adesione_token)}`;
    const prezzo = euro(tipo.prezzo);
    const causale = `Pacchetto ${p.numero_pacchetto} - ${p.cliente_nome || ''} - ${p.cane_nome || ''}`.trim();
    const subject = `ACS - Pacchetto #${p.numero_pacchetto}: adesione e pagamento`;

    const pdfBase64 = await generaModuloPersonalizzato({ origin, pacchetto:p, tipo, cane });
    const logoBase64 = await caricaLogo(origin);
    const logoSrc = logoBase64 ? 'cid:acslogo' : `${origin}/icon-192.png`;

    const testo = [
      `Ciao ${p.cliente_nome || ''},`,
      '',
      `dopo la lezione di prova ti è stato assegnato il pacchetto #${p.numero_pacchetto}: ${tipo.nome} (${p.lezioni_totali} ingressi).`,
      `Importo: ${prezzo}.`,
      '',
      `Pagamento tramite bonifico - IBAN: ${IBAN}`,
      `Causale consigliata: ${causale}`,
      '',
      'In allegato trovi il modulo personalizzato con il pacchetto assegnato e tutte le condizioni previste.',
      'Firma il modulo, effettua il bonifico e carica sia il PDF firmato sia la ricevuta tramite il link seguente:',
      link,
      '',
      'Gli ingressi saranno attivati dopo la verifica da parte dell\'Admin.',
      '',
      'Associazione Cani Salvataggio'
    ].join('\n');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.55;max-width:640px;margin:auto">
        <p>Ciao <strong>${htmlEscape(p.cliente_nome || '')}</strong>,</p>
        <p>dopo la lezione di prova ti è stato assegnato:</p>
        <div style="border:1px solid #dfe5ea;border-radius:12px;padding:16px;background:#f7f9fb;margin:16px 0">
          <div style="font-size:18px;font-weight:700;color:#173650">Pacchetto #${htmlEscape(p.numero_pacchetto)}</div>
          <div style="font-size:16px;font-weight:700;margin-top:4px">${htmlEscape(tipo.nome)}</div>
          <div style="margin-top:8px">Ingressi: <strong>${Number(p.lezioni_totali || 0)}</strong></div>
          <div>Importo: <strong>${htmlEscape(prezzo)}</strong></div>
        </div>
        <p><strong>Pagamento tramite bonifico</strong><br>IBAN: <strong>${IBAN}</strong><br>Causale consigliata: <strong>${htmlEscape(causale)}</strong></p>
        <p>In allegato trovi il <strong>modulo personalizzato</strong> con il pacchetto assegnato e tutte le condizioni previste. Firmalo, effettua il bonifico e poi carica <strong>PDF firmato + ricevuta del bonifico</strong>.</p>
        <p style="margin:24px 0"><a href="${htmlEscape(link)}" style="background:#173650;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">Completa adesione al pacchetto</a></p>
        <p style="font-size:13px;color:#667085">Gli ingressi saranno attivati solo dopo la verifica da parte dell'Admin.</p>
        <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb">
          <img src="${logoSrc}" alt="ACS" width="84" height="84" style="display:block;margin:0 auto 8px auto;width:84px;height:84px;object-fit:contain">
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
      attachments: [{
        name: `Modulo_adesione_pacchetto_${p.numero_pacchetto}_${pdfSafe(p.cane_nome).replace(/\s+/g,'_') || 'cane'}.pdf`,
        mimeType: 'application/pdf',
        base64: pdfBase64,
      }],
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
      .update({ stato_pacchetto:'in_attesa_adesione', email_pacchetto_inviata_at:new Date().toISOString() })
      .eq('id', acquistoId);

    return out(res, 200, { ok:true, link, modulo_allegato:true });
  } catch (err) {
    return out(res, 500, { ok:false, errore:err?.message || 'Errore interno' });
  }
}
