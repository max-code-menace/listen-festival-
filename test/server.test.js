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
