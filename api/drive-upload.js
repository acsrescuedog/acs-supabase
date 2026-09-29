const MAX_DATA_URL_CHARS = 3_700_000; // ~2.7 MB binari + overhead JSON
const MIME_CONSENTITI = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, errore: 'Metodo non consentito' });
  }

  const relayUrl = process.env.ACS_DRIVE_RELAY_URL;
  const secret = process.env.ACS_UPLOAD_SECRET;
  if (!relayUrl || !secret) {
    return res.status(500).json({ ok: false, errore: 'Configurazione Drive incompleta sul server' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const fileBase64 = String(body.fileBase64 || '');
    const nomeFile = String(body.nomeFile || 'ricevuta').slice(0, 180);
    const mimeType = String(body.mimeType || '');

    if (!fileBase64 || !mimeType || !MIME_CONSENTITI.has(mimeType)) {
      return res.status(400).json({ ok: false, errore: 'File o formato non valido' });
    }
    if (!fileBase64.startsWith(`data:${mimeType};base64,`)) {
      return res.status(400).json({ ok: false, errore: 'Contenuto file non valido' });
    }
    if (fileBase64.length > MAX_DATA_URL_CHARS) {
      return res.status(413).json({ ok: false, errore: 'File troppo grande. Limite consigliato: circa 2,5 MB.' });
    }

    const risposta = await fetch(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret,
        action: 'uploadFile',
        tipo: 'ricevute',
        nomeFile,
        mimeType,
        fileBase64,
      }),
      redirect: 'follow',
    });

    const testo = await risposta.text();
    let dati;
    try {
      dati = JSON.parse(testo);
    } catch {
      return res.status(502).json({ ok: false, errore: 'Risposta non valida dal relay Google Drive' });
    }

    if (!risposta.ok || !dati?.ok) {
      return res.status(502).json({ ok: false, errore: dati?.errore || 'Upload su Google Drive non riuscito' });
    }

    return res.status(200).json({
      ok: true,
      fileId: dati.fileId,
      nome: dati.nome,
      url: dati.url,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, errore: err?.message || 'Errore interno upload' });
  }
}
