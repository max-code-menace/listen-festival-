'use strict';
// Plan Listen 2026, pensé pour le téléphone : carte plein écran avec panneau du bas, programme, groupe, chat.
// Données du festival : data.js. Calculs (heures, temps de marche, rencontre) : core.js. Trajets précalculés : routes.json.
// Le serveur (server.js) relaie messages, positions, statuts et « J'y vais ». Hors ligne : sw.js + file d'envoi ci-dessous.
(() => {
  // ---------- Outils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const C = window.Core;
  const { hh, fmtH, km, fmtDist, fmtDur, pad } = C;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => eco || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = () => (reduced() ? 'auto' : 'smooth');
  const dur = () => (reduced() ? 0 : .6);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const byId = id => V.find(v => v.id === id);
  const initial = s => (Array.from(String(s))[0] || '?').toUpperCase();
  const starKey = (vid, a) => vid + '|' + a;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const vibrate = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* pas de vibreur */ } };

  // Heure : ?now=2026-11-22T01:30:00%2B01:00 dans l'adresse permet de tester l'appli « pendant » le festival
  let fake = 0;
  try { const q = new URLSearchParams(location.search).get('now'); const t = q && Date.parse(q); if (t) fake = t - Date.now(); } catch (e) { /* ignoré */ }
  const now = () => Date.now() + fake;
  const nowH = () => C.toH(now());
  const BXL = { timeZone: 'Europe/Brussels' };
  const clock = t => new Intl.DateTimeFormat('fr-BE', { ...BXL, hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  const dayKey = t => new Intl.DateTimeFormat('en-CA', BXL).format(new Date(t));
  const dayLabel = t => new Intl.DateTimeFormat('fr-BE', { ...BXL, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(t));
  const inFestival = () => { const h = nowH(); return h >= C.START - 1 && h < C.END; };

  let toastTimer;
  function toast(msg, ms = 4500) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  let hintTimer;
  function hint(msg, ms = 4500) {
    const el = $('#map-hint'); el.textContent = msg; el.hidden = false;
    clearTimeout(hintTimer); if (ms) hintTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- État ----------
  let me = store.get('l26.me', null);                 // { token, id, pseudo, color }
  let members = new Map();                              // id -> { id, pseudo, color, stars, online, sharing, pos, status, km }
  let messages = [];
  let myStars = new Set(store.get('l26.stars', []));
  let sel = null, tab = 'carte';
  let myPos = null, sharing = false, watchId = null, lastSent = null, wake = null;
  let es = null, skew = 0, unread = 0, seen = store.get('l26.seen', 0), walked = store.get('l26.km', 0);
  let pace = store.get('l26.pace', 'normal'), eco = !!store.get('l26.eco', false);
  const meM = () => members.get(me && me.id);
  const others = () => [...members.values()].filter(m => m.id !== me.id);

  // ---------- Goûts : ceux de Mahx, présentés comme ses recos aux autres ----------
  const amOwner = () => !!me && me.pseudo.toLowerCase() === String(TASTE_OWNER).toLowerCase();
  const tagOf = n => (T.pick.includes(n) ? 'pick' : T.check.includes(n) ? 'check' : T.skip.includes(n) ? 'skip' : null);
  const tagTxt = t => (amOwner() ? TAG_TXT[t] : { pick: 'Reco ' + TASTE_OWNER, check: TASTE_OWNER + ' : à écouter', skip: TASTE_OWNER + ' : bof' }[t]);

  // ---------- Trajets ----------
  let R = C.routes(null);
  const paceF = () => (C.PACES[pace] || C.PACES.normal).f;
  const STOP_N = { nord: 'Gare du Nord', central: 'Gare Centrale', 'g-midi': 'Gare du Midi' };
  function placeOf(id) {
    if (!id) return null;
    if (id === 'me') return myPos && { n: 'Ma position', lat: myPos.lat, lng: myPos.lng };
    if (id.startsWith('f:')) { const m = members.get(id.slice(2)); return m && m.pos && { n: m.pseudo, lat: m.pos.lat, lng: m.pos.lng, fid: m.id }; }
    if (id.startsWith('g-')) { const g = Object.values(GARES).find(x => x.id === id); return g && { id: g.id, n: g.n, lat: g.lat, lng: g.lng }; }
    const v = byId(id); return v && { id: v.id, n: v.n, lat: v.lat, lng: v.lng };
  }
  // Le lieu (ou la gare du Midi) à moins de maxM mètres d'une position GPS
  function nearVenue(pos, maxM = 150) {
    let best = null;
    for (const p of [...V, GARES.midi]) {
      const d = km(pos, p) * 1000;
      if (d <= maxM && (!best || d < best.d)) best = { d, id: p.id === 'g-midi' || p === GARES.midi ? 'g-midi' : p.id };
    }
    return best && best.id;
  }
  // Temps de marche entre deux points : précalculé entre lieux, estimé (≈) depuis une position GPS
  function walkSec(a, b) {
    if (!a || !b) return null;
    const ia = a.id && R.has(a.id) ? a.id : null, ib = b.id && R.has(b.id) ? b.id : null;
    if (ia && ib) { const t = R.time(ia, ib); if (t != null) return { t: t * paceF(), pre: true }; }
    const na = ia || nearVenue(a), nb = ib || nearVenue(b);
    if (na && nb && R.ready) {
      const t = R.time(na, nb);
      if (t != null) {
        const extra = (ia ? 0 : C.estimate(a, placeOf(na))) + (ib ? 0 : C.estimate(b, placeOf(nb)));
        return { t: (t + extra) * paceF(), pre: false };
      }
    }
    return { t: C.estimate(a, b) * paceF(), pre: false };
  }
  const fmtWalk = w => (w.pre ? '' : '≈ ') + fmtDur(w.t);
  const fromMe = p => (myPos && p ? walkSec(myPos, p) : null);
  const expressAlt = (a, b) => C.viaExpress(s => { const w = walkSec(a, placeOf(s)); return w && w.t; }, s => { const w = walkSec(placeOf(s), b); return w && w.t; });
  const expressRuns = h => h >= 23.5 && h < 29;
  fetch('/routes.json').then(r => r.json()).then(j => { R = C.routes(j); invalidate('routes'); }).catch(() => { /* estimations seulement */ });

  // ---------- Réseau ----------
  // Erreur « pas de réseau » (offline) ou « réessayer plus tard » (retry) : l'envoi reste dans la file
  async function api(path, body, method = 'POST') {
    let r;
    try {
      r = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(me ? { Authorization: 'Bearer ' + me.token } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        signal: AbortSignal.timeout(15000), // dans une foule, une requête peut pendre très longtemps
      });
    } catch (e) { const err = new Error('Pas de réseau.'); err.offline = true; throw err; }
    let data = null; try { data = await r.json(); } catch (e) { /* pas de JSON */ }
    if (r.status === 401 && me && path !== '/api/join') { logout('Ta connexion a expiré. Entre à nouveau dans le groupe.'); throw new Error('401'); }
    if (!r.ok) { const err = new Error((data && data.error) || 'Erreur ' + r.status); err.retry = r.status === 429 || r.status >= 500; throw err; }
    return data;
  }

  // ---------- File d'envoi : ce qui part quand le réseau revient ----------
  // Messages, RDV, statut, « J'y vais », arrêt du partage. Gardée sur le téléphone.
  // key : un seul envoi en attente par clé (le dernier statut remplace le précédent).
  let outbox = store.get('l26.outbox', []);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const pendingKey = key => outbox.find(x => x.key === key);
  function saveOutbox() { store.set('l26.outbox', outbox); renderOffline(); }
  function dropOutbox(pred) { const n = outbox.length; outbox = outbox.filter(x => !pred(x)); if (outbox.length !== n) saveOutbox(); }
  function enqueue(path, body, key) {
    if (key) outbox = outbox.filter(x => x.key !== key);
    outbox.push({ id: newId(), path, body, key: key || null });
    saveOutbox();
    return flush();
  }
  let flushing = null;
  function flush() {
    if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
    return flushing;
  }
  async function doFlush() {
    while (me && outbox.length) {
      const item = outbox[0];
      try {
        const r = await api(item.path, item.body);
        dropOutbox(x => x.id === item.id);
        if (item.path === '/api/msg') addMsg(r);
      } catch (err) {
        if (err.offline || err.retry) return false; // on réessaiera
        dropOutbox(x => x.id === item.id);           // refusé pour de bon (message vide…) : on le dit
        if (err.message !== '401') toast(err.message);
      }
    }
    return true;
  }
  // Un message : il s'affiche tout de suite, grisé, et part dès que possible (cid : pas de doublon côté serveur)
  function sendMsg(body) {
    const p = enqueue('/api/msg', { ...body, cid: newId(), at: Date.now() + skew });
    if (tab === 'chat') { renderMsgs(); scrollMsgs(true); } else stale.add('chat');
    return p;
  }
  setInterval(() => { if (me && outbox.length && navigator.onLine) flush(); }, 10000);

  // ---------- Dernier état connu, pour ouvrir l'appli sans réseau ----------
  let snapTimer;
  function saveSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (me) store.set('l26.snap', { me: me.id, at: Date.now(), skew, members: [...members.values()], messages: messages.slice(-150) });
    }, 1500);
  }
  function loadSnap() {
    const s = store.get('l26.snap', null);
    if (!s || !me || s.me !== me.id || !Array.isArray(s.members)) return;
    members = new Map(s.members.map(m => [m.id, { ...m, online: false }]));
    messages = Array.isArray(s.messages) ? s.messages : [];
    skew = s.skew || 0;
  }

  // ---------- Bandeau « hors ligne » ----------
  let connState = 'wait', waitSince = Date.now(), wasOff = false;
  const isOff = () => !navigator.onLine || (connState === 'wait' && Date.now() - waitSince > 6000);
  function renderOffline() {
    const el = $('#offline'); if (!el || !me) return;
    const off = isOff(), n = outbox.length;
    el.hidden = !off;
    if (off) el.textContent = 'Hors ligne · la carte et le programme marchent' + (n ? ' · ' + n + (n > 1 ? ' envois' : ' envoi') + ' en attente' : '');
    if (off !== wasOff) { wasOff = off; if (outbox.some(x => x.path === '/api/msg')) invalidate('msgs'); }
  }
  setInterval(renderOffline, 2000);
  addEventListener('offline', renderOffline);
  addEventListener('online', () => { renderOffline(); if (me) { connect(); flush(); } });

  // ---------- Affichage groupé : on ne redessine que ce qui est visible ----------
  // Un changement (« members », « pos »…) marque les onglets concernés ; l'onglet ouvert est redessiné
  // à la prochaine image, les autres quand on les ouvre. Moins de travail, moins de batterie.
  const DEPS = {
    carte: /all|members|stars|pos|time|prefs|routes|sel|route/,
    prog: /all|members|stars|pos|time|prefs|routes/,
    groupe: /all|members|stars|pos|time|prefs|routes/,
    chat: /all|msgs|prefs/,
  };
  const dirty = new Set(), stale = new Set();
  let raf = 0;
  function invalidate(...kinds) { for (const k of kinds) dirty.add(k); if (!raf) raf = requestAnimationFrame(flushRender); }
  function flushRender() {
    raf = 0;
    const kinds = [...dirty].join(' '); dirty.clear();
    if (!me || $('#app').hidden) return;
    if (/all|members/.test(kinds)) { syncFriendMarkers(); renderBadges(); renderMeChip(); }
    if (/all|members|pos/.test(kinds)) liveReroute();
    for (const t in DEPS) if (DEPS[t].test(kinds)) stale.add(t);
    if (stale.has(tab)) renderTab(tab);
  }
  function renderTab(t) {
    stale.delete(t);
    if (t === 'carte') { renderPins(); renderSheet(); }
    else if (t === 'prog') renderProg();
    else if (t === 'groupe') renderGroupe();
    else if (t === 'chat') renderMsgs();
  }

  // ---------- Entrée dans le groupe ----------
  function renderSwatches(current) {
    $('#swatches').innerHTML = COLORS.map(c =>
      '<button type="button" role="radio" aria-checked="' + (c === current) + '" aria-label="Couleur ' + c + '" data-c="' + c + '" style="--c:' + c + '"></button>').join('');
  }
  let pickedColor = COLORS[1];
  $('#swatches').addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    pickedColor = b.dataset.c; renderSwatches(pickedColor);
  });
  function showLogin(msg) {
    closeStream(); stopShare(false);
    $('#app').hidden = true; $('#login').hidden = false;
    const last = store.get('l26.last', {});
    const q = new URLSearchParams(location.search).get('c');
    $('#in-code').value = q || last.code || '';
    $('#in-pseudo').value = last.pseudo || '';
    pickedColor = COLORS.includes(last.color) ? last.color : COLORS[(Math.random() * COLORS.length) | 0];
    renderSwatches(pickedColor);
    const err = $('#login-err'); err.hidden = !msg; err.textContent = msg || '';
  }
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#in-code').value.trim(), pseudo = $('#in-pseudo').value.trim();
    const btn = e.submitter || $('#login-form button[type=submit]'); btn.disabled = true;
    try {
      const r = await api('/api/join', { code, pseudo, color: pickedColor });
      me = { token: r.token, id: r.me.id, pseudo: r.me.pseudo, color: r.me.color };
      store.set('l26.me', me); store.set('l26.last', { code, pseudo: me.pseudo, color: me.color });
      boot();
    } catch (err) {
      const el = $('#login-err'); el.hidden = false; el.textContent = err.offline ? 'Pas de réseau : il en faut pour entrer dans le groupe la première fois.' : err.message;
    } finally { btn.disabled = false; }
  });
  function logout(msg) {
    me = null; store.del('l26.me'); store.del('l26.snap'); store.del('l26.outbox');
    members = new Map(); messages = []; outbox = [];
    showLogin(msg);
  }

  // ---------- Démarrage ----------
  function boot() {
    $('#login').hidden = true; $('#app').hidden = false;
    // Le code du groupe ne reste pas dans l'adresse (historique, captures d'écran)
    if (new URLSearchParams(location.search).has('c')) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignoré */ } }
    loadSnap(); // sans réseau, on montre le dernier état connu
    applyEco();
    initMap();
    const h = (location.hash || '').slice(1);
    showTab({ plan: 'prog', lineup: 'prog' }[h] || h || 'carte', false);
    invalidate('all');
    connect();
    flush();
    // La carte des quartiers du festival, gardée pour le mode hors ligne (une seule fois)
    setTimeout(() => {
      const t = store.get('l26.tiles', null), saveData = navigator.connection && navigator.connection.saveData;
      if (me && navigator.onLine && !saveData && !(t && t.ok)) downloadTiles(false);
    }, 4000);
  }

  // ---------- Temps réel (SSE) et mode de secours ----------
  function setConn(s) {
    if (s !== connState) { connState = s; waitSince = Date.now(); }
    renderOffline();
    $('#conn').className = 'status ' + s;
    $('#conn-txt').textContent = s === 'on' ? 'En direct' : s === 'poll' ? 'Mode simple' : 'Reconnexion…';
    $('#conn').title = $('#conn-txt').textContent;
  }
  function closeStream() { if (es) { es.close(); es = null; } }
  function onMember(m) {
    const prev = members.get(m.id);
    members.set(m.id, m); saveSnap();
    if (m.id !== me.id && m.status === 'Je suis perdu' && (!prev || prev.status !== m.status)) {
      vibrate([200, 100, 200]); toast(m.pseudo + ' est perdu·e. Onglet Groupe › « Y aller » pour aller le ou la chercher.', 7000);
    }
    invalidate('members');
    if (!prev || JSON.stringify(prev.stars) !== JSON.stringify(m.stars)) invalidate('stars');
  }

  // Mode de secours : si l'hébergeur retient la connexion en direct, on interroge le serveur toutes les 3 s
  let polling = false, pollTimer = null, lastSync = 0, lastEventAt = 0, stateTimer = null, pollFails = 0;
  function stopPolling() { polling = false; clearInterval(pollTimer); pollTimer = null; lastSync = 0; }
  function startPolling() {
    if (polling || !me) return;
    closeStream(); clearTimeout(stateTimer);
    polling = true; setConn('poll'); poll();
    pollTimer = setInterval(poll, 3000);
  }
  function applyState(d) {
    skew = d.now - Date.now();
    members = new Map(d.members.map(m => [m.id, m]));
    messages = d.messages;
    adoptServerStars();
    unread = tab === 'chat' ? 0 : messages.filter(m => m.id > seen && m.from !== me.id).length;
    renderBadge(); showRdv(); saveSnap();
    invalidate('all');
    if (tab === 'chat') markRead();
    if (outbox.length) flush();
  }
  async function poll() {
    try {
      const after = lastSync === 0 ? 0 : (messages.length ? messages[messages.length - 1].id : 0);
      const r = await fetch('/api/sync?after=' + after + '&since=' + lastSync, { headers: { Authorization: 'Bearer ' + me.token }, signal: AbortSignal.timeout(10000) });
      if (r.status === 401) return logout('Ta connexion a expiré. Entre à nouveau dans le groupe.');
      if (!r.ok) throw new Error('sync ' + r.status);
      const d = await r.json(), first = lastSync === 0;
      // Le réseau revient après une coupure : on retente le direct (il retombera ici s'il est bloqué)
      if (pollFails >= 2) { pollFails = 0; connect(); return; }
      pollFails = 0; lastSync = d.now;
      setConn('poll');
      if (first) return applyState(d);
      skew = d.now - Date.now();
      for (const m of d.members) { const p = members.get(m.id); if (!p || JSON.stringify(p) !== JSON.stringify(m)) onMember(m); }
      for (const id of [...members.keys()]) if (!d.members.some(m => m.id === id)) { members.delete(id); invalidate('members', 'stars'); }
      for (const m of d.messages) addMsg(m);
      for (const b of d.booms) onBoom(b);
      if (outbox.length) flush();
    } catch (e) { pollFails++; setConn('wait'); }
  }
  // Un flux « en direct » qui ne dit plus rien (retenu par un intermédiaire) est relancé
  setInterval(() => { if (me && es && lastEventAt && Date.now() - lastEventAt > 75000) connect(); }, 20000);

  function connect() {
    closeStream(); stopPolling(); setConn('wait');
    es = new EventSource('/api/events?token=' + encodeURIComponent(me.token));
    let gotState = false, failures = 0;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => { if (!gotState) startPolling(); }, 7000); // pas de réponse en 7 s : mode de secours
    ['state', 'member', 'gone', 'msg', 'boom', 'ping'].forEach(n => es.addEventListener(n, () => { lastEventAt = Date.now(); }));
    es.addEventListener('state', ev => {
      gotState = true; clearTimeout(stateTimer);
      setConn('on');
      applyState(JSON.parse(ev.data));
    });
    es.addEventListener('member', ev => onMember(JSON.parse(ev.data)));
    es.addEventListener('gone', ev => { members.delete(JSON.parse(ev.data).id); saveSnap(); invalidate('members', 'stars'); });
    es.addEventListener('msg', ev => addMsg(JSON.parse(ev.data)));
    es.addEventListener('boom', ev => onBoom(JSON.parse(ev.data)));
    es.onerror = () => {
      setConn('wait');
      if (++failures >= 3 && !gotState) return startPolling();
      if (es && es.readyState === EventSource.CLOSED) {
        // Le serveur a refusé : session expirée ? api() nous déconnecte si c'est le cas, sinon on reconnecte.
        // GET /api/me ne modifie rien (avant, on renvoyait ses « J'y vais », qui pouvaient écraser des choix plus récents).
        setTimeout(() => {
          if (me) api('/api/me', null, 'GET').then(connect).catch(err => { if (err.offline || err.retry) setTimeout(() => { if (me && es && es.readyState === EventSource.CLOSED) connect(); }, 5000); });
        }, 2500);
      }
    };
  }

  // ---------- Onglets ----------
  const TABS = ['carte', 'prog', 'groupe', 'chat'];
  function showTab(name, push = true) {
    if (!TABS.includes(name)) name = 'carte';
    const prev = tab; tab = name;
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
    $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
    $('.tabs .ind').style.transform = 'translateX(' + TABS.indexOf(name) * 100 + '%)';
    if (push) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignoré */ } }
    if (name === 'chat' && prev !== 'chat') sepFrom = seen;
    if (prev === 'chat' && name !== 'chat') sepFrom = null;
    if (stale.has(name) || name === 'chat') renderTab(name);
    if (name === 'carte' && map) map.invalidateSize();
    if (name === 'chat') { markRead(); scrollMsgs(true); }
    if (name !== 'carte') window.scrollTo(0, 0);
  }
  $('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== tab) showTab(h, false); });

  // ---------- Carte ----------
  let map, venueMarkers = {}, friendMarkers = {}, meMarker = null, meAcc = null, routeLayer = null, rdvMarker = null, tempRdv = null;
  let placing = false, pendingRdv = null;
  const ZOOMS = [
    { n: 'Tout', ids: null },
    { n: 'Nord et centre', ids: ['nord', 'standard', 'congres', 'hexagon', 'central', 'c12', 'blur'] },
    { n: 'Marolles et Midi', ids: ['r72', 'doctor', 'sono', 'crevette', 'tropicall', 'fuse', 'quadri', 'citygate'] },
  ];
  // Marge du bas : la carte se cadre au-dessus du panneau
  const pads = () => ({ paddingTopLeft: [30, 60], paddingBottomRight: [30, sheetVis() + 30] });
  function fitIds(ids, animate = true) {
    const b = L.latLngBounds((ids || V.map(v => v.id)).map(byId).map(v => [v.lat, v.lng]));
    if (animate && !reduced()) map.flyToBounds(b, { ...pads(), duration: .6 }); else map.fitBounds(b, { ...pads(), animate: false });
  }
  function flyTo(ll, z) {
    // Le point visé est placé au-dessus du panneau, pas dessous
    const zoom = Math.max(map.getZoom(), z), p = map.project(ll, zoom).add([0, sheetVis() / 2]);
    map.flyTo(map.unproject(p, zoom), zoom, { duration: dur() });
  }
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 12, maxZoom: 19 });
    // crossOrigin : tuiles lisibles par le service worker (gardées pour le hors ligne) ;
    // referrerPolicy : OpenStreetMap demande de savoir quel site utilise ses tuiles
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    map.setView([50.845, 4.352], 14);
    L.polyline([GARES.nord, GARES.congres, GARES.central, GARES.midi].map(g => [g.lat, g.lng]), { className: 'rail-line', weight: 4, dashArray: '9 8', opacity: .95, interactive: false }).addTo(map);
    L.marker([GARES.midi.lat, GARES.midi.lng], { icon: L.divIcon({ className: '', html: '<div class="station"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, keyboard: false })
      .bindTooltip('Gare du Midi', { permanent: true, direction: 'left', offset: [-8, 0], className: 'pin-lbl' }).addTo(map);
    V.forEach((v, i) => {
      const m = L.marker([v.lat, v.lng], {
        icon: L.divIcon({ className: '', html: '<div class="pin-hit"><div class="pin k-' + v.k + (v.approx ? ' approx' : '') + '" data-id="' + v.id + '">' + (i + 1) + '</div></div>', iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: v.n, alt: v.n, riseOnHover: true,
      }).addTo(map);
      m.bindTooltip(esc(v.n.replace(' & La Fabriek', '')), { permanent: true, direction: 'right', offset: [22, 0], className: 'pin-lbl' });
      m.on('click', () => select(v.id, false));
      venueMarkers[v.id] = m;
    });
    const lbl = () => $('#map').classList.toggle('show-lbl', map.getZoom() >= 15);
    map.on('zoomend', lbl); lbl();
    map.on('click', onMapClick);
    $('#zoom').innerHTML = ZOOMS.map((z, i) => '<button type="button" class="chip" data-z="' + i + '">' + z.n + '</button>').join('');
    setSnap('min');
    fitIds(null, false);
    updateMeMarker(); showRdv();
  }
  $('#zoom').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) { setSnap('min'); fitIds(ZOOMS[+b.dataset.z].ids); } });
  // Épingles : sélection, lieux terminés estompés, temps de marche depuis moi dans l'étiquette
  function renderPins() {
    if (!map) return;
    const h = nowH();
    for (const v of V) {
      const mk = venueMarkers[v.id], el = mk.getElement(), pin = el && el.querySelector('.pin');
      if (pin) { pin.classList.toggle('sel', v.id === sel); pin.classList.toggle('done', h >= v.e && !v.tbc); }
      const w = fromMe(v);
      mk.setTooltipContent(esc(v.n.replace(' & La Fabriek', '')) + (w ? ' <em>' + Math.max(1, Math.round(w.t / 60)) + ' min</em>' : ''));
    }
  }

  // Les potes sur la carte (l'icône n'est recréée que si elle change)
  const ageSec = t => (Date.now() + skew - t) / 1000;
  function ageText(t) {
    const s = ageSec(t);
    if (s < 25) return 'à l’instant';
    if (s < 90) return 'il y a ' + Math.round(s) + ' s';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    return 'il y a plus d’1 h';
  }
  const iconHtml = {};
  function syncFriendMarkers() {
    if (!map) return;
    const live = new Set();
    for (const m of members.values()) {
      if (m.id === me.id || !m.sharing || !m.pos) continue;
      live.add(m.id);
      const old = ageSec(m.pos.t) > 180, lost = m.status === 'Je suis perdu';
      const html = '<div class="pin-hit"><div class="friend' + (old ? ' old' : '') + (lost ? ' lost' : '') + '" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</div></div>';
      const tip = '<span class="fl" style="background:' + esc(m.color) + '">' + esc(m.pseudo) + (m.status ? ' · ' + esc(m.status) : '') + (old ? ' · ' + esc(ageText(m.pos.t)) : '') + '</span>';
      let mk = friendMarkers[m.id];
      if (!mk) {
        mk = L.marker([m.pos.lat, m.pos.lng], { icon: L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 800, title: m.pseudo, alt: m.pseudo }).addTo(map);
        mk.bindTooltip(tip, { permanent: true, direction: 'top', offset: [0, -24], className: 'friend-lbl' });
        mk.on('click', () => openRoute(myPos ? 'me' : null, 'f:' + m.id));
        friendMarkers[m.id] = mk;
      } else {
        mk.setLatLng([m.pos.lat, m.pos.lng]);
        if (iconHtml[m.id] !== html) mk.setIcon(L.divIcon({ className: '', html, iconSize: [44, 44], iconAnchor: [22, 22] }));
        mk.setTooltipContent(tip);
      }
      iconHtml[m.id] = html;
    }
    for (const id of Object.keys(friendMarkers)) if (!live.has(id)) { map.removeLayer(friendMarkers[id]); delete friendMarkers[id]; delete iconHtml[id]; }
  }
  function fitMember(id) {
    const m = members.get(id); if (!m || !m.pos) return;
    showTab('carte'); setSnap('min'); flyTo([m.pos.lat, m.pos.lng], 17);
  }
  function updateMeMarker() {
    if (!map || !myPos) return;
    const ll = [myPos.lat, myPos.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 700, interactive: false, keyboard: false }).addTo(map);
      meAcc = L.circle(ll, { radius: Math.min(myPos.acc || 0, 500), color: '#3d8bff', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); meAcc.setLatLng(ll); meAcc.setRadius(Math.min(myPos.acc || 0, 500)); }
  }

  // Ma position
  function geoMessage(err) {
    if (!window.isSecureContext) return 'La position ne marche que sur une adresse sécurisée (https).';
    if (err.code === 1) return 'Position refusée. Autorise-la dans les réglages du navigateur pour ce site.';
    return 'Position introuvable pour l’instant. Va à l’extérieur ou réessaie.';
  }
  let posMark = null;
  function setMyPos(p) {
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    updateMeMarker();
    // Les temps de marche ne sont recalculés que si on a vraiment bougé
    if (!posMark || km(posMark, myPos) * 1000 > 25) { posMark = myPos; invalidate('pos'); }
  }
  $('#btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) return hint('Ce navigateur ne donne pas la position.');
    hint('Recherche de ta position…', 0);
    navigator.geolocation.getCurrentPosition(p => {
      setMyPos(p); $('#map-hint').hidden = true;
      flyTo([myPos.lat, myPos.lng], 16);
    }, err => hint(geoMessage(err), 6000), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
  $('#btn-fit').addEventListener('click', () => {
    const pts = [];
    if (myPos) pts.push([myPos.lat, myPos.lng]);
    for (const m of others()) if (m.sharing && m.pos) pts.push([m.pos.lat, m.pos.lng]);
    if (pts.length < 2) return hint(pts.length ? 'Personne d’autre ne partage sa position.' : 'Personne ne partage sa position pour l’instant.');
    map.flyToBounds(L.latLngBounds(pts), { ...pads(), maxZoom: 17, duration: dur() });
  });
  function renderShareBtn() {
    const b = $('#btn-share'); b.setAttribute('aria-pressed', sharing);
    b.innerHTML = '<span class="dot" style="--c:' + (sharing ? '#0b0714' : 'var(--skip)') + '"></span>' + (sharing ? 'Visible' : 'Partager');
    b.setAttribute('aria-label', sharing ? 'Tu partages ta position. Toucher pour arrêter.' : 'Partager ma position avec le groupe');
  }
  function startShare() {
    if (!navigator.geolocation) return hint('Ce navigateur ne donne pas la position.');
    if (watchId != null) return;
    dropOutbox(x => x.key === 'pos'); // un « arrêter » resté en attente ne doit pas couper ce nouveau partage
    sharing = true; lastSent = null; renderShareBtn();
    watchId = navigator.geolocation.watchPosition(onGeo, err => {
      hint(geoMessage(err), 7000);
      if (err.code === 1) stopShare(true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    requestWake();
    hint('Le groupe te voit sur la carte. Garde l’appli ouverte pour que ça continue.', 6000);
  }
  function stopShare(notify = true) {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null; sharing = false; renderShareBtn(); releaseWake(); lastSent = null;
    // Dans la file : sans réseau, l'arrêt du partage part dès qu'il revient (le groupe ne doit pas te croire visible)
    if (notify && me) enqueue('/api/pos', { sharing: false }, 'pos');
  }
  function onGeo(p) {
    const prev = myPos;
    setMyPos(p);
    if (!sharing) return;
    // Les pas : on additionne les petits déplacements fiables (ni immobile, ni saut de GPS)
    if (prev && p.coords.accuracy < 50) {
      const d = km(prev, myPos) * 1000;
      if (d > 4 && d < 150) { walked += d / 1000; store.set('l26.km', walked); }
    }
    // Mode économie : on envoie moins souvent
    const [minMove, minGap, maxGap] = eco ? [50, 30000, 90000] : [25, 12000, 45000];
    const t = Date.now(), moved = lastSent ? km(lastSent, myPos) * 1000 : Infinity, dt = lastSent ? t - lastSent.t : Infinity;
    if (!lastSent || moved > minMove || (dt > minGap && moved > 5) || dt > maxGap) {
      lastSent = { lat: myPos.lat, lng: myPos.lng, t };
      api('/api/pos', { lat: myPos.lat, lng: myPos.lng, acc: myPos.acc, km: Math.round(walked * 100) / 100 }).catch(() => {});
    }
  }
  $('#btn-share').addEventListener('click', () => (sharing ? stopShare(true) : startShare()));
  async function requestWake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
  }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ignoré */ } wake = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sharing) requestWake(); if (!document.hidden) invalidate('time'); });

  // Point de rendez-vous
  function setPlacing(on) {
    placing = on; $('#btn-rdv').setAttribute('aria-pressed', on);
    if (on) { setSnap('min'); hint('Touche la carte à l’endroit du rendez-vous.', 0); } else $('#map-hint').hidden = true;
  }
  $('#btn-rdv').addEventListener('click', () => { if (placing) cancelRdv(); else setPlacing(true); });
  function onMapClick(e) {
    if (!placing) { if (snap !== 'min') setSnap('min'); return; }
    placeRdv({ lat: e.latlng.lat, lng: e.latlng.lng });
  }
  function placeRdv(pos, name) {
    pendingRdv = pos;
    if (tempRdv) map.removeLayer(tempRdv);
    tempRdv = rdvPin(pendingRdv, 'RDV');
    setPlacing(false);
    $('#rdv-txt').value = name || 'RDV ici';
    $('#rdv-form').hidden = false; setSnap('mid');
    $('#sheet-body').scrollTop = 0;
  }
  function rdvPin(pos, label) {
    return L.marker([pos.lat, pos.lng], { icon: L.divIcon({ className: '', html: '<div class="rdv-pin"><span>RDV</span></div>', iconSize: [40, 40], iconAnchor: [6, 40] }), zIndexOffset: 900, title: label, alt: label }).addTo(map);
  }
  function cancelRdv() {
    setPlacing(false); pendingRdv = null; $('#rdv-form').hidden = true;
    if (tempRdv) { map.removeLayer(tempRdv); tempRdv = null; }
  }
  $('#rdv-cancel').addEventListener('click', cancelRdv);
  $('#rdv-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!pendingRdv) return;
    const text = $('#rdv-txt').value.trim() || 'RDV ici';
    const p = sendMsg({ text, kind: 'rdv', lat: pendingRdv.lat, lng: pendingRdv.lng });
    cancelRdv();
    toast((await p) ? 'Rendez-vous envoyé au groupe.' : 'Pas de réseau : le rendez-vous partira dès qu’il revient.');
  });
  function showRdv() {
    if (!map) return;
    const last = [...messages].reverse().find(m => m.kind === 'rdv');
    if (rdvMarker) { map.removeLayer(rdvMarker); rdvMarker = null; }
    if (!last) return;
    rdvMarker = rdvPin(last, last.text).bindTooltip(esc(last.pseudo) + ' : ' + esc(last.text), { permanent: true, direction: 'right', offset: [18, -22], className: 'pin-lbl rdv-lbl' });
  }

  // ---------- Le panneau du bas ----------
  // 3 hauteurs : replié (une ligne), moitié, plein. Glissé au pouce, ou touché pour l'ouvrir.
  let snap = 'min';
  const MIN_VIS = 104;
  const viewH = () => $('#v-carte').clientHeight || innerHeight;
  const tabsZone = () => parseFloat(getComputedStyle($('#sheet')).getPropertyValue('--tabs-zone')) || 80;
  const snapVis = s => (s === 'min' ? MIN_VIS : s === 'mid' ? Math.round(viewH() * 0.52) - tabsZone() : viewH() - 6 - tabsZone());
  const sheetVis = () => snapVis(snap);
  function setSnap(s) {
    snap = s;
    const sh = $('#sheet'); sh.dataset.snap = s; sh.classList.remove('drag');
    $('#v-carte').style.setProperty('--sheet-vis', snapVis(s) + 'px');
    $('#sheet-sum').setAttribute('aria-expanded', s !== 'min');
  }
  (() => {
    const top = $('#sheet-top'), sh = $('#sheet'), vc = $('#v-carte');
    let start = null;
    top.addEventListener('pointerdown', e => {
      if (e.target.closest('#btn-share')) return;
      start = { y: e.clientY, vis: sheetVis(), t: Date.now(), moved: false };
      top.setPointerCapture(e.pointerId);
    });
    top.addEventListener('pointermove', e => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dy) < 6) return;
      if (!start.moved) { start.moved = true; sh.classList.add('drag'); sh.dataset.snap = 'drag'; }
      const vis = Math.max(MIN_VIS, Math.min(snapVis('max'), start.vis - dy));
      vc.style.setProperty('--sheet-vis', vis + 'px');
    });
    const end = e => {
      if (!start) return;
      const s = start; start = null;
      if (!s.moved) {
        if (sumAction && e.target.closest('#sheet-sum')) return sumAction();
        setSnap(snap === 'min' ? 'mid' : snap === 'mid' ? 'max' : 'mid'); return;
      }
      const dy = e.clientY - s.y, v = dy / Math.max(1, Date.now() - s.t); // vitesse en px/ms
      const vis = s.vis - dy;
      let to;
      if (v > .5) to = snap === 'max' && vis > snapVis('mid') * .8 ? 'mid' : 'min';
      else if (v < -.5) to = vis < snapVis('mid') ? 'mid' : 'max';
      else to = ['min', 'mid', 'max'].sort((a, b) => Math.abs(snapVis(a) - vis) - Math.abs(snapVis(b) - vis))[0];
      setSnap(to);
    };
    top.addEventListener('pointerup', end);
    top.addEventListener('pointercancel', end);
    addEventListener('resize', () => setSnap(snap));
  })();

  let sumAction = null; // toucher le résumé fait parfois autre chose qu'ouvrir le panneau
  function sheetSummary() {
    sumAction = null;
    const sharers = others().filter(m => m.sharing && m.pos);
    if (curRoute && lastRoute) return ['<b>' + esc(fmtWalk(lastRoute.w)) + ' → ' + esc(lastRoute.b.n) + '</b>', '<span>' + esc(lastRoute.sub) + '</span>'];
    if (sel) {
      const v = byId(sel), st = C.venueState(v, nowH()), w = fromMe(v);
      return ['<b>' + esc(v.n) + '</b>', '<span>' + esc(st.txt) + (w ? ' · ' + esc(fmtWalk(w)) + ' à pied' : '') + '</span>'];
    }
    const lost = others().find(m => m.status === 'Je suis perdu');
    if (lost && lost.sharing && lost.pos) {
      sumAction = () => openRoute(myPos ? 'me' : null, 'f:' + lost.id);
      return ['<b>' + esc(lost.pseudo) + ' est perdu·e</b>', '<span>Touche pour aller le ou la chercher</span>'];
    }
    if (lost) return ['<b>' + esc(lost.pseudo) + ' est perdu·e</b>', '<span>Sa position n’est pas partagée : écris-lui dans le chat</span>'];
    const n = sharers.length;
    return ['<b>' + (n ? n + (n > 1 ? ' potes visibles' : ' pote visible') : 'Personne n’est visible') + '</b>', '<span>Touche un lieu numéroté, ou ouvre ce panneau</span>'];
  }
  function renderSheet() {
    renderShareBtn();
    const [b, s] = sheetSummary();
    $('#sheet-sum').innerHTML = b + s;
    renderVenue();
  }
  // Au doigt, le geste est géré par le panneau ; au clavier (detail = 0), Entrée ouvre ou referme
  $('#sheet-sum').addEventListener('click', e => { if (e.detail === 0) { if (sumAction) sumAction(); else setSnap(snap === 'min' ? 'mid' : 'min'); } });

  // ---------- Fiche du lieu ----------
  function whoGoes(key) {
    const out = [];
    for (const m of members.values()) if (m.id === me.id ? myStars.has(key) : (m.stars || []).includes(key)) out.push(m);
    return out;
  }
  const crewDots = list => (list.length ? '<span class="crew" title="' + esc(list.map(m => m.pseudo).join(', ')) + '">' +
    list.map(m => '<span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span>').join('') + '</span>' : '');
  // Les potes qui sont à un lieu en ce moment (position fraîche à moins de 100 m)
  const presentAt = v => others().filter(m => m.sharing && m.pos && ageSec(m.pos.t) < 900 && km(m.pos, v) * 1000 < 100);
  function etaBlock(p, v) {
    if (!myPos) return '<p class="small mute">Touche « Moi » sur la carte ou « Partager » pour voir ton temps de marche.</p>';
    const w = fromMe(p); if (!w) return '';
    let txt = '<b>' + esc(fmtWalk(w)) + '</b><span>à pied depuis toi</span>';
    if (v && inFestival()) {
      const arr = nowH() + w.t / 3600, a = C.arrival(v, arr);
      txt += '<span>· arrivée ' + hh(arr) + '</span><span class="' + (a.k === 'ok' ? '' : a.k === 'closed' ? 'bad' : 'warn') + '" style="flex-basis:100%">' + esc(a.txt) + '</span>';
    }
    return '<div class="eta">' + txt + '</div>';
  }
  function artBtn(v, a) {
    const t = tagOf(a), k = starKey(v.id, a), on = myStars.has(k);
    const meta = (t ? '<span class="tag t-' + t + '">' + esc(tagTxt(t)) + '</span>' : '') + crewDots(whoGoes(k).filter(m => m.id !== me.id));
    return '<li class="' + (t === 'skip' && amOwner() ? 'a-skip' : '') + '"><button type="button" class="art" data-star="' + esc(k) + '" aria-pressed="' + on + '">' +
      '<span class="a-name"><b>' + esc(a) + '</b>' + (meta ? '<span class="a-meta">' + meta + '</span>' : '') + '</span>' +
      '<span class="star">' + (on ? '★ J’y vais' : '☆ J’y vais') + '</span></button></li>';
  }
  function renderVenue() {
    const el = $('#venue');
    if (!sel) { el.innerHTML = '<div class="sec-head" style="margin-top:0"><h3>Autour de toi</h3><button class="link" type="button" data-act="prog">Tout le programme</button></div><ul class="now-list">' + nowRows().slice(0, 5).map(nowRow).join('') + '</ul>'; return; }
    const v = byId(sel), i = V.indexOf(v) + 1, h = nowH(), st = C.venueState(v, h);
    const kTxt = { club: 'Club de nuit', jour: 'Club, ouvert en journée', disq: 'Disquaire · Vedett LISTENing' }[v.k];
    const fin = v.tbc ? 'fin à confirmer' : fmtH(v.e);
    const going = new Set(); for (const a of v.ar) for (const m of whoGoes(starKey(v.id, a))) going.add(m);
    const here = presentAt(v);
    const station = ['nord', 'central', 'g-midi'].map(s => ({ s, w: walkSec(placeOf(v.id), placeOf(s)) })).sort((a, b) => a.w.t - b.w.t)[0];
    el.innerHTML =
      '<div class="v-kind"><span class="label">' + i + ' · ' + kTxt + '</span><span class="state ' + st.k + '">' + esc(st.txt) + '</span></div>' +
      '<h3>' + esc(v.n) + '</h3>' +
      '<p class="small"><b>' + fmtH(v.s) + ' → ' + fin + '</b></p>' +
      etaBlock(placeOf(v.id), v) +
      (here.length ? '<p class="small here-now">Là maintenant : ' + esc(here.map(m => m.pseudo).join(', ')) + '</p>' : '') +
      (going.size ? '<p class="small mute">Y vont : ' + crewDots([...going]) + '</p>' : '') +
      '<div class="actions"><button class="btn main" type="button" data-act="goto" data-id="' + v.id + '">Y aller</button>' +
      '<button class="btn" type="button" data-act="rdv" data-id="' + v.id + '">RDV ici</button><button class="btn" type="button" data-act="center" data-id="' + v.id + '">Centrer</button></div>' +
      '<p class="small mute">' + esc(v.a) + (v.osm ? ' (adresse d’après OpenStreetMap)' : '') + (v.approx ? ' (position approximative)' : '') +
      (station && station.w.t > 0 ? '<br>' + esc(STOP_N[station.s]) + ' à ' + esc(fmtWalk(station.w)) + ' à pied (Listen Express)' : '<br>Arrêt du Listen Express') + '</p>' +
      '<div><p class="label" style="margin-bottom:4px">Line-up</p><ul class="artists">' + v.ar.map(a => artBtn(v, a)).join('') + '</ul></div>';
  }
  $('#venue').addEventListener('click', e => {
    if (e.target.closest('[data-star]')) return;
    const s = e.target.closest('[data-sel]'); if (s) return select(s.dataset.sel, false);
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'goto') openRoute(myPos ? 'me' : null, b.dataset.id);
    if (act === 'center') { const v = byId(b.dataset.id); flyTo([v.lat, v.lng], 16); }
    if (act === 'rdv') { const v = byId(b.dataset.id); placeRdv({ lat: v.lat, lng: v.lng }, 'RDV à ' + v.n); }
    if (act === 'prog') showTab('prog');
  });
  function select(id, focus) {
    sel = id; closeRouteUI(false);
    invalidate('sel'); setSnap('mid'); $('#sheet-body').scrollTop = 0;
    if (focus) showTab('carte');
    const v = byId(id); if (v && map) flyTo([v.lat, v.lng], 15);
  }

  // ---------- « J'y vais » partagé ----------
  function adoptServerStars() {
    const mine = meM();
    if (!mine) return;
    if (pendingKey('stars')) return; // des choix faits hors ligne attendent de partir : ils gagnent
    if (!mine.stars.length && myStars.size) pushStars(); else { myStars = new Set(mine.stars); store.set('l26.stars', [...myStars]); }
  }
  let starTimer;
  function pushStars() { clearTimeout(starTimer); starTimer = setTimeout(() => enqueue('/api/stars', { stars: [...myStars] }, 'stars'), 250); }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-star]'); if (!b) return;
    const k = b.dataset.star, on = !myStars.has(k);
    on ? myStars.add(k) : myStars.delete(k);
    store.set('l26.stars', [...myStars]); pushStars(); vibrate(15);
    // Retour immédiat sur le bouton touché, le reste suit
    b.setAttribute('aria-pressed', on); const s = b.querySelector('.star'); if (s) s.textContent = on ? '★ J’y vais' : '☆ J’y vais';
    invalidate('stars');
  });

  // ---------- Itinéraire à pied ----------
  let curRoute = null, lastRoute = null, routeAt = 0, routeFromPos = null, routeToPos = null;
  const rmem = new Map();
  async function walkLive(a, b) {
    const key = [a.lat, a.lng, b.lat, b.lng].map(x => x.toFixed(5)).join(',');
    if (rmem.has(key)) return rmem.get(key);
    const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson&steps=true';
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!r.ok) throw new Error('routage ' + r.status);
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes[0]) throw new Error('aucun chemin');
    const rt = j.routes[0];
    const res = { t: rt.duration, d: rt.distance, geo: rt.geometry.coordinates.map(([x, y]) => [y, x]), steps: rt.legs[0].steps };
    rmem.set(key, res);
    return res;
  }
  function drawRoute(geo, b, dashed) {
    clearRoute();
    routeLayer = L.layerGroup([
      L.polyline(geo, { color: '#0b0714', weight: 11, opacity: .6, interactive: false }),
      L.polyline(geo, { color: '#3ee6d8', weight: 5, opacity: 1, interactive: false, className: dashed ? '' : 'route-line', dashArray: dashed ? '4 8' : null }),
      L.circleMarker([b.lat, b.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#3ee6d8', fillOpacity: 1, interactive: false }),
    ]).addTo(map);
    map.flyToBounds(L.latLngBounds(geo), { ...pads(), maxZoom: 17, duration: dur() });
  }
  function clearRoute() { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } }
  function routeOptions() {
    const friends = others().filter(m => m.sharing && m.pos);
    const grp = (label, items) => (items.length ? '<optgroup label="' + label + '">' + items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.n) + '</option>').join('') + '</optgroup>' : '');
    return grp('Autour de toi', [...(myPos ? [{ id: 'me', n: 'Ma position' }] : []), ...friends.map(f => ({ id: 'f:' + f.id, n: f.pseudo }))]) +
      grp('Lieux', V.map(v => ({ id: v.id, n: v.n }))) + grp('Gares', Object.values(GARES).map(g => ({ id: g.id, n: g.n })));
  }
  function openRoute(from, to) {
    showTab('carte');
    curRoute = { from: from || (sel && sel !== to ? sel : 'g-central'), to };
    if (!from) toast('Ta position n’est pas connue : touche « Moi » ou choisis un départ.');
    if (byId(to)) sel = to;
    $('#route').hidden = false; setSnap('mid'); $('#sheet-body').scrollTop = 0;
    doRoute();
  }
  function closeRouteUI(redraw = true) {
    curRoute = null; lastRoute = null; $('#route').hidden = true; $('#route').innerHTML = '';
    if (map) clearRoute();
    if (redraw) invalidate('route');
  }
  function extLinks(b) {
    const d = b.lat.toFixed(5) + ',' + b.lng.toFixed(5);
    const g = mode => 'https://www.google.com/maps/dir/?api=1&destination=' + d + '&travelmode=' + mode;
    return '<div class="ext">' +
      '<a href="' + (iOS ? 'https://maps.apple.com/?daddr=' + d + '&dirflg=w' : g('walking')) + '" target="_blank" rel="noopener">' + (iOS ? 'Ouvrir dans Plans' : 'Ouvrir dans Maps') + '</a>' +
      '<a href="' + g('transit') + '" target="_blank" rel="noopener">En transports (STIB)</a>' +
      '<a href="https://m.uber.com/ul/?action=setPickup&amp;pickup=my_location&amp;dropoff[latitude]=' + b.lat + '&amp;dropoff[longitude]=' + b.lng + '&amp;dropoff[nickname]=' + encodeURIComponent(b.n) + '" target="_blank" rel="noopener">Taxi (Uber)</a></div>';
  }
  async function doRoute() {
    if (!curRoute) return;
    const out = $('#route'), { from, to } = curRoute, a = placeOf(from), b = placeOf(to);
    const pick = '<div class="route-pick"><div class="field"><label class="label" for="r-from">De</label><select id="r-from">' + routeOptions() + '</select></div>' +
      '<div class="field"><label class="label" for="r-to">Vers</label><select id="r-to">' + routeOptions() + '</select></div></div>';
    const head = '<div class="card-head"><h3>Itinéraire</h3><button class="link" type="button" data-r="close">Fermer</button></div>';
    const setPick = () => { const f = $('#r-from'), t = $('#r-to'); if (f) f.value = from; if (t) t.value = to; };
    if (!a || !b) {
      out.innerHTML = head + pick + '<p class="err">' + (!a ? 'Départ inconnu : choisis-en un.' : 'Cette destination n’a pas de position.') + '</p>';
      setPick(); return;
    }
    routeAt = Date.now(); routeFromPos = { lat: a.lat, lng: a.lng }; routeToPos = { lat: b.lat, lng: b.lng };
    const w = walkSec(a, b), h = nowH(), v = b.id ? byId(b.id) : null;
    // 1. Entre deux lieux : le trajet précalculé (instantané, sans réseau)
    let r = a.id && b.id ? R.get(a.id, b.id) : null, approx = false;
    if (!r) {
      out.innerHTML = head + pick + '<p class="mute">Calcul de l’itinéraire…</p>'; setPick();
      try { r = await walkLive(a, b); }
      catch (e) {
        // 2. Hors ligne : le trajet précalculé depuis le lieu le plus proche, sinon la ligne droite
        const na = a.id || nearVenue(a), nb = b.id || nearVenue(b);
        r = na && nb ? R.get(na, nb) : null;
        if (r) r = { ...r, geo: [[a.lat, a.lng], ...r.geo, [b.lat, b.lng]] };
        else r = { t: C.estimate(a, b), d: km(a, b) * 1000 * 1.3, geo: [[a.lat, a.lng], [b.lat, b.lng]], steps: [], straight: true };
        approx = true;
      }
      if (!curRoute || curRoute.from !== from || curRoute.to !== to) return; // l'utilisateur a changé d'avis entre-temps
    }
    const wt = { t: r.t * paceF(), pre: !approx && !!(a.id && b.id) };
    if (a.id && b.id) Object.assign(wt, w);
    drawRoute(r.geo, b, r.straight);
    let sub = fmtDist(r.d) + ' à pied', arrTxt = '';
    if (inFestival()) {
      const arr = h + wt.t / 3600; sub += ' · arrivée ' + hh(arr);
      if (v) { const ar = C.arrival(v, arr); arrTxt = '<p class="small ' + (ar.k === 'ok' ? 'mute' : ar.k === 'closed' ? 'err' : '') + '" style="' + (ar.k === 'ok' ? '' : 'color:var(--accent);font-weight:700') + '">' + esc(ar.txt) + '</p>'; }
    }
    lastRoute = { w: wt, b, sub };
    // Le Listen Express, s'il fait gagner au moins 10 minutes
    const ex = expressAlt(a, b);
    const exTxt = ex && ex.t < wt.t - 600 ? '<p class="alt"><b>Par le Listen Express : ≈ ' + fmtDur(ex.t) + '</b><br>' +
      (ex.walkA >= 60 ? fmtDur(ex.walkA) + ' à pied jusqu’à ' : 'Monte à ') + esc(STOP_N[ex.board]) + ', train jusqu’à ' + esc(STOP_N[ex.leave]) + (ex.walkB >= 60 ? ', puis ' + fmtDur(ex.walkB) + ' à pied. ' : ', tu y es. ') +
      (expressRuns(h) ? 'Le train roule jusqu’à 05:00.' : 'Seulement dim. 00:00 → 05:00.') + ' Attente supposée ~10 min (passages non publiés).</p>' : '';
    const warn = r.straight ? '<p class="err small">Pas de réseau et pas de trajet gardé pour ce départ : ligne droite et durée estimée.</p>' : approx ? '<p class="small mute">Hors ligne : trajet gardé depuis le lieu le plus proche, durée estimée.</p>' : '';
    const imOnWay = from === 'me' ? '<button class="btn" type="button" data-r="omw">Prévenir le groupe : j’arrive dans ~' + Math.max(1, Math.round(wt.t / 60)) + ' min</button>' : '';
    const steps = (r.steps || []).filter(s => Array.isArray(s) || s.distance > 0 || (s.maneuver && s.maneuver.type === 'arrive'));
    out.innerHTML = head + pick +
      '<div class="route-sum"><b>' + esc(fmtWalk(wt)) + '</b><span>' + esc(sub) + '</span></div>' + arrTxt + warn + exTxt + imOnWay + extLinks(b) +
      (steps.length ? '<details class="fold"><summary><h3>Étapes (' + steps.length + ')</h3></summary><ol class="dirs">' + steps.map(s => {
        const d = Array.isArray(s) ? s[3] : s.distance;
        return '<li><span>' + esc(C.dirText(s)) + '</span><span class="d">' + (d ? fmtDist(d) : '') + '</span></li>';
      }).join('') + '</ol></details>' : '');
    setPick();
    invalidate('route');
  }
  $('#route').addEventListener('change', e => {
    if (!curRoute || !['r-from', 'r-to'].includes(e.target.id)) return;
    curRoute = { from: $('#r-from').value, to: $('#r-to').value };
    if (byId(curRoute.to)) sel = curRoute.to;
    doRoute();
  });
  $('#route').addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'close') { closeRouteUI(); setSnap(sel ? 'mid' : 'min'); }
    if (b.dataset.r === 'omw' && lastRoute) {
      const to = curRoute.to.startsWith('f:') ? 'vers toi, ' + lastRoute.b.n + ',' : 'à ' + lastRoute.b.n;
      sendMsg({ text: 'J’arrive ' + to + ' dans ~' + Math.max(1, Math.round(lastRoute.w.t / 60)) + ' min' });
      toast('Message envoyé au groupe.');
    }
  });
  // Un pote bouge, ou moi : l'itinéraire se met à jour (pas plus d'une fois toutes les 20 s)
  function liveReroute() {
    if (!curRoute || Date.now() - routeAt < 20000) return;
    const a = placeOf(curRoute.from), b = placeOf(curRoute.to);
    if (!a || !b || !routeFromPos) return;
    if (km(a, routeFromPos) * 1000 > 60 || km(b, routeToPos) * 1000 > 40) doRoute();
  }

  // ---------- Programme ----------
  let progPane = store.get('l26.prog', 'now');
  $('#prog-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    progPane = b.dataset.p; store.set('l26.prog', progPane); renderProg(); window.scrollTo(0, 0);
  });
  function renderProg() {
    $$('#prog-seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.p === progPane));
    $('#p-now').hidden = progPane !== 'now'; $('#p-lineup').hidden = progPane !== 'lineup'; $('#p-hours').hidden = progPane !== 'hours';
    if (progPane === 'now') renderNow();
    if (progPane === 'lineup') renderLineup();
    if (progPane === 'hours') renderHours();
  }

  // Maintenant : ce qui est ouvert, triés par temps de marche depuis moi
  function nowRows() {
    const h = nowH(), order = { open: 0, soon: 1, later: 2, done: 3 };
    return V.map(v => ({ v, st: C.venueState(v, h), w: fromMe(v) }))
      .sort((a, b) => (order[a.st.k] - order[b.st.k]) ||
        (a.st.k === 'open' ? (a.w && b.w ? a.w.t - b.w.t : a.v.e - b.v.e) : a.v.s - b.v.s) || (V.indexOf(a.v) - V.indexOf(b.v)));
  }
  const kColor = k => ({ club: 'var(--accent)', jour: 'var(--cyan)', disq: '#d6caff' }[k]);
  function nowRow(x) {
    const { v, st, w } = x, going = whoGoesAt(v.id), here = presentAt(v);
    return '<li><button type="button" class="nrow' + (st.k === 'done' ? ' done' : '') + '" data-sel="' + v.id + '">' +
      '<span class="k" style="background:' + kColor(v.k) + '"></span>' +
      '<span><b>' + esc(v.n) + '</b><span class="sub"><span class="state ' + st.k + '">' + esc(st.txt) + '</span>' +
      (here.length ? '<span class="here-now">' + esc(here.map(m => m.pseudo).join(', ')) + ' y ' + (here.length > 1 ? 'sont' : 'est') + '</span>' : going.length ? miniCrew(v.id) : '') + '</span></span>' +
      '<span class="t">' + (w ? esc(fmtWalk(w)) + '<small>à pied</small>' : hh(v.s) + '<small>' + (v.tbc ? '→ ?' : '→ ' + hh(v.e)) + '</small>') + '</span></button></li>';
  }
  function renderNow() {
    const h = nowH(), rows = nowRows();
    let banner = '';
    if (h < C.START) {
      const days = Math.round((Date.UTC(2026, 10, 21) - Date.UTC(...todayBxl())) / 864e5);
      banner = '<div class="banner"><b>' + (days > 0 ? 'Dans ' + days + (days > 1 ? ' jours' : ' jour') : 'C’est aujourd’hui') + '</b>Ça commence sam. 21 nov. à 14:00 chez les disquaires. Voici l’ordre d’ouverture' + (myPos ? ', avec ton temps de marche.' : '.') + '</div>';
    } else if (h >= C.END) banner = '<div class="banner"><b>C’est fini</b>Bien rentré ? Dis-le au groupe dans le chat.</div>';
    if (expressRuns(h)) banner += '<div class="banner"><b>Le Listen Express roule</b>Nord ↔ Central ↔ Midi jusqu’à 05:00. Passages non publiés : compte ~10 min d’attente.</div>';
    else if (h >= 22 && h < 23.5) banner += '<div class="banner"><b>Listen Express dans ' + fmtDur((24 - h) * 3600) + '</b>Nord ↔ Central ↔ Midi, de 00:00 à 05:00.</div>';
    const grp = (title, list, open = true) => (list.length ? (open ? '<section class="now-group"><h2>' + title + '</h2><ul class="now-list">' + list.map(nowRow).join('') + '</ul></section>'
      : '<details class="fold"><summary><h3>' + title + ' (' + list.length + ')</h3></summary><ul class="now-list">' + list.map(nowRow).join('') + '</ul></details>') : '');
    const by = k => rows.filter(r => r.st.k === k);
    const inside = h >= C.START - 2 && h < C.END;
    $('#p-now').innerHTML = banner +
      (inside ? grp('Ouvert maintenant', by('open')) + grp('Ouvre bientôt', by('soon')) + grp('Plus tard', by('later')) + grp('Terminé', by('done'), false)
        : grp(h < C.START ? 'Dans l’ordre d’ouverture' : 'Les lieux', rows)) +
      (myPos ? '' : '<p class="small mute">Partage ta position (onglet Carte) pour trier par temps de marche.</p>');
  }
  function todayBxl() {
    let s; try { s = new Intl.DateTimeFormat('en-CA', BXL).format(new Date(now())); } catch (e) { s = new Date(now()).toISOString().slice(0, 10); }
    const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d];
  }
  $('#v-prog').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) select(b.dataset.sel, true); });

  // Line-up : recherche, filtres avec compteurs, en-têtes de lieu qui restent en haut
  let filter = 'all', luQ = '';
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function luKeep(v, a, f) {
    const k = starKey(v.id, a);
    if (f === 'stars') return myStars.has(k);
    if (f === 'crew') return whoGoes(k).some(m => m.id !== me.id);
    if (f === 'reco') return ['pick', 'check'].includes(tagOf(a));
    if (f === 'open') return C.venueState(v, nowH()).k === 'open' || C.venueState(v, nowH()).k === 'soon';
    return true;
  }
  function renderLineup() {
    const all = V.flatMap(v => v.ar.map(a => ({ v, a })));
    const count = f => all.filter(x => luKeep(x.v, x.a, f)).length;
    const F = [['all', 'Tout'], ['stars', 'Mes choix'], ['crew', 'Le groupe'], ['reco', amOwner() ? 'Mes goûts' : 'Recos ' + TASTE_OWNER], ['open', 'Ouvert']];
    $('#filter').innerHTML = F.map(([f, n]) => '<button type="button" class="chip" data-f="' + f + '" aria-pressed="' + (filter === f) + '">' + n + (f === 'all' ? '' : '<span class="n">' + count(f) + '</span>') + '</button>').join('');
    const q = norm(luQ.trim());
    // Ordre d'ouverture, mais les lieux déjà fermés passent à la fin
    const h = nowH(), done = v => (h >= v.e && !v.tbc ? 1 : 0);
    const venues = [...V].sort((a, b) => done(a) - done(b) || a.s - b.s || V.indexOf(a) - V.indexOf(b));
    const html = venues.map(v => {
      const vMatch = q && norm(v.n).includes(q);
      const list = v.ar.filter(a => luKeep(v, a, filter) && (!q || vMatch || norm(a).includes(q)));
      if (!list.length) return '';
      const st = C.venueState(v, nowH()), w = fromMe(v);
      return '<section class="lu-v"><button type="button" class="lu-h" data-sel="' + v.id + '"><b>' + esc(v.n) + '</b>' + miniCrew(v.id) +
        '<span class="sub"><span>' + hh(v.s) + '–' + (v.tbc ? '?' : hh(v.e)) + '</span><span class="state ' + st.k + '">' + esc(st.txt) + '</span>' + (w ? '<span>' + esc(fmtWalk(w)) + ' à pied</span>' : '') + '</span></button>' +
        '<ul class="artists">' + list.map(a => artBtn(v, a)).join('') + '</ul></section>';
    }).join('');
    const empty = q ? 'Rien ne correspond à « ' + esc(luQ.trim()) + ' ».'
      : { stars: 'Aucun DJ choisi. Touche une ligne dans « Tout » pour dire « J’y vais ».', crew: 'Personne du groupe n’a encore choisi de DJ.', reco: 'Aucune reco dans ce filtre.', open: 'Rien d’ouvert maintenant.', all: '' }[filter];
    $('#lu').innerHTML = html || '<p class="empty">' + empty + '</p>';
  }
  $('#filter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; renderLineup(); });
  $('#lu-q').addEventListener('input', () => { luQ = $('#lu-q').value; renderLineup(); });
  $('#lu').addEventListener('click', e => { if (e.target.closest('[data-star]')) return; const b = e.target.closest('[data-sel]'); if (b) { e.stopPropagation(); select(b.dataset.sel, true); } }, true);

  // Horaires : une ligne par lieu, la nuit en largeur (14:00 → 14:00), ligne « maintenant »
  const pct = h => ((Math.min(Math.max(h, C.START), C.END) - C.START) / (C.END - C.START)) * 100;
  function renderHours() {
    const h = nowH(), nowL = h > C.START && h < C.END ? '<i class="nowl" style="left:' + pct(h) + '%"></i>' : '';
    const rows = V.map(v => ({ id: v.id, n: v.n, s: v.s, e: v.e, k: v.tbc ? 'tbc' : v.k })).concat([{ id: 'express', n: EXPRESS.n, s: EXPRESS.s, e: EXPRESS.e, k: 'rail' }])
      .sort((a, b) => a.s - b.s || a.e - b.e);
    $('#timeline').innerHTML = rows.map(r => '<li><button type="button" class="tl-row' + (r.id === sel ? ' sel' : '') + '" data-go="' + r.id + '"><b>' + esc(r.n) + (r.id === 'express' ? '' : miniCrew(r.id)) + '</b>' +
      '<span class="hrs">' + hh(r.s) + ' → ' + (r.k === 'tbc' ? '?' : hh(r.e)) + '</span>' +
      '<span class="track"><span class="tbar k-' + r.k + '" style="left:' + pct(r.s) + '%;width:' + (pct(r.e) - pct(r.s)) + '%"></span>' + nowL + '</span></button></li>').join('') +
      '<li class="tl-axis" aria-hidden="true"><span>14h</span><span>18h</span><span>22h</span><span>02h</span><span>06h</span><span>10h</span><span>14h</span></li>';
    renderMyPlan(); renderSteps();
    $('#express-when').textContent = h < 24 ? (h > 14 ? 'dans ' + fmtDur((24 - h) * 3600) : 'dim. 00:00 → 05:00') : h < 29 ? 'roule jusqu’à 05:00' : 'terminé';
    $('#owner-only').hidden = !amOwner();
    $('#mahx-route-t').textContent = amOwner() ? 'Mon parcours prévu' : 'Le parcours de ' + TASTE_OWNER;
  }
  $('#timeline').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'express') { showTab('carte'); setSnap('min'); map.flyToBounds(L.latLngBounds([GARES.nord, GARES.midi].map(g => [g.lat, g.lng])), { ...pads(), duration: dur() }); return; }
    select(b.dataset.go, true);
  });
  // Mon parcours : mes lieux choisis, dans l'ordre d'ouverture, avec la marche entre chacun
  function renderMyPlan() {
    const venues = [...new Set(picksOf(meM() || { id: me.id }).map(p => p.v))].sort((a, b) => a.s - b.s || a.e - b.e);
    const depart = store.get('l26.depart', '') || 'ta gare';
    if (!venues.length) { $('#myplan').innerHTML = '<li class="empty">Choisis des DJ avec « J’y vais » (Programme › Line-up) : ton parcours apparaît ici, avec les temps de marche entre chaque lieu.</li>'; return; }
    const h = nowH();
    $('#myplan').innerHTML = venues.map((v, i) => {
      const djs = picksOf(meM() || { id: me.id }).filter(p => p.v === v).map(p => '<span class="tag t-pick">' + esc(p.a) + '</span>').join('');
      const st = C.venueState(v, h);
      let leg = '';
      const next = venues[i + 1];
      if (next) {
        const w = walkSec(placeOf(v.id), placeOf(next.id)), ex = expressAlt(placeOf(v.id), placeOf(next.id));
        const exTxt = ex && ex.t < w.t - 600 ? ' · ou Listen Express ≈ ' + fmtDur(ex.t) + ' (00:00 → 05:00)' : '';
        leg = '<li class="leg' + (w.t > 25 * 60 ? ' far' : '') + '">↓ ' + esc(fmtWalk(w)) + ' à pied jusqu’à ' + esc(next.n) + exTxt + '</li>';
      }
      return (i === 0 ? '<li class="leg">Depuis ' + esc(depart) + ' : train jusqu’à Bruxelles (SNCB, horaires à vérifier)</li>' : '') +
        '<li class="step"><span class="h">' + hh(v.s) + '</span><div class="body"><button type="button" class="pl-vn" data-sel="' + v.id + '">' + esc(v.n) + '</button>' +
        '<p class="small mute">' + hh(v.s) + ' → ' + (v.tbc ? '?' : hh(v.e)) + ' · <span class="state ' + st.k + '">' + esc(st.txt) + '</span></p><div class="who">' + djs + '</div></div></li>' + leg;
    }).join('');
  }
  function renderSteps() {
    const depart = store.get('l26.depart', '') || 'Gare de Mont-Saint-Guibert';
    $('#steps').innerHTML = ROUTE.map((r, i) => {
      const v = byId(r.id);
      const who = v ? v.ar.filter(a => ['pick', 'check'].includes(tagOf(a))).map(a => '<span class="tag t-' + tagOf(a) + '">' + esc(a) + '</span>').join('') : '<span class="mute">O’SIMMIE, LOV, Vera Moro</span>';
      const train = r.train ? '<p class="small mute">' + esc(depart) + ' → ' + esc(r.train) + '</p>' : '';
      let eta = '';
      if (r.leg) { const w = walkSec(placeOf(r.leg.from), placeOf(r.leg.to)); eta = w ? fmtWalk(w) + ' à pied' : ''; }
      const btn = r.leg ? '<button class="btn sm" type="button" data-leg="' + i + '">Voir le trajet · ' + esc(eta) + '</button>'
        : '<button class="btn sm" type="button" data-leg="' + i + '">Voir Nord → Midi</button>';
      return '<li class="step"><span class="h">' + hh(r.h) + '</span><div class="body"><h3>' + esc(r.titre) + '</h3><p class="small">' + esc(r.txt) + '</p>' + train +
        '<div class="who">' + who + '</div><div class="links">' + btn + '</div></div></li>';
    }).join('');
    $('#hors-parcours').innerHTML = 'Hors parcours : <b>Mike Servito</b> joue à Studio CityGate (Anderlecht), de 23:00 jusqu’au dimanche, à ' + esc(fmtWalk(walkSec(placeOf('g-midi'), placeOf('citygate')))) + ' à pied de la gare du Midi ; <b>tINI</b> à Blur jusqu’à dim. 14:00, et <b>Haumea</b> à C12 jusqu’à 07:00.';
  }
  $('#steps').addEventListener('click', e => {
    const b = e.target.closest('[data-leg]'); if (!b) return;
    const r = ROUTE[+b.dataset.leg];
    if (!r.leg) { showTab('carte'); setSnap('min'); map.flyToBounds(L.latLngBounds([GARES.nord, GARES.midi].map(g => [g.lat, g.lng])), { ...pads(), duration: dur() }); return; }
    openRoute(r.leg.from, r.leg.to);
  });

  // ---------- Le planning de chacun ----------
  function picksOf(m) {
    const keys = m.id === me.id ? [...myStars] : (m.stars || []);
    const out = [];
    for (const k of keys) {
      const [vid, ...rest] = k.split('|'), v = byId(vid), a = rest.join('|');
      if (v && v.ar.includes(a)) out.push({ v, a, k });
    }
    return out.sort((x, y) => (x.v.s - y.v.s) || (V.indexOf(x.v) - V.indexOf(y.v)) || (x.v.ar.indexOf(x.a) - y.v.ar.indexOf(y.a)));
  }
  const whoGoesAt = vid => [...members.values()].filter(m => picksOf(m).some(p => p.v.id === vid));
  function miniCrew(vid) {
    const w = whoGoesAt(vid);
    if (!w.length) return '';
    return '<span class="minis" title="' + esc(w.map(m => m.id === me.id ? 'toi' : m.pseudo).join(', ')) + '">' +
      w.slice(0, 3).map(m => '<span class="dot mini" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span>').join('') +
      (w.length > 3 ? '<span class="more">+' + (w.length - 3) + '</span>' : '') + '</span>';
  }
  const names = list => { const n = list.map(m => (m.id === me.id ? 'toi' : m.pseudo)); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' et ' + n[n.length - 1]; };
  const hoursOf = v => hh(v.s) + '–' + (v.tbc ? '?' : hh(v.e));

  // ---------- Groupe ----------
  function renderGroupe() { renderStatus(); renderPotes(); renderWalker(); renderMeetNow(); renderMeetPlan(); renderPlans(); }
  function renderBadges() {
    const lost = others().some(m => m.status === 'Je suis perdu');
    $('#badge-g').hidden = !lost;
  }
  function renderPotes() {
    const list = others().sort((a, b) => ((b.status === 'Je suis perdu') - (a.status === 'Je suis perdu')) || (b.sharing - a.sharing) || (b.online - a.online) || a.pseudo.localeCompare(b.pseudo));
    $('#potes-n').textContent = members.size + ' dans le groupe';
    if (!list.length) { $('#potes').innerHTML = '<li class="empty">Personne d’autre pour l’instant. Envoie le lien d’invitation depuis ton profil (en haut à droite).</li>'; return; }
    $('#potes').innerHTML = list.map(m => {
      let sub;
      if (m.sharing && m.pos) {
        const near = nearVenue(m.pos, 120), w = fromMe(m.pos);
        sub = '<span class="live' + (ageSec(m.pos.t) > 180 ? ' off' : '') + '"></span>' + (w ? '<b>' + esc(fmtWalk(w)) + '</b> de toi · ' : '') + (near ? 'près de ' + esc(placeOf(near).n) + ' · ' : '') + esc(ageText(m.pos.t));
      } else sub = '<span class="live off"></span>' + (m.online ? 'en ligne, position non partagée' : 'hors ligne');
      const lost = m.status === 'Je suis perdu';
      const statTag = m.status ? '<span class="stat' + (lost ? ' lost' : '') + '">' + esc(m.status) + '</span>' : '';
      const walkTxt = (m.km || 0) >= 0.1 ? ' · ' + fmtDist(m.km * 1000) + ' marchés' : '';
      const n = picksOf(m).length;
      const acts = (m.sharing && m.pos ? '<button class="btn sm" type="button" data-act="see" data-id="' + m.id + '">Voir</button><button class="btn sm' + (lost ? ' main' : '') + '" type="button" data-act="go" data-id="' + m.id + '">Y aller</button>' : '') +
        (n ? '<button class="btn sm" type="button" data-act="plan" data-id="' + m.id + '">Planning · ' + n + '</button>' : '');
      return '<li class="pote' + (lost ? ' lost' : '') + '"><span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span><div><b>' + esc(m.pseudo) + '</b>' + statTag +
        '<div class="sub">' + sub + walkTxt + '</div></div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</li>';
    }).join('');
  }
  $('#potes').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'see') fitMember(b.dataset.id);
    if (b.dataset.act === 'plan') { const el = document.getElementById('pl-' + b.dataset.id); if (el) el.scrollIntoView({ block: 'start', behavior: smooth() }); }
    if (b.dataset.act === 'go') openRoute(myPos ? 'me' : null, 'f:' + b.dataset.id);
  });
  // Se retrouver maintenant : le lieu ouvert qui minimise la marche du plus éloigné
  let meetBest = [];
  function renderMeetNow() {
    const people = [...(myPos ? [{ id: me.id, n: 'Toi', pos: myPos }] : []), ...others().filter(m => m.sharing && m.pos && ageSec(m.pos.t) < 1200).map(m => ({ id: m.id, n: m.pseudo, pos: m.pos }))];
    if (people.length < 2) {
      $('#meet-now').innerHTML = '<p class="empty">Il faut au moins deux personnes qui partagent leur position' + (myPos ? '.' : ' (toi compris : bouton « Partager » sur la carte).') + '</p>';
      return;
    }
    const h = nowH(), during = inFestival();
    const places = [...V.filter(v => !during || (h >= v.s - .25 && h < v.e)), GARES.midi].map(p => placeOf(p.id === 'g-midi' || p === GARES.midi ? 'g-midi' : p.id));
    meetBest = C.meeting(people, places, (pos, p) => walkSec(pos, p).t).slice(0, 3);
    $('#meet-now').innerHTML = meetBest.map((x, i) => '<div class="mrow"><span><b>' + esc(x.place.n) + '</b><br><span class="small mute">' + (i === 0 ? 'Le plus juste · ' : '') + 'le plus loin à ' + fmtDur(x.max) + '</span></span>' +
      '<button class="btn sm' + (i === 0 ? ' main' : '') + '" type="button" data-meet="' + i + '">Proposer</button>' +
      '<span class="who">' + x.each.map(e => { const p = people.find(q => q.id === e.id); return '<span>' + esc(p.n) + ' ' + fmtDur(e.t) + '</span>'; }).join('') + '</span></div>').join('');
  }
  $('#meet-now').addEventListener('click', async e => {
    const b = e.target.closest('[data-meet]'); if (!b) return;
    const x = meetBest[+b.dataset.meet]; if (!x) return;
    const sent = await sendMsg({ kind: 'rdv', text: 'On se retrouve à ' + x.place.n + ' (≈ ' + Math.round(x.max / 60) + ' min max pour chacun)', lat: x.place.lat, lng: x.place.lng });
    toast(sent ? 'Rendez-vous proposé au groupe.' : 'Pas de réseau : la proposition partira dès qu’il revient.');
  });
  function renderMeetPlan() {
    const meet = V.map(v => ({ v, who: whoGoesAt(v.id) })).filter(x => x.who.length >= 2).sort((a, b) => (b.who.length - a.who.length) || (a.v.s - b.v.s));
    $('#meet-plan').innerHTML = meet.length ? meet.map(x => '<div class="mrow"><button type="button" class="pl-vn" data-sel="' + x.v.id + '">' + esc(x.v.n) + '</button><span class="pl-h">' + hoursOf(x.v) + '</span>' +
      '<span class="who">' + crewDots(x.who) + ' ' + esc(names(x.who)) + '</span></div>').join('')
      : '<p class="empty">Personne n’a encore choisi le même lieu. Choisissez des DJ avec « J’y vais » : vous verrez ici où vous retrouver.</p>';
  }
  function renderPlans() {
    const list = [...members.values()].sort((a, b) => ((b.id === me.id) - (a.id === me.id)) || (picksOf(b).length - picksOf(a).length) || a.pseudo.localeCompare(b.pseudo));
    $('#plans').innerHTML = list.map(m => {
      const picks = picksOf(m), isMe = m.id === me.id, venues = [...new Set(picks.map(p => p.v.id))];
      let body = '';
      if (!picks.length) body = '<p class="empty">' + (isMe ? 'Tu n’as encore rien choisi. Programme › Line-up, puis touche un DJ.' : esc(m.pseudo) + ' n’a encore rien choisi.') + '</p>';
      for (const vid of venues) {
        const v = byId(vid);
        body += '<div class="pl-v"><button type="button" class="pl-vn" data-sel="' + v.id + '">' + esc(v.n) + '</button><span class="pl-h">' + hoursOf(v) + '</span></div><ul class="artists">' +
          picks.filter(p => p.v.id === vid).map(p => '<li><b>' + esc(p.a) + '</b>' + (!isMe && myStars.has(p.k) ? '<span class="tag t-also">Toi aussi</span>' : '') + '</li>').join('') + '</ul>';
      }
      return '<article class="card pl" id="pl-' + m.id + '"><div class="pl-head"><span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span><div><b>' + esc(isMe ? m.pseudo + ' (toi)' : m.pseudo) + '</b>' +
        '<div class="pl-sub">' + picks.length + ' DJ · ' + venues.length + (venues.length > 1 ? ' lieux' : ' lieu') + '</div></div></div>' + body + '</article>';
    }).join('');
  }
  $('#v-groupe').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) select(b.dataset.sel, true); });

  // Statut rapide
  let myStatus = null, statusHtml = '';
  function renderStatus() {
    const mine = meM(), queued = pendingKey('status');
    if (queued) myStatus = queued.body.status; // choisi hors ligne, pas encore parti
    else if (mine) myStatus = mine.status || null;
    const html = STATUS.map(s => '<button type="button" class="chip' + (s === 'Je suis perdu' ? ' lost' : '') + '" aria-pressed="' + (s === myStatus) + '" data-s="' + esc(s) + '">' + esc(s) + '</button>').join('');
    if (html !== statusHtml) { statusHtml = html; $('#status-chips').innerHTML = html; }
  }
  $('#status-chips').addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const next = b.dataset.s === myStatus ? null : b.dataset.s;
    const p = enqueue('/api/status', { status: next }, 'status');
    myStatus = next; renderStatus(); vibrate(15);
    if (next === 'Je suis perdu') sendHere('Je suis perdu, voici ma position');
    if (!(await p)) toast('Pas de réseau : ton statut partira dès qu’il revient.');
  });
  function renderWalker() {
    const arr = [...members.values()].map(m => ({ n: m.id === me.id ? 'toi' : m.pseudo, km: m.id === me.id ? Math.max(walked, m.km || 0) : (m.km || 0) }))
      .filter(x => x.km > 0).sort((a, b) => b.km - a.km);
    const el = $('#walker');
    if (arr.length < 2 || arr[0].km < 0.3) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = arr[0].n === 'toi' ? 'Tu es le plus gros marcheur : ' + fmtDist(arr[0].km * 1000) + '.' : 'Le plus gros marcheur : ' + arr[0].n + ' (' + fmtDist(arr[0].km * 1000) + ').';
  }

  // ---------- Chat ----------
  let sepFrom = null, jumpN = 0;
  function markRead() {
    unread = 0;
    const last = messages.length ? messages[messages.length - 1].id : 0;
    if (last > seen) { seen = last; store.set('l26.seen', seen); }
    renderBadge();
  }
  function renderBadge() { const b = $('#badge'); b.hidden = unread < 1; b.textContent = unread > 99 ? '99+' : unread; }
  function addMsg(m) {
    if (m.cid) dropOutbox(x => x.body && x.body.cid === m.cid); // notre message en attente est arrivé
    if (messages.some(x => x.id === m.id)) { if (tab === 'chat') renderMsgs(); return; }
    messages.push(m); if (messages.length > 500) messages.shift();
    saveSnap();
    if (m.kind === 'rdv') showRdv();
    if (tab === 'chat') {
      const stick = nearBottom();
      renderMsgs(); markRead();
      if (stick || m.from === me.id) scrollMsgs(true);
      else { jumpN++; renderJump(); }
    } else {
      stale.add('chat');
      if (m.from !== me.id) { unread++; renderBadge(); }
    }
  }
  const nearBottom = () => { const el = $('#msgs'); return el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  function scrollMsgs(force) { const el = $('#msgs'); if (force) { el.scrollTop = el.scrollHeight; jumpN = 0; renderJump(); } }
  function renderJump() { const j = $('#jump'); j.hidden = jumpN < 1; j.textContent = '↓ ' + jumpN + (jumpN > 1 ? ' nouveaux messages' : ' nouveau message'); }
  $('#jump').addEventListener('click', () => scrollMsgs(true));
  $('#msgs').addEventListener('scroll', () => { if (jumpN && nearBottom()) { jumpN = 0; renderJump(); } }, { passive: true });
  let renderedMax = 0; // seuls les messages arrivés après le dernier affichage s'animent
  function renderMsgs() {
    let html = '', lastDay = '', sepDone = false;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i], prev = messages[i - 1], next = messages[i + 1];
      const fresh = renderedMax > 0 && m.id > renderedMax;
      const d = dayKey(m.t);
      let newDay = false;
      if (d !== lastDay) { html += '<li class="day">' + esc(dayLabel(m.t)) + '</li>'; lastDay = d; newDay = true; }
      if (sepFrom != null && !sepDone && m.id > sepFrom && m.from !== me.id) { html += '<li class="new-sep">Nouveaux messages</li>'; sepDone = true; }
      const mine = m.from === me.id;
      const startGroup = newDay || !prev || prev.from !== m.from || m.t - prev.t > 5 * 60e3 || prev.kind !== 'text' || m.kind !== 'text';
      const endGroup = !next || next.from !== m.from || next.t - m.t > 5 * 60e3 || dayKey(next.t) !== d || next.kind !== 'text' || m.kind !== 'text';
      const who = !mine && startGroup ? '<span class="who" style="color:' + esc(m.color) + '">' + esc(m.pseudo) + '</span>' : '';
      let body;
      if (m.kind === 'rdv' || m.kind === 'here') {
        const w = fromMe(m), dist = w ? '<span class="dist">' + esc(fmtWalk(w)) + ' à pied depuis toi</span>' : '';
        body = '<p>' + (m.kind === 'rdv' ? 'Rendez-vous : ' : '') + esc(m.text) + dist + '<button class="btn" type="button" data-rdv="' + m.id + '">Voir sur la carte</button></p>';
      } else body = '<p>' + esc(m.text) + '</p>';
      html += '<li class="m' + (mine ? ' mine' : '') + (startGroup ? ' gap' : '') + (m.kind === 'rdv' ? ' rdv' : m.kind === 'here' ? ' here' : '') + (fresh && !reduced() ? ' pop' : '') + '">' + who + body +
        (endGroup ? '<time datetime="' + new Date(m.t).toISOString() + '">' + clock(m.t) + '</time>' : '') + '</li>';
    }
    // Mes messages pas encore partis : grisés, à la fin, avec « annuler »
    const wait = isOff() ? 'en attente du réseau' : 'envoi…';
    for (const p of outbox) {
      if (p.path !== '/api/msg') continue;
      const b = p.body, k = b.kind === 'rdv' ? ' rdv' : b.kind === 'here' ? ' here' : '';
      html += '<li class="m mine gap pending' + k + '"><p>' + (b.kind === 'rdv' ? 'Rendez-vous : ' : '') + esc(b.text) + '</p>' +
        '<span class="pend">' + wait + ' · <button type="button" class="link" data-cancel="' + esc(p.id) + '">annuler</button></span></li>';
    }
    $('#msgs').innerHTML = html || '<li class="day">Aucun message. Lance la conversation.</li>';
    if (messages.length) renderedMax = messages[messages.length - 1].id;
  }
  $('#msgs').addEventListener('click', e => {
    const c = e.target.closest('[data-cancel]');
    if (c) { dropOutbox(x => x.id === c.dataset.cancel); renderMsgs(); return; }
    const b = e.target.closest('[data-rdv]'); if (!b) return;
    const m = messages.find(x => x.id === +b.dataset.rdv); if (!m) return;
    showTab('carte'); setSnap('min'); flyTo([m.lat, m.lng], 17);
    if (m.kind === 'here') showHere(m);
  });
  function send(text) {
    text = text.trim(); if (!text) return;
    sendMsg({ text }); // part tout de suite, ou dès que le réseau revient
  }
  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('#msg-in');
    send(inp.value); inp.value = '';
    inp.focus();
  });
  $('#quick').innerHTML = '<button type="button" class="hot" data-do="boom">Faire du bruit</button><button type="button" class="hot" data-do="here">Ma position</button>' +
    QUICK.map(q => '<button type="button">' + esc(q) + '</button>').join('');
  $('#quick').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.do === 'boom') return sendBoom();
    if (b.dataset.do === 'here') return sendHere();
    send(b.textContent);
  });
  // Clavier : le champ colle au clavier (iPhone et Android), onglets et raccourcis disparaissent
  const vv = window.visualViewport;
  function onViewport() {
    if (!vv) return;
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', kb + 'px');
    if (document.body.classList.contains('kb')) scrollMsgs(true);
  }
  if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', onViewport); }
  $('#msg-in').addEventListener('focus', () => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    document.body.classList.add('kb'); setTimeout(() => { window.scrollTo(0, 0); onViewport(); scrollMsgs(true); }, 250);
  });
  $('#msg-in').addEventListener('blur', () => { document.body.classList.remove('kb'); document.documentElement.style.setProperty('--kb', '0px'); });
  // Toucher les messages referme le clavier
  $('#msgs').addEventListener('pointerdown', () => { if (document.body.classList.contains('kb')) $('#msg-in').blur(); });

  // Ma position dans le chat
  let hereMarker = null, hereTimer;
  function showHere(m) {
    if (hereMarker) map.removeLayer(hereMarker);
    clearTimeout(hereTimer);
    hereMarker = L.marker([m.lat, m.lng], { zIndexOffset: 850, title: m.pseudo + ' est ici', alt: m.pseudo + ' est ici',
      icon: L.divIcon({ className: '', html: '<div class="pin-hit"><div class="friend" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</div></div>', iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(map);
    hereTimer = setTimeout(() => { if (hereMarker) { map.removeLayer(hereMarker); hereMarker = null; } }, 120000);
  }
  function sendHere(text) {
    if (!navigator.geolocation) return toast('Ce navigateur ne donne pas la position.');
    toast('Recherche de ta position…');
    navigator.geolocation.getCurrentPosition(async p => {
      setMyPos(p);
      const sent = await sendMsg({ text: text || 'Position de ' + me.pseudo, kind: 'here', lat: myPos.lat, lng: myPos.lng });
      toast(sent ? 'Position envoyée au groupe.' : 'Pas de réseau : ta position partira dès qu’il revient.');
    }, err => toast(geoMessage(err)), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

  // ---------- Faire du bruit ----------
  async function sendBoom() {
    // Pas mis en file : un bruit qui arrive 10 minutes plus tard n'a plus de sens
    try { await api('/api/boom'); } catch (err) { if (err.message !== '401') toast(err.offline ? 'Pas de réseau : le bruit n’est pas parti.' : err.message); }
  }
  $('#btn-boom').addEventListener('click', sendBoom);
  function onBoom(d) {
    vibrate([60, 40, 60]);
    const box = $('#burst'), c = COLORS.includes(d.color) ? d.color : '#ffc83d';
    const add = (cls, html, style, life) => { const el = document.createElement('div'); el.className = cls; el.style.cssText = style; if (html) el.textContent = html; box.appendChild(el); setTimeout(() => el.remove(), life); };
    add('btag', d.pseudo + (d.from === me.id ? ' : tu fais du bruit' : ' fait du bruit'), '--c:' + c, 1700);
    if (reduced()) return;
    add('bflash', '', '--c:' + c, 1000);
    add('bring', '', '--c:' + c, 1100);
    const mix = [c, '#ffc83d', '#ff9ccb', '#3ee6d8', '#ffffff'];
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 190;
      add('bp', '', '--c:' + mix[i % mix.length] + ';--dx:' + (Math.cos(a) * r).toFixed(0) + 'px;--dy:' + (Math.sin(a) * r).toFixed(0) + 'px;--s:' + (6 + Math.random() * 12).toFixed(0) + 'px', 1300);
    }
  }

  // ---------- Profil ----------
  function renderMeChip() {
    $('#me-chip').innerHTML = '<span class="dot" style="--c:' + esc(me.color) + '">' + esc(initial(me.pseudo)) + '</span>';
  }
  $('#me-pace').innerHTML = Object.entries(C.PACES).map(([k, p]) => '<option value="' + k + '">' + esc(p.n) + '</option>').join('');
  $('#me-chip').addEventListener('click', () => {
    $('#me-name').textContent = me.pseudo;
    $('#me-km').textContent = walked >= 0.05 ? 'Tes pas : ' + fmtDist(walked * 1000) + ' (comptés tant que tu partages ta position).' : '';
    $('#me-info').textContent = members.size + ' dans le groupe. Pour te reconnecter sur un autre téléphone, entre le même pseudo avec le code du groupe.';
    $('#me-pace').value = C.PACES[pace] ? pace : 'normal';
    $('#depart').value = store.get('l26.depart', '') || 'Gare de Mont-Saint-Guibert';
    $('#me-eco').checked = eco;
    renderTiles();
    const d = $('#me-dialog'); if (d.showModal) d.showModal();
  });
  $('#me-pace').addEventListener('change', () => { pace = $('#me-pace').value; store.set('l26.pace', pace); invalidate('prefs'); if (curRoute) doRoute(); });
  $('#depart').addEventListener('input', () => { store.set('l26.depart', $('#depart').value.trim()); stale.add('prog'); });
  $('#me-eco').addEventListener('change', () => { eco = $('#me-eco').checked; store.set('l26.eco', eco); applyEco(); });
  $('#me-invite').addEventListener('click', async () => {
    const code = store.get('l26.last', {}).code || '';
    const link = location.origin + '/?c=' + encodeURIComponent(code);
    try { await navigator.clipboard.writeText(link); toast('Lien d’invitation copié.'); }
    catch (e) { toast('Copie impossible. Lien : ' + link, 9000); }
    $('#me-dialog').close();
  });
  $('#me-leave').addEventListener('click', async () => {
    try { await api('/api/leave'); } catch (e) {
      if (e.offline || e.retry) return toast('Il faut du réseau pour quitter le groupe.');
      /* sinon : déjà sorti */
    }
    $('#me-dialog').close(); logout();
  });

  // ---------- Mode économie de batterie ----------
  function applyEco() { document.body.classList.toggle('eco', eco); }
  // S'active seul sous 20 % (Android ; l'iPhone ne donne pas la batterie)
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      const check = () => {
        if (!eco && !b.charging && b.level <= .2 && !store.get('l26.ecoAuto', false)) {
          eco = true; store.set('l26.eco', true); store.set('l26.ecoAuto', true); applyEco();
          toast('Batterie faible : mode économie activé (profil pour le couper).', 7000);
        }
      };
      b.addEventListener('levelchange', check); check();
    }).catch(() => {});
  }

  // ---------- Carte hors ligne ----------
  // Les quartiers du festival (tous les lieux et les 4 gares), zooms 13 à 16, environ 200 tuiles.
  // Au-delà du zoom 16, les tuiles sont gardées au fil de la navigation (règles d'OpenStreetMap :
  // pas de téléchargement en masse des zooms 17 et plus).
  const TILE_BOX = { s: 50.826, n: 50.867, w: 4.314, e: 4.372 }, TILE_Z = [13, 16];
  function tileList() {
    const tx = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
    const ty = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
    const out = [];
    for (let z = TILE_Z[0]; z <= TILE_Z[1]; z++)
      for (let x = tx(TILE_BOX.w, z); x <= tx(TILE_BOX.e, z); x++)
        for (let y = ty(TILE_BOX.n, z); y <= ty(TILE_BOX.s, z); y++) out.push('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
    return out;
  }
  let tilesJob = null, tilesProgress = null;
  function renderTiles() {
    const el = $('#me-offline'); if (!el) return;
    const t = store.get('l26.tiles', null);
    if (tilesProgress) el.textContent = 'Carte hors ligne : téléchargement ' + tilesProgress[0] + ' / ' + tilesProgress[1] + '…';
    else if (!('caches' in window)) el.textContent = 'Ce navigateur ne peut pas garder la carte hors ligne.';
    else if (t && t.ok) el.textContent = 'Carte hors ligne prête : les quartiers du festival s’affichent sans réseau.';
    else if (t) el.textContent = 'Carte hors ligne incomplète (' + t.n + ' / ' + t.total + '). Réessaie avec du réseau.';
    else el.textContent = 'Carte hors ligne pas encore téléchargée.';
    $('#me-tiles').disabled = !!tilesJob;
  }
  function downloadTiles(manual) {
    if (tilesJob || !('caches' in window)) return tilesJob;
    tilesJob = (async () => {
      const list = tileList(), c = await caches.open('l26-tiles');
      let i = 0, done = 0, failed = 0;
      tilesProgress = [0, list.length]; renderTiles();
      const worker = async () => {
        while (i < list.length) {
          const u = list[i++];
          try {
            if (!(await c.match(u))) {
              const r = await fetch(u, { mode: 'cors', referrerPolicy: 'strict-origin-when-cross-origin' });
              if (!r.ok) throw new Error(r.status);
              await c.put(u, r);
            }
            done++;
          } catch (e) { failed++; }
          tilesProgress = [done + failed, list.length]; renderTiles();
        }
      };
      await Promise.all([worker(), worker()]); // 2 à la fois : on ménage le serveur de tuiles
      store.set('l26.tiles', { ok: failed === 0, n: done, total: list.length, at: Date.now() });
      if (failed === 0) toast('Carte hors ligne prête : elle s’affichera même sans réseau.');
      else if (manual) toast('Carte hors ligne incomplète : réessaie avec un meilleur réseau.');
    })().catch(() => {}).finally(() => { tilesJob = null; tilesProgress = null; renderTiles(); });
    return tilesJob;
  }
  $('#me-tiles').addEventListener('click', () => downloadTiles(true));

  // Service worker : l'appli s'ouvre même sans réseau
  if ('serviceWorker' in navigator && window.isSecureContext) {
    addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* pas grave : l'appli marche en ligne */ }); });
  }

  // ---------- Horloge de la barre ----------
  function countdown() {
    const h = nowH(), el = $('#countdown'), sub = $('#count-sub');
    if (h >= C.START && h < C.END) { el.textContent = clock(now()); sub.textContent = expressRuns(h) ? 'Express jusqu’à 05:00' : 'en cours'; return; }
    if (h >= C.END) { el.textContent = 'Fini'; sub.textContent = '21 → 22 nov.'; return; }
    const days = Math.round((Date.UTC(2026, 10, 21) - Date.UTC(...todayBxl())) / 864e5);
    el.textContent = days === 0 ? 'Jour J' : 'J-' + days; sub.textContent = days === 0 ? 'dès 14:00' : '21 → 22 nov.';
  }
  setInterval(() => { countdown(); if (me) invalidate('time'); }, 30000);

  // ---------- Départ ----------
  renderShareBtn(); countdown();
  if (me && me.token) boot(); else showLogin();
})();
