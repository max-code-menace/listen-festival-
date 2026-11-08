'use strict';
// Précalcule les trajets à pied entre tous les lieux et la gare du Midi, une fois pour toutes.
// Résultat : public/routes.json (durée, distance, tracé, étapes), lu par le site : les temps de marche
// s'affichent tout de suite, sans réseau, et sans dépendre du service public le soir du festival.
//
//   node scripts/build-routes.js
//
// À relancer seulement si un lieu change de place dans public/data.js. Environ 240 requêtes,
// une à la fois avec une pause, pour ménager le service gratuit de routing.openstreetmap.de.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const data = vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'data.js'), 'utf8') + '\n({ V, GARES })');
// Nord, Congrès et Central sont à la même place que leurs lieux : seule la gare du Midi est un point à part
const pts = [...data.V.map(v => ({ id: v.id, lat: v.lat, lng: v.lng })), { id: 'g-midi', lat: data.GARES.midi.lat, lng: data.GARES.midi.lng }];

// Polyline encodée (format Google, 5 décimales) : un tracé de 100 points tient en ~400 caractères
function encode(coords) {
  let out = '', plat = 0, plng = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lng] of coords) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    out += enc(a - plat) + enc(b - plng); plat = a; plng = b;
  }
  return out;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function route(a, b) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`;
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'plan-listen/1.0 (precalcul unique des trajets du festival)' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== 'Ok') throw new Error(j.code);
      return j.routes[0];
    } catch (e) {
      if (tries >= 3) throw e;
      await wait(2000 * (tries + 1));
    }
  }
}

(async () => {
  const out = { built: new Date().toISOString(), source: 'routing.openstreetmap.de (OSRM, à pied)', pts: pts.map(p => p.id), r: {} };
  let n = 0;
  for (const a of pts) for (const b of pts) {
    if (a === b) continue;
    const rt = await route(a, b);
    // Étapes compactes : [type, direction, nom de rue, mètres, sortie de rond-point]
    const steps = rt.legs[0].steps
      .filter(s => s.distance > 0 || s.maneuver.type === 'arrive')
      .map(s => [s.maneuver.type, s.maneuver.modifier || '', s.name || '', Math.round(s.distance), s.maneuver.exit || 0]);
    out.r[a.id + '>' + b.id] = {
      t: Math.round(rt.duration), d: Math.round(rt.distance),
      g: encode(rt.geometry.coordinates.map(([x, y]) => [y, x])), s: steps,
    };
    process.stdout.write(`\r${++n} / ${pts.length * (pts.length - 1)}`);
    await wait(250);
  }
  fs.writeFileSync(path.join(root, 'public', 'routes.json'), JSON.stringify(out));
  console.log(`\npublic/routes.json : ${n} trajets, ${(fs.statSync(path.join(root, 'public', 'routes.json')).size / 1024).toFixed(0)} ko`);
})().catch(e => { console.error('\nÉchec :', e.message); process.exit(1); });
