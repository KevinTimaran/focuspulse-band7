'use strict';
// Función serverless de Vercel: misma lógica que POST /api/analyze de server.js.
const { validateInput, callOpenAI, limited, MODEL } = require('../server.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD', message: 'Usa POST.' });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (limited(ip)) return res.status(429).json({ error: 'RATE_LIMIT', message: 'Demasiadas solicitudes; espera un momento.' });
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'BAD_JSON', message: 'JSON inválido.' }); }
    }
    const input = validateInput(body);
    const out = await callOpenAI(input);
    return res.status(200).json({ source: 'openai', model: MODEL, createdAt: Date.now(), ...out });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.code || 'ERROR', message: e.status ? e.message : 'Error interno.' });
  }
};
