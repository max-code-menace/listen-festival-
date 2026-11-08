'use strict';
// Calculs du Plan Listen, sans rien afficher : heures du festival, temps de marche, arrivée, point de rencontre.
// Utilisé par app.js dans le navigateur (window.Core) et par les tests (require('../public/core.js')).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---------- Heures ----------
  // h = heures depuis sam. 21/11/2026 00:00 à Bruxelles (= 20/11 23:00 UTC). 14 = sam. 14:00, 30 = dim. 06:00.
  const T0 = Date.UTC(2026, 10, 20, 23, 0);
  const START = 14, END = 38; // le festival : sam. 14:00 → dim. 14:00
  const toH = t => (t - T0) / 36e5;
  const pad = n => String(n).padStart(2, '0');
  function hh(h) {
    const m = Math.round(h * 60); // arrondi à la minute d'abord : jamais « 20:60 »
    return pad(Math.floor(m / 60) % 24) + ':' + pad(((m % 60) + 60) % 60);
  }
  const fmtH = h => (h >= 24 ? 'dim. ' : 'sam. ') + hh(h);

  // ---------- Distances et durées ----------
  function km(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Calé sur les trajets réels du centre de Bruxelles : détour de 1,3 × la ligne droite, 1,27 m/s (4,6 km/h)
  const DETOUR = 1.3, SPEED = 1.27;
  const estimate = (a, b) => km(a, b) * 1000 * DETOUR / SPEED;
  // Allure du groupe : multiplie les durées
  const PACES = { vite: { f: 1, n: 'On marche vite' }, normal: { f: 1.15, n: 'Normal (groupe, la nuit)' }, cool: { f: 1.35, n: 'Tranquille' } };

  const fmtDist = m => (m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
  function fmtDur(s) {
    const m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60);
  }

  // ---------- Trajets précalculés (public/routes.json) ----------
  // Les gares Nord, Congrès et Central sont au même endroit que leurs lieux
  const ALIAS = { 'g-nord': 'nord', 'g-congres': 'congres', 'g-central': 'central' };
  function decode(str) {
    const out = []; let i = 0, lat = 0, lng = 0;
    const next = () => { let b, s = 0, r = 0; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < str.length) { lat += next(); lng += next(); out.push([lat / 1e5, lng / 1e5]); }
    return out;
  }
  function routes(json) {
    const r = (json && json.r) || {};
    const key = id => ALIAS[id] || id;
    return {
      ready: !!(json && json.r),
      has: id => !!id && (json && json.pts || []).includes(key(id)),
      // { t secondes, d mètres, geo [[lat,lng]…], steps } ou null
      get(from, to) {
        const a = key(from), b = key(to);
        if (a === b) return { t: 0, d: 0, geo: [], steps: [] };
        const x = r[a + '>' + b];
        if (!x) return null;
        return { t: x.t, d: x.d, geo: decode(x.g), steps: x.s, pre: true };
      },
      time(from, to) { const a = key(from), b = key(to); if (a === b) return 0; const x = r[a + '>' + b]; return x ? x.t : null; },
    };
  }

  // Texte d'une étape : accepte une étape OSRM ou une étape compacte [type, direction, rue, mètres, sortie]
  const TURN = { left: 'Tournez à gauche', 'slight left': 'Serrez légèrement à gauche', 'sharp left': 'Tournez franchement à gauche', right: 'Tournez à droite', 'slight right': 'Serrez légèrement à droite', 'sharp right': 'Tournez franchement à droite', straight: 'Continuez tout droit', uturn: 'Faites demi-tour' };
  function step(s) {
    if (Array.isArray(s)) return { type: s[0], modifier: s[1], name: s[2], d: s[3], exit: s[4] };
    return { type: (s.maneuver || {}).type, modifier: (s.maneuver || {}).modifier, name: s.name, d: s.distance, exit: (s.maneuver || {}).exit };
  }
  function dirText(raw) {
    const s = step(raw), on = s.name ? ' sur ' + s.name : '';
    if (s.type === 'depart') return 'Partez' + (s.name ? ' par ' + s.name : '');
    if (s.type === 'arrive') return 'Vous êtes arrivé';
    if (/roundabout|rotary/.test(s.type)) return 'Au rond-point, prenez la sortie' + (s.exit ? ' n° ' + s.exit : '') + on;
    return (TURN[s.modifier] || 'Continuez') + on;
  }

  // ---------- Ouvert ou pas ----------
  // v : { s, e, tbc } ; h : heure du festival. Renvoie { k: 'open'|'soon'|'later'|'done', txt }
  function venueState(v, h) {
    if (h >= v.s && h < v.e) return { k: 'open', txt: v.tbc ? 'Ouvert' : 'Ouvert jusqu’à ' + hh(v.e) };
    if (h < v.s) {
      const inMin = Math.round((v.s - h) * 60);
      if (inMin <= 120) return { k: 'soon', txt: inMin <= 1 ? 'Ouvre maintenant' : 'Ouvre dans ' + fmtDur(inMin * 60) };
      return { k: 'later', txt: 'Ouvre ' + fmtH(v.s) };
    }
    return { k: 'done', txt: 'Terminé' };
  }
  // En arrivant à arriveH, qu'est-ce qui m'attend ? { k: 'ok'|'wait'|'short'|'closed', txt }
  function arrival(v, arriveH) {
    if (arriveH >= v.e && !v.tbc) return { k: 'closed', txt: 'Fermé à ton arrivée (fin ' + hh(v.e) + ')' };
    if (arriveH < v.s) return { k: 'wait', txt: 'Ouvre à ' + hh(v.s) + ' : ' + fmtDur((v.s - arriveH) * 3600) + ' d’attente' };
    if (!v.tbc && v.e - arriveH < 1) return { k: 'short', txt: 'Ferme à ' + hh(v.e) + ' : ' + fmtDur((v.e - arriveH) * 3600) + ' sur place' };
    return { k: 'ok', txt: v.tbc ? 'Ouvert (fin à confirmer)' : 'Ouvert jusqu’à ' + hh(v.e) };
  }

  // ---------- Se retrouver ----------
  // people : [{ id, pos:{lat,lng} }], places : [{ id, lat, lng }], time(pos, place) → secondes.
  // Classe les lieux selon le temps du plus éloigné (personne ne marche des heures), puis le total.
  function meeting(people, places, time) {
    return places.map(p => {
      const each = people.map(m => ({ id: m.id, t: time(m.pos, p) }));
      return { place: p, each, max: Math.max(...each.map(x => x.t)), sum: each.reduce((a, x) => a + x.t, 0) };
    }).sort((a, b) => (a.max - b.max) || (a.sum - b.sum));
  }

  // ---------- Listen Express ----------
  // Arrêts Nord, Central, Midi (dans cet ordre). Trajet entre deux arrêts voisins : ~5 min (supposé),
  // attente moyenne : ~10 min (horaires des passages non publiés).
  const EXPRESS_STOPS = ['nord', 'central', 'g-midi'], HOP = 5 * 60, WAIT = 10 * 60;
  // walk(from, stopId) et walk(stopId, to) → secondes. Renvoie le meilleur trajet par le train, ou null.
  function viaExpress(walkTo, walkFrom) {
    let best = null;
    for (let i = 0; i < EXPRESS_STOPS.length; i++) for (let j = 0; j < EXPRESS_STOPS.length; j++) {
      if (i === j) continue;
      const a = walkTo(EXPRESS_STOPS[i]), b = walkFrom(EXPRESS_STOPS[j]);
      if (a == null || b == null) continue;
      const t = a + WAIT + Math.abs(i - j) * HOP + b;
      if (!best || t < best.t) best = { t, board: EXPRESS_STOPS[i], leave: EXPRESS_STOPS[j], walkA: a, walkB: b };
    }
    return best;
  }

  return { T0, START, END, toH, hh, fmtH, pad, km, estimate, PACES, fmtDist, fmtDur, decode, routes, dirText, venueState, arrival, meeting, viaExpress, EXPRESS_STOPS };
});
