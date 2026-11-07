'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server.js');

async function start(opts = {}) {
  const { server } = createApp({ code: 'Secret42', dataFile: null, ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const join = async (pseudo, code = 'secret42') => (await call('POST', '/api/join', { code, pseudo, color: '#57c4d1' }));
  // Ouvre le flux temps réel et renvoie les événements reçus
  const listen = token => new Promise(resolve => {
    const events = [];
    const req = http.get(base + '/api/events?token=' + token, res => {
      let buf = '';
      res.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(chunk), data = /data: (.*)/.exec(chunk);
          if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve({ events, close: () => req.destroy() });
    });
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  return { server, base, call, join, listen, wait, stop: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

test('refuse un mauvais code et accepte le bon (sans tenir compte des majuscules)', async () => {
  const t = await start();
  assert.equal((await t.join('Léa', 'faux')).status, 403);
  const ok = await t.join('Léa');
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token.length >= 32);
  assert.equal(ok.body.me.pseudo, 'Léa');
  await t.stop();
});

test('pseudo vide refusé, pseudo existant repris, groupe limité', async () => {
  const t = await start({ maxMembers: 2 });
  assert.equal((await t.join('   ')).status, 400);
  const a = await t.join('Max');
  const a2 = await t.join('max');            // même pseudo : on reprend sa place
  assert.equal(a2.body.me.id, a.body.me.id);
  assert.notEqual(a2.body.token, a.body.token);
  assert.equal((await t.join('Zoé')).status, 200);
  assert.equal((await t.join('Tom')).status, 403); // complet
  await t.stop();
});

test('pas de connexion sans jeton valide', async () => {
  const t = await start();
  assert.equal((await t.call('POST', '/api/msg', { text: 'salut' })).status, 401);
  assert.equal((await t.call('POST', '/api/msg', { text: 'salut' }, 'nimportequoi')).status, 401);
  assert.equal((await fetch(t.base + '/api/events?token=faux')).status, 401);
  await t.stop();
});

test('un message arrive en direct chez les autres, avec l’auteur', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  const feed = await t.listen(b.body.token);
  await t.wait(100);
  assert.equal(feed.events[0].event, 'state');
  const r = await t.call('POST', '/api/msg', { text: '  On se retrouve   au Fuse ?  ' }, a.body.token);
  assert.equal(r.status, 200);
  await t.wait(100);
  const msg = feed.events.find(e => e.event === 'msg');
  assert.equal(msg.data.text, 'On se retrouve au Fuse ?');
  assert.equal(msg.data.pseudo, 'Max');
  feed.close(); await t.stop();
});

test('messages invalides refusés (vide, rendez-vous sans position)', async () => {
  const t = await start();
  const a = await t.join('Max');
  assert.equal((await t.call('POST', '/api/msg', { text: '   ' }, a.body.token)).status, 400);
  assert.equal((await t.call('POST', '/api/msg', { text: 'RDV', kind: 'rdv' }, a.body.token)).status, 400);
  const ok = await t.call('POST', '/api/msg', { text: 'RDV ici', kind: 'rdv', lat: 50.84, lng: 4.35 }, a.body.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.lat, 50.84);
  await t.stop();
});

test('la position n’est visible que si le partage est actif, et se coupe', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  assert.equal((await t.call('POST', '/api/pos', { lat: 200, lng: 4 }, a.body.token)).status, 400);
  await t.call('POST', '/api/pos', { lat: 50.846, lng: 4.357, acc: 12.4 }, a.body.token);
  const feed = await t.listen(b.body.token);
  await t.wait(100);
  const max = feed.events[0].data.members.find(m => m.pseudo === 'Max');
  assert.equal(max.sharing, true);
  assert.equal(max.pos.lat, 50.846);
  await t.call('POST', '/api/pos', { sharing: false }, a.body.token);
  await t.wait(100);
  const last = feed.events.filter(e => e.event === 'member' && e.data.pseudo === 'Max').pop();
  assert.equal(last.data.sharing, false);
  assert.equal(last.data.pos, null);
  feed.close(); await t.stop();
});

test('« J’y vais » est partagé et nettoyé', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  const feed = await t.listen(b.body.token);
  await t.wait(50);
  await t.call('POST', '/api/stars', { stars: ['fuse|MCR-T', 'fuse|MCR-T', 42, 'nord|Tiga'] }, a.body.token);
  await t.wait(100);
  const last = feed.events.filter(e => e.event === 'member' && e.data.pseudo === 'Max').pop();
  assert.deepEqual(last.data.stars, ['fuse|MCR-T', 'nord|Tiga']);
  feed.close(); await t.stop();
});

test('quitter le groupe libère la place', async () => {
  const t = await start({ maxMembers: 1 });
  const a = await t.join('Max');
  assert.equal((await t.join('Zoé')).status, 403);
  assert.equal((await t.call('POST', '/api/leave', {}, a.body.token)).status, 200);
  assert.equal((await t.join('Zoé')).status, 200);
  await t.stop();
});

test('sert le site et refuse de sortir du dossier public', async () => {
  const t = await start();
  const home = await fetch(t.base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  const raw = await new Promise(res => {
    const req = http.request({ host: '127.0.0.1', port: t.server.address().port, path: '/..%2fserver.js', method: 'GET' }, r => res(r.statusCode));
    req.end();
  });
  assert.ok([403, 404].includes(raw));
  await t.stop();
});

test('/healthz répond pour l’hébergeur', async () => {
  const t = await start();
  const r = await fetch(t.base + '/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  await t.stop();
});

test('en production : HTTPS imposé ; derrière un proxy, chaque visiteur a sa propre limite d’essais', async () => {
  const t = await start({ secure: true, trustProxy: true });
  assert.match((await fetch(t.base + '/')).headers.get('strict-transport-security'), /max-age=/);
  const essai = (adresse, code) => fetch(t.base + '/api/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': adresse },
    body: JSON.stringify({ code, pseudo: 'X' + Math.random().toString(36).slice(2, 6) }),
  }).then(r => r.status);
  for (let i = 0; i < 12; i++) assert.equal(await essai('1.1.1.1', 'faux'), 403);
  assert.equal(await essai('1.1.1.1', 'faux'), 429);        // le 13e essai du même visiteur est bloqué
  assert.equal(await essai('2.2.2.2', 'secret42'), 200);     // un autre visiteur n’est pas touché
  await t.stop();
});

test('sans proxy de confiance, un en-tête X-Forwarded-For ne contourne pas la limite', async () => {
  const t = await start({ secure: false, trustProxy: false });
  const essai = adresse => fetch(t.base + '/api/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': adresse },
    body: JSON.stringify({ code: 'faux', pseudo: 'Z' }),
  }).then(r => r.status);
  for (let i = 0; i < 12; i++) await essai('9.9.9.' + i);
  assert.equal(await essai('8.8.8.8'), 429);
  await t.stop();
});

test('statut rapide : accepté, visible par les autres, effaçable, inconnu refusé', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  const feed = await t.listen(b.body.token);
  await t.wait(50);
  assert.equal((await t.call('POST', '/api/status', { status: 'Au bar' }, a.body.token)).status, 200);
  await t.wait(80);
  assert.equal(feed.events.filter(e => e.event === 'member' && e.data.pseudo === 'Max').pop().data.status, 'Au bar');
  assert.equal((await t.call('POST', '/api/status', { status: 'Je vole' }, a.body.token)).status, 400);
  await t.call('POST', '/api/status', { status: null }, a.body.token);
  await t.wait(80);
  assert.equal(feed.events.filter(e => e.event === 'member' && e.data.pseudo === 'Max').pop().data.status, null);
  feed.close(); await t.stop();
});

test('les statuts du site et du serveur sont identiques', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const site = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'data.js'), 'utf8') + '\nSTATUS');
  assert.deepEqual([...site], [...require('../server.js').STATUSES]);
});

test('« je suis ici » : message avec position accepté, sans position refusé', async () => {
  const t = await start();
  const a = await t.join('Max');
  const ok = await t.call('POST', '/api/msg', { text: 'Je suis perdu', kind: 'here', lat: 50.84, lng: 4.35 }, a.body.token);
  assert.equal(ok.status, 200); assert.equal(ok.body.kind, 'here'); assert.equal(ok.body.lat, 50.84);
  assert.equal((await t.call('POST', '/api/msg', { text: 'Ici', kind: 'here' }, a.body.token)).status, 400);
  await t.stop();
});

test('« faire du bruit » arrive en direct chez tout le groupe, et le spam est freiné', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  const feed = await t.listen(b.body.token);
  await t.wait(50);
  assert.equal((await t.call('POST', '/api/boom', {}, a.body.token)).status, 200);
  await t.wait(80);
  const boom = feed.events.find(e => e.event === 'boom');
  assert.equal(boom.data.pseudo, 'Max'); assert.ok(boom.data.color);
  assert.equal((await t.call('POST', '/api/boom', {}, a.body.token)).status, 429);
  assert.equal(feed.events.filter(e => e.event === 'boom').length, 1);
  feed.close(); await t.stop();
});

test('kilomètres marchés : gardés et visibles, valeurs absurdes ignorées', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  await t.call('POST', '/api/pos', { lat: 50.84, lng: 4.35, km: 2.3456 }, a.body.token);
  await t.call('POST', '/api/pos', { lat: 50.84, lng: 4.35, km: 9999 }, a.body.token);   // ignoré, garde 2,35
  const feed = await t.listen(b.body.token);
  await t.wait(80);
  assert.equal(feed.events[0].data.members.find(m => m.pseudo === 'Max').km, 2.35);
  feed.close(); await t.stop();
});

test('mode de secours : /api/sync renvoie membres, nouveaux messages et bruits récents', async () => {
  const t = await start();
  const a = await t.join('Max'), b = await t.join('Zoé');
  assert.equal((await fetch(t.base + '/api/sync')).status, 401);
  const m1 = (await t.call('POST', '/api/msg', { text: 'un' }, a.body.token)).body;
  await t.call('POST', '/api/msg', { text: 'deux' }, a.body.token);
  const sync = async (after, since, token) => (await fetch(`${t.base}/api/sync?after=${after}&since=${since}`, { headers: { Authorization: 'Bearer ' + token } })).json();
  const s1 = await sync(0, 0, b.body.token);
  assert.deepEqual(s1.messages.map(m => m.text), ['un', 'deux']);
  assert.equal(s1.members.find(m => m.pseudo === 'Zoé').online, true, 'celui qui interroge compte comme en ligne');
  assert.deepEqual((await sync(m1.id, 0, b.body.token)).messages.map(m => m.text), ['deux']);
  await t.call('POST', '/api/boom', {}, a.body.token);
  const s2 = await sync(0, s1.now, b.body.token);
  assert.equal(s2.booms.length, 1); assert.equal(s2.booms[0].pseudo, 'Max');
  assert.equal((await sync(0, s2.now + 1, b.body.token)).booms.length, 0);
  await t.stop();
});

test('le flux en direct demande de ne pas être compressé ni retenu', async () => {
  const t = await start();
  const a = await t.join('Max');
  const res = await new Promise(resolve => { const req = http.get(t.base + '/api/events?token=' + a.body.token, r => { resolve(r); req.destroy(); }); });
  assert.match(res.headers['cache-control'], /no-transform/);
  assert.equal(res.headers['x-accel-buffering'], 'no');
  await t.stop();
});
