'use strict';
// Calculs du site (public/core.js) : heures, temps de marche, arrivée, point de rencontre, Listen Express.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../public/core.js');

const data = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'data.js'), 'utf8') + '\n({ V, GARES, COLORS, ROUTE })');
const routesJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'routes.json'), 'utf8'));
const R = C.routes(routesJson);
const byId = id => data.V.find(v => v.id === id);

test('heures du festival : sam. 00:00 Bruxelles = 0, jamais « 20:60 »', () => {
  assert.equal(C.toH(Date.parse('2026-11-21T00:00:00+01:00')), 0);
  assert.equal(C.toH(Date.parse('2026-11-22T01:30:00+01:00')), 25.5);
  assert.equal(C.hh(25.5), '01:30');
  assert.equal(C.hh(20.9999), '21:00');
  assert.equal(C.fmtH(30), 'dim. 06:00');
  assert.equal(C.fmtDur(59), '1 min');
  assert.equal(C.fmtDur(3660), '1 h 01');
});

test('routes.json couvre tous les lieux dans les deux sens, gares comprises', () => {
  const ids = [...data.V.map(v => v.id), 'g-midi'];
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const r = R.get(a, b);
    assert.ok(r && r.t > 0 && r.d > 0 && r.geo.length >= 2, a + ' > ' + b);
  }
  // Gare du Nord = North Station (même endroit)
  assert.equal(R.time('g-nord', 'fuse'), R.time('nord', 'fuse'));
  assert.equal(R.time('g-central', 'central'), 0);
});

test('le tracé décodé part du départ et arrive à l’arrivée (à 150 m près)', () => {
  const r = R.get('hexagon', 'fuse'), a = byId('hexagon'), b = byId('fuse');
  const [first, last] = [r.geo[0], r.geo[r.geo.length - 1]];
  assert.ok(C.km({ lat: first[0], lng: first[1] }, a) < 0.15);
  assert.ok(C.km({ lat: last[0], lng: last[1] }, b) < 0.15);
});

test('l’estimation depuis une position GPS reste proche du vrai trajet', () => {
  // Sur tous les couples de lieux, l'estimation (ligne droite × détour) tombe à ±40 % du trajet calculé
  for (const a of data.V) for (const b of data.V) {
    if (a === b) continue;
    const real = R.time(a.id, b.id), est = C.estimate(a, b);
    if (real < 300) continue; // les très courts trajets (Central ↔ C12) sont dominés par les détours
    assert.ok(est > real * 0.6 && est < real * 1.4, `${a.id} > ${b.id} : estimé ${Math.round(est)} s, réel ${real} s`);
  }
});

test('ouvert, bientôt, plus tard, terminé', () => {
  const fuse = byId('fuse'); // 23 → 32
  assert.equal(C.venueState(fuse, 25).k, 'open');
  assert.equal(C.venueState(fuse, 22).k, 'soon');
  assert.match(C.venueState(fuse, 22).txt, /1 h 00/);
  assert.equal(C.venueState(fuse, 15).k, 'later');
  assert.equal(C.venueState(fuse, 33).k, 'done');
});

test('arrivée : fermé, attente, peu de temps sur place, ouvert', () => {
  const nord = byId('nord'); // 22 → 29
  assert.equal(C.arrival(nord, 29.2).k, 'closed');
  assert.equal(C.arrival(nord, 21.5).k, 'wait');
  assert.match(C.arrival(nord, 21.5).txt, /30 min/);
  assert.equal(C.arrival(nord, 28.5).k, 'short');
  assert.equal(C.arrival(nord, 25).k, 'ok');
  // Fin à confirmer : jamais « fermé »
  assert.equal(C.arrival(byId('citygate'), 40).k, 'ok');
});

test('se retrouver : le lieu qui minimise la marche du plus éloigné', () => {
  const people = [{ id: 'a', pos: byId('nord') }, { id: 'b', pos: byId('fuse') }];
  const places = data.V.map(v => ({ id: v.id, lat: v.lat, lng: v.lng }));
  const best = C.meeting(people, places, (pos, p) => R.time(pos.id, p.id))[0];
  // Ni North ni Fuse (l'un des deux marcherait 44 min) : un lieu du centre
  assert.ok(!['nord', 'fuse'].includes(best.place.id), best.place.id);
  assert.ok(best.max < R.time('nord', 'fuse'));
  assert.equal(best.each.length, 2);
});

test('Listen Express : utile de North à Fuse, inutile de Central à C12', () => {
  const via = (a, b) => C.viaExpress(s => R.time(a, s), s => R.time(s, b));
  const ex = via('nord', 'fuse');
  assert.equal(ex.board, 'nord'); assert.equal(ex.leave, 'g-midi');
  assert.ok(ex.t < R.time('nord', 'fuse') - 600, 'au moins 10 min gagnées');
  assert.ok(via('central', 'c12').t > R.time('central', 'c12'));
});

test('texte des étapes, depuis une étape compacte ou une étape OSRM', () => {
  assert.equal(C.dirText(['turn', 'left', 'Rue Haute', 120, 0]), 'Tournez à gauche sur Rue Haute');
  assert.equal(C.dirText({ maneuver: { type: 'depart' }, name: 'Rue Blaes' }), 'Partez par Rue Blaes');
  assert.equal(C.dirText(['roundabout', '', '', 50, 2]), 'Au rond-point, prenez la sortie n° 2');
});

test('les couleurs du site et du serveur sont identiques', () => {
  assert.deepEqual([...data.COLORS], [...require('../server.js').COLORS]);
});

test('le service worker garde tous les fichiers nécessaires à l’appli hors ligne', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(sw.includes("'" + src + "'"), src + ' absent de sw.js');
  for (const f of ['/routes.json', '/style.css', '/']) assert.ok(sw.includes("'" + f + "'"), f);
});
