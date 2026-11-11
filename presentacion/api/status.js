'use strict';
// Función serverless de Vercel: indica si la IA está disponible.
const { KEY, MODEL } = require('../server.js');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ai: !!KEY, model: MODEL });
};
