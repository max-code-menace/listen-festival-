'use strict';
// Serveur du Plan Listen : un groupe de potes (10 max) qui partagent messages,
// positions et « J'y vais ». Aucune dépendance : Node 20+ suffit.
// Temps réel par SSE (le navigateur reçoit les nouveautés tout seul).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLORS = ['#f5b800', '#57c4d1', '#ff6b6b', '#7bd36b', '#c08bff', '#ff9f4a', '#4f8dff', '#ff7ac6', '#b8c23a', '#e8e8e8'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self' https://routing.openstreetmap.de",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const now = () => Date.now();
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function createApp(opts = {}) {
  const code = String(opts.code ?? process.env.GROUP_CODE ?? '').trim();
  if (!code) throw new Error('GROUP_CODE manquant');
  const dataFile = 'dataFile' in opts ? opts.dataFile : (process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json')); // null = pas de fichier (tests)
  const maxMembers = opts.maxMembers ?? (Number(process.env.MAX_MEMBERS) || 10);
  const publicDir = path.join(__dirname, 'public');
  const codeHash = sha(code.toLowerCase());

  // ---------- Base : un simple fichier JSON, largement suffisant pour 10 personnes ----------
  let db = { seq: 0, members: {}, messages: [] };
  try { if (dataFile) db = { ...db, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; } catch (e) { /* première fois */ }
  let timer = null;
  function save() {
    if (!dataFile || timer) return;
    timer = setTimeout(flush, 400);
    timer.unref?.();
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!dataFile) return;
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, dataFile);
    } catch (e) { console.error('Sauvegarde impossible :', e.message); }
  }

  // ---------- Clients connectés (SSE) ----------
  const streams = new Map(); // memberId -> Set(res)
  const online = id => (streams.get(id)?.size ?? 0) > 0;
  function view(m) {
    return { id: m.id, pseudo: m.pseudo, color: m.color, stars: m.stars || [], online: online(m.id), sharing: !!m.sharing && !!m.pos, pos: m.sharing ? m.pos : null };
  }
  function write(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  function broadcast(event, data) {
    for (const set of streams.values()) for (const res of set) write(res, event, data);
  }
  const announce = m => broadcast('member', view(m));

  // ---------- Limites anti-abus ----------
  const hits = new Map();
  function limited(key, max, perMs) {
    const t = now(), arr = (hits.get(key) || []).filter(x => t - x < perMs);
    arr.push(t); hits.set(key, arr);
    return arr.length > max;
  }
  const sweep = setInterval(() => { const t = now(); for (const [k, a] of hits) if (!a.some(x => t - x < 60e3)) hits.delete(k); }, 60e3);
  sweep.unref?.();

  // ---------- Utilitaires HTTP ----------
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  const fail = (res, status, error) => json(res, status, { error });
  function body(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > 10_000) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('JSON invalide')); } });
      req.on('error', reject);
    });
  }
  function auth(req, url) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
    if (!token) return null;
    const th = sha(token);
    for (const m of Object.values(db.members)) if (m.tokenHash && crypto.timingSafeEqual(Buffer.from(m.tokenHash, 'hex'), th)) return m;
    return null;
  }
  const ip = req => req.socket.remoteAddress || '?';

  function addMessage(m, msg) {
    const out = { id: ++db.seq, t: now(), from: m.id, pseudo: m.pseudo, color: m.color, kind: 'text', text: '', ...msg };
    db.messages.push(out);
    if (db.messages.length > 500) db.messages.splice(0, db.messages.length - 500);
    save();
    broadcast('msg', out);
    return out;
  }

  // ---------- Routes de l'API ----------
  async function api(req, res, url) {
    const route = req.method + ' ' + url.pathname;

    if (route === 'POST /api/join') {
      if (limited('join:' + ip(req), 12, 60e3)) return fail(res, 429, 'Trop d’essais. Attendez une minute.');
      const b = await body(req);
      if (!crypto.timingSafeEqual(sha(String(b.code ?? '').trim().toLowerCase()), codeHash)) return fail(res, 403, 'Code du groupe incorrect.');
      const pseudo = clean(b.pseudo, 16);
      if (pseudo.length < 1) return fail(res, 400, 'Choisissez un pseudo.');
      const color = COLORS.includes(b.color) ? b.color : COLORS[0];
      let m = Object.values(db.members).find(x => x.pseudo.toLowerCase() === pseudo.toLowerCase());
      if (!m) {
        if (Object.keys(db.members).length >= maxMembers) return fail(res, 403, 'Le groupe est complet.');
        m = { id: crypto.randomBytes(6).toString('hex'), pseudo, color, stars: [], pos: null, sharing: false };
        db.members[m.id] = m;
      } else {
        m.color = color; // reprendre son pseudo sur un autre téléphone
      }
      const token = crypto.randomBytes(24).toString('hex');
      m.tokenHash = sha(token).toString('hex');
      save(); announce(m);
      return json(res, 200, { token, me: view(m) });
    }

    const me = auth(req, url);
    if (!me) return fail(res, 401, 'Connexion expirée.');

    if (route === 'GET /api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      if (!streams.has(me.id)) streams.set(me.id, new Set());
      streams.get(me.id).add(res);
      write(res, 'state', { me: me.id, members: Object.values(db.members).map(view), messages: db.messages.slice(-200), now: now() });
      announce(me);
      const beat = setInterval(() => res.write(': ping\n\n'), 25e3);
      req.on('close', () => {
        clearInterval(beat);
        streams.get(me.id)?.delete(res);
        if (!online(me.id)) { streams.delete(me.id); announce(me); }
      });
      return;
    }

    if (route === 'POST /api/pos') {
      if (limited('pos:' + me.id, 90, 60e3)) return fail(res, 429, 'Trop de positions envoyées.');
      const b = await body(req);
      if (b.sharing === false) { me.sharing = false; save(); announce(me); return json(res, 200, { ok: true }); }
      if (!num(b.lat, -90, 90) || !num(b.lng, -180, 180)) return fail(res, 400, 'Position invalide.');
      me.pos = { lat: b.lat, lng: b.lng, acc: num(b.acc, 0, 100000) ? Math.round(b.acc) : null, t: now() };
      me.sharing = true;
      save(); announce(me);
      return json(res, 200, { ok: true });
    }

    if (route === 'POST /api/msg') {
      if (limited('msg:' + me.id, 25, 60e3)) return fail(res, 429, 'Doucement, trop de messages.');
      const b = await body(req);
      const text = clean(b.text, 400);
      const kind = ['text', 'rdv'].includes(b.kind) ? b.kind : 'text';
      if (!text) return fail(res, 400, 'Message vide.');
      const extra = {};
      if (kind === 'rdv') {
        if (!num(b.lat, -90, 90) || !num(b.lng, -180, 180)) return fail(res, 400, 'Point de rendez-vous invalide.');
        extra.lat = b.lat; extra.lng = b.lng;
      }
      return json(res, 200, addMessage(me, { kind, text, ...extra }));
    }

    if (route === 'POST /api/stars') {
      const b = await body(req);
      if (!Array.isArray(b.stars) || b.stars.length > 300) return fail(res, 400, 'Liste invalide.');
      me.stars = [...new Set(b.stars.filter(s => typeof s === 'string' && s.length <= 120))];
      save(); announce(me);
      return json(res, 200, { ok: true });
    }

    if (route === 'POST /api/leave') {
      delete db.members[me.id];
      for (const res2 of streams.get(me.id) || []) res2.end();
      streams.delete(me.id);
      save(); broadcast('gone', { id: me.id });
      return json(res, 200, { ok: true });
    }

    return fail(res, 404, 'Introuvable.');
  }

  // ---------- Fichiers du site ----------
  function serve(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Méthode non permise.');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return fail(res, 403, 'Interdit.');
    fs.readFile(file, (err, data) => {
      if (err) return fail(res, 404, 'Page introuvable.');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': rel.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', CSP);
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serve(req, res, url);
    } catch (e) {
      if (!res.headersSent) fail(res, 400, e.message === 'trop gros' ? 'Message trop gros.' : 'Requête invalide.');
      else res.end();
    }
  });
  server.close = (orig => function (...a) { flush(); for (const set of streams.values()) for (const r of set) r.end(); return orig.apply(this, a); })(server.close);
  return { server, flush };
}

module.exports = { createApp, COLORS };

if (require.main === module) {
  const production = process.env.NODE_ENV === 'production';
  if (!process.env.GROUP_CODE && production) {
    console.error('GROUP_CODE est obligatoire en production (le code que vous donnez à vos potes).');
    process.exit(1);
  }
  if (!process.env.GROUP_CODE) process.env.GROUP_CODE = 'listen';
  const { server, flush } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    console.log(`Plan Listen sur http://localhost:${port}`);
    console.log(`Code du groupe : ${process.env.GROUP_CODE}${process.env.GROUP_CODE === 'listen' ? '  (valeur de test : changez-la avec GROUP_CODE)' : ''}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
}
