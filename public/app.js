'use strict';
// Plan Listen 2026 : carte, potes en direct, itinéraires à pied, chat, line-up partagé.
// Les données du festival sont dans data.js ; le serveur (server.js) relaie messages, positions et « J'y vais ».
(() => {
  // ---------- Outils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = () => (reduced() ? 'auto' : 'smooth');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };
  const byId = id => V.find(v => v.id === id);
  const initial = s => (Array.from(String(s))[0] || '?').toUpperCase();
  const tagOf = n => (T.pick.includes(n) ? 'pick' : T.check.includes(n) ? 'check' : T.skip.includes(n) ? 'skip' : null);
  const starKey = (vid, a) => vid + '|' + a;

  // Début du festival : sam. 21/11/2026 00:00 à Bruxelles = 20/11 23:00 UTC. h = heures depuis cet instant.
  const T0 = Date.UTC(2026, 10, 20, 23, 0);
  const nowH = () => (Date.now() - T0) / 36e5;
  const hh = h => pad(Math.floor(h % 24)) + ':' + pad(Math.round((h % 1) * 60));
  const fmtH = h => (h >= 24 ? 'dim. ' : 'sam. ') + hh(h);
  const BXL = { timeZone: 'Europe/Brussels' };
  const clock = t => new Intl.DateTimeFormat('fr-BE', { ...BXL, hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  const dayKey = t => new Intl.DateTimeFormat('en-CA', BXL).format(new Date(t));
  const dayLabel = t => new Intl.DateTimeFormat('fr-BE', { ...BXL, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(t));

  function km(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = m => (m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
  const fmtDur = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60); };

  let toastTimer;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  let hintTimer;
  function hint(msg, ms = 4500) {
    const el = $('#map-hint'); el.textContent = msg; el.hidden = false;
    clearTimeout(hintTimer); if (ms) hintTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- État ----------
  let me = store.get('l26.me', null);                 // { token, id, pseudo, color }
  let members = new Map();                              // id -> { id, pseudo, color, stars, online, sharing, pos }
  let messages = [];
  let myStars = new Set(store.get('l26.stars', []));
  let sel = 'hexagon', filter = 'all', tab = 'carte';
  let myPos = null, sharing = false, watchId = null, lastSent = null, wake = null;
  let es = null, skew = 0, unread = 0, seen = store.get('l26.seen', 0), walked = store.get('l26.km', 0);

  // ---------- Réseau ----------
  async function api(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(me ? { Authorization: 'Bearer ' + me.token } : {}) },
      body: JSON.stringify(body || {}),
    });
    let data = null; try { data = await r.json(); } catch (e) { /* pas de JSON */ }
    if (r.status === 401 && me && path !== '/api/join') { logout('Ta connexion a expiré. Entre à nouveau dans le groupe.'); throw new Error('401'); }
    if (!r.ok) throw new Error((data && data.error) || 'Erreur ' + r.status);
    return data;
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
      const el = $('#login-err'); el.hidden = false; el.textContent = err.message;
    } finally { btn.disabled = false; }
  });
  function logout(msg) { me = null; store.del('l26.me'); members = new Map(); messages = []; showLogin(msg); }

  // ---------- Démarrage de l'appli ----------
  function boot() {
    $('#login').hidden = true; $('#app').hidden = false;
    initMap();
    renderAll();
    showTab((location.hash || '').slice(1) || 'carte', false);
    connect();
  }

  // ---------- Temps réel (SSE) ----------
  function setConn(s) {
    const el = $('#conn'); el.className = 'status ' + s;
    $('#conn-txt').textContent = s === 'on' ? 'En direct' : 'Reconnexion…';
  }
  function closeStream() { if (es) { es.close(); es = null; } }
  function connect() {
    closeStream(); setConn('wait');
    es = new EventSource('/api/events?token=' + encodeURIComponent(me.token));
    es.addEventListener('state', ev => {
      const d = JSON.parse(ev.data);
      skew = d.now - Date.now();
      members = new Map(d.members.map(m => [m.id, m]));
      messages = d.messages;
      setConn('on');
      adoptServerStars();
      unread = tab === 'chat' ? 0 : messages.filter(m => m.id > seen && m.from !== me.id).length;
      renderAll();
      if (tab === 'chat') markRead();
    });
    es.addEventListener('member', ev => {
      const m = JSON.parse(ev.data), prev = members.get(m.id);
      members.set(m.id, m);
      renderPotes(); syncFriendMarkers(); renderMeChip(); refreshRouteSelects();
      if (!prev || JSON.stringify(prev.stars) !== JSON.stringify(m.stars)) { renderVenue(); renderLineup(); renderFrise(); }
    });
    es.addEventListener('gone', ev => {
      members.delete(JSON.parse(ev.data).id);
      renderPotes(); syncFriendMarkers(); renderVenue(); renderLineup(); refreshRouteSelects();
    });
    es.addEventListener('msg', ev => addMsg(JSON.parse(ev.data)));
    es.addEventListener('boom', ev => onBoom(JSON.parse(ev.data)));
    es.onerror = () => {
      setConn('wait');
      if (es && es.readyState === EventSource.CLOSED) {
        // Le serveur a refusé : session expirée ? api() nous déconnecte si c'est le cas, sinon on reconnecte.
        setTimeout(() => { if (me) api('/api/stars', { stars: [...myStars] }).then(connect).catch(() => {}); }, 2500);
      }
    };
  }

  // ---------- Onglets ----------
  let mapShown = false;
  function showTab(name, push = true) {
    if (!['carte', 'plan', 'lineup', 'chat'].includes(name)) name = 'carte';
    tab = name;
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
    $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
    const ind = $('.tabs .ind'); if (ind) ind.style.transform = 'translateX(' + ['carte', 'plan', 'lineup', 'chat'].indexOf(name) * 100 + '%)';
    if (push) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignoré */ } }
    if (name === 'carte' && map) {
      map.invalidateSize();
      if (!mapShown) { mapShown = true; fitIds(null, false); }
    }
    if (name === 'chat') { markRead(); scrollMsgs(true); }
    window.scrollTo(0, 0);
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
  function fitIds(ids, animate = true) {
    const pts = (ids || V.map(v => v.id)).map(id => byId(id)).map(v => [v.lat, v.lng]);
    const b = L.latLngBounds(pts);
    if (animate && !reduced()) map.flyToBounds(b, { padding: [36, 36], duration: .6 }); else map.fitBounds(b, { padding: [36, 36], animate: false });
  }
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 11, maxZoom: 19 });
    L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    map.setView([50.845, 4.352], 14);
    // Voie ferrée Nord – Congrès – Central – Midi
    L.polyline([GARES.nord, GARES.congres, GARES.central, GARES.midi].map(g => [g.lat, g.lng]), { className: 'rail-line', weight: 4, dashArray: '9 8', opacity: .95, interactive: false }).addTo(map);
    L.marker([GARES.midi.lat, GARES.midi.lng], { icon: L.divIcon({ className: '', html: '<div class="station"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, keyboard: false })
      .bindTooltip('Gare du Midi', { permanent: true, direction: 'left', offset: [-8, 0], className: 'pin-lbl' }).addTo(map);
    V.forEach((v, i) => {
      const m = L.marker([v.lat, v.lng], {
        icon: L.divIcon({ className: '', html: '<div class="pin-hit"><div class="pin k-' + v.k + (v.approx ? ' approx' : '') + '" data-id="' + v.id + '">' + (i + 1) + '</div></div>', iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: v.n, alt: v.n, riseOnHover: true,
      }).addTo(map);
      m.bindTooltip(v.n.replace(' & La Fabriek', ''), { permanent: true, direction: 'right', offset: [24, 0], className: 'pin-lbl' });
      m.on('click', () => select(v.id, false));
      venueMarkers[v.id] = m;
    });
    const lbl = () => $('#map').classList.toggle('show-lbl', map.getZoom() >= 15);
    map.on('zoomend', lbl); lbl();
    map.on('click', onMapClick);
    $('#zoom').innerHTML = ZOOMS.map((z, i) => '<button type="button" class="chip" data-z="' + i + '">' + z.n + '</button>').join('');
    markSel();
  }
  $('#zoom').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) fitIds(ZOOMS[+b.dataset.z].ids); });
  function markSel() {
    $$('#map .pin').forEach(p => p.classList.toggle('sel', p.dataset.id === sel));
    const onRoute = new Set(ROUTE.map(r => r.id));
    $$('#map .pin').forEach(p => p.classList.toggle('route', onRoute.has(p.dataset.id)));
  }

  // Les potes sur la carte
  const ageSec = t => (Date.now() + skew - t) / 1000;
  function ageText(t) {
    const s = ageSec(t);
    if (s < 25) return 'à l’instant';
    if (s < 90) return 'il y a ' + Math.round(s) + ' s';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    return 'il y a plus d’1 h';
  }
  function syncFriendMarkers() {
    if (!map) return;
    const live = new Set();
    for (const m of members.values()) {
      if (m.id === me.id || !m.sharing || !m.pos) continue;
      live.add(m.id);
      const old = ageSec(m.pos.t) > 180;
      const icon = L.divIcon({ className: '', html: '<div class="pin-hit"><div class="friend' + (old ? ' old' : '') + '" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</div></div>', iconSize: [44, 44], iconAnchor: [22, 22] });
      const tip = '<span class="fl" style="background:' + esc(m.color) + '">' + esc(m.pseudo) + (m.status ? ' · ' + esc(m.status) : '') + '</span>';
      let mk = friendMarkers[m.id];
      if (!mk) {
        mk = L.marker([m.pos.lat, m.pos.lng], { icon, zIndexOffset: 800, title: m.pseudo, alt: m.pseudo }).addTo(map);
        mk.bindTooltip(tip, { permanent: true, direction: 'top', offset: [0, -24], className: 'friend-lbl' });
        mk.on('click', () => { fitMember(m.id); });
        friendMarkers[m.id] = mk;
      } else { mk.setLatLng([m.pos.lat, m.pos.lng]); mk.setIcon(icon); mk.setTooltipContent(tip); }
    }
    for (const id of Object.keys(friendMarkers)) if (!live.has(id)) { map.removeLayer(friendMarkers[id]); delete friendMarkers[id]; }
  }
  function fitMember(id) {
    const m = members.get(id); if (!m || !m.pos) return;
    showTab('carte'); map.flyTo([m.pos.lat, m.pos.lng], Math.max(map.getZoom(), 17), { duration: reduced() ? 0 : .6 });
  }
  function updateMeMarker() {
    if (!map || !myPos) return;
    const ll = [myPos.lat, myPos.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 700, interactive: false, keyboard: false }).addTo(map);
      meAcc = L.circle(ll, { radius: myPos.acc || 0, color: '#3d8bff', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); meAcc.setLatLng(ll); meAcc.setRadius(Math.min(myPos.acc || 0, 500)); }
  }

  // Ma position
  function geoMessage(err) {
    if (!window.isSecureContext) return 'La position ne marche que sur une adresse sécurisée (https).';
    if (err.code === 1) return 'Position refusée. Autorise-la dans les réglages du navigateur pour ce site.';
    return 'Position introuvable pour l’instant. Va à l’extérieur ou réessaie.';
  }
  function setMyPos(p) {
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    updateMeMarker(); refreshRouteSelects();
  }
  $('#btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) return hint('Ce navigateur ne donne pas la position.');
    hint('Recherche de ta position…', 0);
    navigator.geolocation.getCurrentPosition(p => {
      setMyPos(p); $('#map-hint').hidden = true;
      map.flyTo([myPos.lat, myPos.lng], Math.max(map.getZoom(), 16), { duration: reduced() ? 0 : .6 });
    }, err => hint(geoMessage(err), 6000), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  });
  $('#btn-fit').addEventListener('click', () => {
    const pts = [];
    if (myPos) pts.push([myPos.lat, myPos.lng]);
    for (const m of members.values()) if (m.id !== me.id && m.sharing && m.pos) pts.push([m.pos.lat, m.pos.lng]);
    if (pts.length < 2) return hint(pts.length ? 'Personne d’autre ne partage sa position.' : 'Personne ne partage sa position pour l’instant.');
    map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 17, duration: reduced() ? 0 : .6 });
  });
  function renderShareBtn() {
    const b = $('#btn-share'); b.setAttribute('aria-pressed', sharing);
    b.innerHTML = '<span class="dot"></span>' + (sharing ? 'Tu partages · arrêter' : 'Partager ma position');
  }
  function startShare() {
    if (!navigator.geolocation) return hint('Ce navigateur ne donne pas la position.');
    if (watchId != null) return;
    sharing = true; lastSent = null; renderShareBtn();
    watchId = navigator.geolocation.watchPosition(onGeo, err => {
      hint(geoMessage(err), 7000);
      if (err.code === 1) stopShare(true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    requestWake();
    hint('Le groupe te voit sur la carte. Garde cette page ouverte pour que ça continue.', 6000);
  }
  function stopShare(notify = true) {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null; sharing = false; renderShareBtn(); releaseWake(); lastSent = null;
    if (notify && me) api('/api/pos', { sharing: false }).catch(() => {});
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
    const t = Date.now(), moved = lastSent ? km(lastSent, myPos) * 1000 : Infinity, dt = lastSent ? t - lastSent.t : Infinity;
    if (!lastSent || moved > 25 || (dt > 12000 && moved > 5) || dt > 45000) {
      lastSent = { lat: myPos.lat, lng: myPos.lng, t };
      api('/api/pos', { lat: myPos.lat, lng: myPos.lng, acc: myPos.acc, km: Math.round(walked * 100) / 100 }).catch(() => {});
    }
  }
  $('#btn-share').addEventListener('click', () => (sharing ? stopShare(true) : startShare()));
  async function requestWake() {
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
  }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* ignoré */ } wake = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && sharing) requestWake(); });

  // Point de rendez-vous
  function setPlacing(on) {
    placing = on; $('#btn-rdv').setAttribute('aria-pressed', on);
    $('#map').style.cursor = on ? 'crosshair' : '';
    if (on) hint('Touche la carte à l’endroit du rendez-vous.', 0); else $('#map-hint').hidden = true;
  }
  $('#btn-rdv').addEventListener('click', () => { if (placing) { cancelRdv(); } else { setPlacing(true); } });
  function onMapClick(e) {
    if (!placing) return;
    pendingRdv = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (tempRdv) map.removeLayer(tempRdv);
    tempRdv = rdvPin(pendingRdv, 'RDV');
    setPlacing(false);
    const f = $('#rdv-form'); f.hidden = false; $('#rdv-txt').focus(); f.scrollIntoView({ block: 'nearest', behavior: smooth() });
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
    try {
      addMsg(await api('/api/msg', { text, kind: 'rdv', lat: pendingRdv.lat, lng: pendingRdv.lng }));
      toast('Rendez-vous envoyé au groupe.');
      cancelRdv();
    } catch (err) { toast(err.message); }
  });
  function showRdv() {
    const last = [...messages].reverse().find(m => m.kind === 'rdv');
    if (rdvMarker) { map.removeLayer(rdvMarker); rdvMarker = null; }
    if (!last || !map) return;
    rdvMarker = rdvPin(last, last.text).bindTooltip(esc(last.pseudo) + ' : ' + esc(last.text), { permanent: true, direction: 'right', offset: [18, -22], className: 'pin-lbl rdv-lbl' });
  }

  // ---------- Potes ----------
  function nearestPlace(pos) {
    let best = null;
    for (const p of [...V, ...Object.values(GARES)]) {
      const d = km(pos, p) * 1000;
      if (d <= 120 && (!best || d < best.d)) best = { d, n: p.n };
    }
    return best && best.n;
  }
  function renderPotes() {
    const others = [...members.values()].filter(m => m.id !== me.id)
      .sort((a, b) => (b.sharing - a.sharing) || (b.online - a.online) || a.pseudo.localeCompare(b.pseudo));
    $('#potes-n').textContent = members.size + (members.size > 1 ? ' dans le groupe' : ' dans le groupe');
    renderWalker(); renderStatus();
    if (!others.length) {
      $('#potes').innerHTML = '<li class="empty">Personne d’autre pour l’instant. Envoie le lien d’invitation depuis ton profil (en haut à droite).</li>';
      return;
    }
    $('#potes').innerHTML = others.map(m => {
      let sub;
      if (m.sharing && m.pos) {
        const near = nearestPlace(m.pos), dist = myPos ? ' · à ' + fmtDist(km(myPos, m.pos) * 1000) + ' de toi' : '';
        sub = '<span class="live' + (ageSec(m.pos.t) > 180 ? ' off' : '') + '"></span>' + ageText(m.pos.t) + (near ? ' · près de ' + esc(near) : '') + dist;
      } else sub = '<span class="live off"></span>' + (m.online ? 'en ligne, position non partagée' : 'hors ligne');
      const statTag = m.status ? '<span class="stat' + (m.status === 'Je suis perdu' ? ' lost' : '') + '">' + esc(m.status) + '</span>' : '';
      const walkTxt = (m.km || 0) >= 0.1 ? ' · ' + fmtDist(m.km * 1000) + ' marchés' : '';
      const n = (m.stars || []).length;
      const planBtn = n ? '<br><button class="link" type="button" data-act="plan" data-id="' + m.id + '">Son planning · ' + n + ' DJ</button>' : '';
      const acts = m.sharing && m.pos ? '<button class="btn" type="button" data-act="see" data-id="' + m.id + '">Voir</button><button class="btn" type="button" data-act="go" data-id="' + m.id + '">Y aller</button>' : '';
      return '<li class="pote"><span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span><div><b>' + esc(m.pseudo) + '</b>' + statTag + '<div class="sub">' + sub + walkTxt + planBtn + '</div></div><div class="acts">' + acts + '</div></li>';
    }).join('');
  }
  $('#potes').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'see') fitMember(b.dataset.id);
    if (b.dataset.act === 'plan') openCrewPlan(b.dataset.id);
    if (b.dataset.act === 'go') routeBetween(myPos ? 'me' : null, 'f:' + b.dataset.id);
  });
  setInterval(() => { if (me && !$('#app').hidden) { renderPotes(); syncFriendMarkers(); } }, 20000);

  // ---------- « J'y vais » partagé ----------
  function whoGoes(key) {
    const out = [];
    for (const m of members.values()) {
      const goes = m.id === me.id ? myStars.has(key) : (m.stars || []).includes(key);
      if (goes) out.push(m);
    }
    return out;
  }
  const crewDots = list => list.length ? '<span class="crew" title="' + esc(list.map(m => m.pseudo).join(', ')) + '">' +
    list.map(m => '<span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span>').join('') + '</span>' : '';
  function adoptServerStars() {
    const mine = members.get(me.id);
    if (!mine) return;
    if (!mine.stars.length && myStars.size) pushStars(); else { myStars = new Set(mine.stars); store.set('l26.stars', [...myStars]); }
  }
  let starTimer;
  function pushStars() { clearTimeout(starTimer); starTimer = setTimeout(() => api('/api/stars', { stars: [...myStars] }).catch(() => {}), 250); }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-star]'); if (!b) return;
    const k = b.dataset.star;
    myStars.has(k) ? myStars.delete(k) : myStars.add(k);
    store.set('l26.stars', [...myStars]); pushStars();
    renderVenue(); renderLineup(); renderFrise();
  });
  function artistLi(v, a) {
    const t = tagOf(a), k = starKey(v.id, a), on = myStars.has(k);
    const meta = (t ? '<span class="tag t-' + t + '">' + TAG_TXT[t] + '</span>' : '') + crewDots(whoGoes(k));
    return '<li class="' + (t === 'skip' ? 'a-skip' : '') + '"><span class="a-name"><b>' + esc(a) + '</b>' + (meta ? '<span class="a-meta">' + meta + '</span>' : '') + '</span>' +
      '<button type="button" class="go" data-star="' + esc(k) + '" aria-pressed="' + on + '">' + (on ? '★ J’y vais' : 'J’y vais') + '</button></li>';
  }

  // ---------- Fiche du lieu ----------
  function openState(v) {
    const h = nowH(), end = v.e;
    if (h >= v.s && h < end) return '<span class="open yes">Ouvert</span>';
    if (h < v.s) return '<span class="open">Ouvre ' + fmtH(v.s) + '</span>';
    return '<span class="open">Terminé</span>';
  }
  function renderVenue() {
    const v = byId(sel), i = V.indexOf(v) + 1;
    const kTxt = { club: 'Club de nuit', jour: 'Club, ouvert en journée', disq: 'Disquaire · Vedett LISTENing Session' }[v.k];
    const fin = v.tbc ? 'fin à confirmer (le site affiche 23:00 - 23:00)' : fmtH(v.e);
    const near = Object.values(GARES).map(g => ({ g, d: km(v, g) * 1000 })).sort((a, b) => a.d - b.d)[0];
    const going = new Set(); for (const a of v.ar) for (const m of whoGoes(starKey(v.id, a))) going.add(m);
    $('#venue').innerHTML =
      '<div><p class="label">' + i + ' · ' + kTxt + '</p><h3>' + esc(v.n) + '</h3></div>' +
      '<p class="when">' + fmtH(v.s) + ' → ' + fin + ' ' + openState(v) + '</p>' +
      '<p class="mute">' + esc(v.a) + (v.osm ? ' <span class="small">(adresse d’après OpenStreetMap)</span>' : '') + (v.approx ? ' <span class="small">(position approximative)</span>' : '') +
      '<br>Gare la plus proche : ' + near.g.n.replace('Gare ', '').replace('du ', '').replace('de ', '') + ', ' + fmtDist(near.d) + ' à vol d’oiseau</p>' +
      (going.size ? '<p class="small mute">Y vont : ' + crewDots([...going]) + '</p>' : '') +
      '<div class="links"><button class="btn main" type="button" data-act="goto" data-id="' + v.id + '">Y aller à pied</button><button class="btn" type="button" data-act="center" data-id="' + v.id + '">Centrer la carte</button></div>' +
      '<div><p class="label" style="margin-bottom:6px">Line-up</p><ul class="artists">' + v.ar.map(a => artistLi(v, a)).join('') + '</ul></div>';
  }
  $('#venue').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'goto') routeBetween(myPos ? 'me' : null, b.dataset.id);
    if (b.dataset.act === 'center') { const v = byId(b.dataset.id); map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), 16), { duration: reduced() ? 0 : .6 }); }
  });
  function select(id, focus) {
    sel = id; renderVenue(); renderFrise(); markSel();
    const to = $('#r-to'); if (to && [...to.options].some(o => o.value === id)) to.value = id;
    if (focus) { showTab('carte'); const v = byId(id); map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), 16), { duration: reduced() ? 0 : .6 }); }
  }

  // ---------- Itinéraire à pied (OpenStreetMap, calculé dans le site) ----------
  function pointById(id) {
    if (id === 'me') return myPos && { n: 'Ma position', ...myPos };
    if (id.startsWith('f:')) { const m = members.get(id.slice(2)); return m && m.pos && { n: m.pseudo, lat: m.pos.lat, lng: m.pos.lng }; }
    if (id.startsWith('g-')) return Object.values(GARES).find(g => g.id === id);
    return byId(id);
  }
  let selSig = '';
  function refreshRouteSelects() {
    const friends = [...members.values()].filter(m => m.id !== me.id && m.sharing && m.pos);
    const sig = [!!myPos, friends.map(f => f.id).join(',')].join('|');
    if (sig === selSig && $('#r-from').options.length) return;
    selSig = sig;
    const opts = (...groups) => groups.filter(g => g.items.length).map(g =>
      '<optgroup label="' + g.label + '">' + g.items.map(i => '<option value="' + esc(i.id) + '">' + esc(i.n) + '</option>').join('') + '</optgroup>').join('');
    const perso = { label: 'Autour de toi', items: [...(myPos ? [{ id: 'me', n: 'Ma position' }] : []), ...friends.map(f => ({ id: 'f:' + f.id, n: f.pseudo }))] };
    const html = opts(perso, { label: 'Lieux', items: V.map(v => ({ id: v.id, n: v.n })) }, { label: 'Gares', items: Object.values(GARES).map(g => ({ id: g.id, n: g.n })) });
    const from = $('#r-from'), to = $('#r-to'), pf = from.value, pt = to.value;
    from.innerHTML = html; to.innerHTML = html;
    from.value = [...from.options].some(o => o.value === pf) ? pf : (myPos ? 'me' : 'g-central');
    to.value = [...to.options].some(o => o.value === pt) ? pt : sel;
  }
  const rmem = new Map();
  async function walk(a, b) {
    const key = [a.lat, a.lng, b.lat, b.lng].map(x => x.toFixed(5)).join(',');
    if (rmem.has(key)) return rmem.get(key);
    const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson&steps=true';
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('routage ' + r.status);
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes[0]) throw new Error('aucun chemin');
    const rt = j.routes[0];
    const res = { d: rt.distance, t: rt.duration, geo: rt.geometry.coordinates.map(([x, y]) => [y, x]), steps: rt.legs[0].steps };
    rmem.set(key, res);
    return res;
  }
  const TURN = { left: 'Tournez à gauche', 'slight left': 'Serrez légèrement à gauche', 'sharp left': 'Tournez franchement à gauche', right: 'Tournez à droite', 'slight right': 'Serrez légèrement à droite', 'sharp right': 'Tournez franchement à droite', straight: 'Continuez tout droit', uturn: 'Faites demi-tour' };
  function dirText(s) {
    const m = s.maneuver || {}, name = s.name ? ' sur ' + s.name : '';
    if (m.type === 'depart') return 'Partez' + (s.name ? ' par ' + s.name : '');
    if (m.type === 'arrive') return 'Vous êtes arrivé';
    if (/roundabout|rotary/.test(m.type)) return 'Au rond-point, prenez la sortie' + (m.exit ? ' n° ' + m.exit : '') + name;
    return (TURN[m.modifier] || 'Continuez') + name;
  }
  function drawRoute(geo, a, b) {
    clearRoute();
    routeLayer = L.layerGroup([
      L.polyline(geo, { color: '#0b0714', weight: 11, opacity: .6, interactive: false }),
      L.polyline(geo, { color: '#3ee6d8', weight: 5, opacity: 1, interactive: false, className: 'route-line' }),
      L.circleMarker([b.lat, b.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#3ee6d8', fillOpacity: 1, interactive: false }),
    ]).addTo(map);
    map.flyToBounds(L.latLngBounds(geo), { padding: [50, 50], maxZoom: 18, duration: reduced() ? 0 : .6 });
  }
  function clearRoute() { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } }
  async function doRoute() {
    const a = pointById($('#r-from').value), b = pointById($('#r-to').value), out = $('#route-out');
    if (!a) { out.innerHTML = '<p class="err">Ta position n’est pas connue. Touche « Moi » sur la carte ou choisis un autre départ.</p>'; return; }
    if (!b) { out.innerHTML = '<p class="err">Cette destination n’a pas de position.</p>'; return; }
    if (a === b || (a.lat === b.lat && a.lng === b.lng)) { out.innerHTML = '<p class="mute">Le départ et l’arrivée sont au même endroit.</p>'; return; }
    out.innerHTML = '<p class="mute">Calcul de l’itinéraire…</p>';
    try {
      const r = await walk(a, b);
      drawRoute(r.geo, a, b);
      const steps = r.steps.filter(s => s.distance > 0 || (s.maneuver && s.maneuver.type === 'arrive'));
      out.innerHTML = '<div class="route-sum"><b>' + fmtDur(r.t) + '</b><span>' + fmtDist(r.d) + ' à pied</span><button class="btn" type="button" data-act="clear" style="margin-left:auto">Effacer</button></div>' +
        '<p class="small mute">' + esc(a.n) + ' → ' + esc(b.n) + '</p>' +
        '<ol class="dirs">' + steps.map(s => '<li><span>' + esc(dirText(s)) + '</span><span class="d">' + (s.distance ? fmtDist(s.distance) : '') + '</span></li>').join('') + '</ol>';
    } catch (err) {
      const line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#3ee6d8', weight: 4, dashArray: '4 8', interactive: false });
      clearRoute(); routeLayer = L.layerGroup([line]).addTo(map);
      out.innerHTML = '<p class="err">Impossible de calculer le trajet (réseau ou service indisponible).</p><p class="mute">À vol d’oiseau : ' + fmtDist(km(a, b) * 1000) + ' (≈ ' + fmtDur(km(a, b) * 1000 * 1.35 / 1.3) + ' à pied).</p>';
    }
  }
  $('#r-go').addEventListener('click', doRoute);
  $('#route-out').addEventListener('click', e => { if (e.target.closest('[data-act="clear"]')) { clearRoute(); $('#route-out').innerHTML = ''; } });
  function routeBetween(fromId, toId) {
    showTab('carte'); refreshRouteSelects();
    if (!fromId) { toast('Ta position n’est pas connue : choisis un départ, ou touche « Moi » sur la carte.'); }
    else $('#r-from').value = fromId;
    if ([...$('#r-to').options].some(o => o.value === toId)) $('#r-to').value = toId;
    if (!byId(toId) && !toId.startsWith('f:') && !toId.startsWith('g-')) return;
    if (byId(toId)) { sel = toId; renderVenue(); renderFrise(); markSel(); }
    $('.map-wrap').scrollIntoView({ block: 'start', behavior: smooth() });
    doRoute();
  }

  // ---------- Plan : frise et parcours ----------
  const H0 = 14, H1 = 38;
  const pct = h => ((Math.min(Math.max(h, H0), H1) - H0) / (H1 - H0)) * 100;
  const onRoute = id => ROUTE.some(r => r.id === id);
  const starsAt = vid => [...myStars].filter(k => k.startsWith(vid + '|')).length;
  function renderFrise() {
    let html = '<div class="fr-axis"><span></span><div class="fr-hours">';
    for (let h = H0; h <= H1; h += 2) html += '<span style="left:' + pct(h) + '%">' + pad(h % 24) + 'h</span>';
    html += '</div></div>';
    const h = nowH();
    const nowLine = h > H0 && h < H1 ? '<i class="fr-now" style="left:' + pct(h) + '%" title="Maintenant"></i>' : '';
    const rows = V.map(v => ({ id: v.id, n: v.n, s: v.s, e: v.e, k: v.tbc ? 'tbc' : v.k }));
    rows.splice(6, 0, { id: 'express', n: EXPRESS.n, s: EXPRESS.s, e: EXPRESS.e, k: 'rail' });
    for (const [i, r] of rows.entries()) {
      const st = r.id === 'express' ? 0 : starsAt(r.id);
      const lab = hh(r.s) + '–' + (r.k === 'tbc' ? '?' : hh(r.e));
      html += '<div class="fr-row' + (r.id === sel ? ' sel' : '') + '"><button type="button" class="fr-name" data-go="' + r.id + '"><span>' + esc(r.n) + '</span>' +
        (r.id === 'express' ? '' : miniCrew(r.id)) + '</button><div class="fr-track">' + nowLine +
        '<button type="button" class="fr-bar k-' + r.k + (onRoute(r.id) ? ' route' : '') + '" data-go="' + r.id + '" style="left:' + pct(r.s) + '%;width:' + (pct(r.e) - pct(r.s)) + '%;--i:' + i + '" aria-label="' +
        esc(r.n) + ' : ' + fmtH(r.s) + ' à ' + (r.k === 'tbc' ? 'fin à confirmer' : fmtH(r.e)) + '">' + lab + '</button></div></div>';
    }
    $('#frise-grid').innerHTML = html;
  }
  $('#frise-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'express') { showTab('carte'); fitRail(); return; }
    select(b.dataset.go, true);
  });
  function fitRail() { map.flyToBounds(L.latLngBounds([GARES.nord, GARES.midi].map(g => [g.lat, g.lng])), { padding: [60, 60], duration: reduced() ? 0 : .6 }); }

  function renderSteps() {
    const depart = $('#depart').value.trim() || 'Gare de Mont-Saint-Guibert';
    $('#steps').innerHTML = ROUTE.map((r, i) => {
      const v = byId(r.id);
      const who = v ? v.ar.filter(a => ['pick', 'check'].includes(tagOf(a))).map(a => '<span class="tag t-' + tagOf(a) + '">' + esc(a) + '</span>').join('') : '<span class="mute">O’SIMMIE, LOV, Vera Moro</span>';
      const train = r.train ? '<p class="small mute">' + esc(depart) + ' → ' + esc(r.train) + '</p>' : '';
      const btn = r.leg ? '<button class="btn' + (i === 0 ? ' main' : '') + '" type="button" data-leg="' + i + '">Voir le trajet à pied</button><span class="mute mono small" data-eta="' + i + '">calcul…</span>'
        : '<button class="btn" type="button" data-leg="' + i + '">Voir Nord → Midi</button><span class="mute mono small">' + fmtDist(km(GARES.nord, GARES.midi) * 1000) + ' à vol d’oiseau, par le rail</span>';
      return '<li class="step"><span class="h">' + hh(r.h) + '</span><div class="body"><h3>' + esc(r.titre) + '</h3><p>' + esc(r.txt) + '</p>' + train +
        '<div class="who">' + who + '</div><div class="links" style="align-items:center">' + btn + '</div></div></li>';
    }).join('');
    ROUTE.forEach(async (r, i) => {
      if (!r.leg) return;
      try {
        const res = await walk(pointById(r.leg.from), pointById(r.leg.to));
        const el = $('[data-eta="' + i + '"]'); if (el) el.textContent = fmtDur(res.t) + ' · ' + fmtDist(res.d);
      } catch (e) { const el = $('[data-eta="' + i + '"]'); if (el) el.textContent = 'trajet indisponible'; }
    });
    $('#hors-parcours').innerHTML = 'Hors parcours : <b>Mike Servito</b> (incontournable) joue à Studio CityGate, à Anderlecht, de 23:00 jusqu’au dimanche ; <b>tINI</b> (à écouter) à Blur jusqu’à dim. 14:00, et <b>Haumea</b> à C12 jusqu’à 07:00.';
  }
  $('#steps').addEventListener('click', e => {
    const b = e.target.closest('[data-leg]'); if (!b) return;
    const r = ROUTE[+b.dataset.leg];
    if (!r.leg) { showTab('carte'); fitRail(); return; }
    showTab('carte'); refreshRouteSelects();
    $('#r-from').value = r.leg.from; $('#r-to').value = r.leg.to;
    sel = r.id; renderVenue(); renderFrise(); markSel();
    $('.map-wrap').scrollIntoView({ block: 'start', behavior: smooth() });
    doRoute();
  });
  $('#depart').addEventListener('input', () => { store.set('l26.depart', $('#depart').value); renderSteps(); });

  // ---------- Line-up ----------
  let luMode = 'lieux';
  function renderLineup() {
    $('#lu-lieux').hidden = luMode !== 'lieux'; $('#lu-potes').hidden = luMode !== 'potes';
    if (luMode === 'potes') return renderCrewPlan();
    const cards = V.map(v => {
      const list = v.ar.filter(a => {
        const k = starKey(v.id, a);
        if (filter === 'all') return true;
        if (filter === 'stars') return myStars.has(k);
        if (filter === 'crew') return whoGoes(k).length > 0;
        return ['pick', 'check'].includes(tagOf(a)) || myStars.has(k);
      });
      if (!list.length) return '';
      return '<article class="card lu-card"><header><button type="button" data-sel="' + v.id + '">' + esc(v.n) + '</button><span class="mono mute small" style="white-space:nowrap">' + hh(v.s) + '–' + (v.tbc ? '?' : hh(v.e)) + '</span></header>' +
        '<ul class="artists">' + list.map(a => artistLi(v, a)).join('') + '</ul></article>';
    }).join('');
    const empty = { stars: 'Aucun DJ choisi pour l’instant. Touche « J’y vais » à côté d’un nom pour le retrouver ici.', crew: 'Personne du groupe n’a encore choisi de DJ.', gouts: 'Aucun artiste de tes goûts dans ce filtre.', all: '' }[filter];
    $('#lu').innerHTML = cards || '<p class="empty">' + empty + '</p>';
  }
  $('#lu').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) select(b.dataset.sel, true); });
  $('#filter').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.dataset.f; $$('#filter button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderLineup();
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
  function renderCrewPlan() {
    const list = [...members.values()].sort((a, b) => ((b.id === me.id) - (a.id === me.id)) || (picksOf(b).length - picksOf(a).length) || a.pseudo.localeCompare(b.pseudo));
    const meet = V.map(v => ({ v, who: whoGoesAt(v.id) })).filter(x => x.who.length >= 2).sort((a, b) => (b.who.length - a.who.length) || (a.v.s - b.v.s));
    let html = '<section class="card meet" style="grid-column:1/-1"><div class="card-head"><h3>Où vous vous retrouvez</h3><span class="mute small">au moins 2 personnes</span></div>' +
      (meet.length ? '<ul class="meet-list">' + meet.map(x => '<li><button type="button" class="pl-vn" data-sel="' + x.v.id + '">' + esc(x.v.n) + '</button><span class="pl-h">' + hoursOf(x.v) + '</span>' +
        '<span class="meet-who">' + crewDots(x.who) + ' ' + esc(names(x.who)) + '</span></li>').join('') + '</ul>'
        : '<p class="empty">Personne n’a encore choisi le même lieu. Choisissez des DJ avec « J’y vais » : vous verrez ici où vous retrouver.</p>') + '</section>';
    for (const m of list) {
      const picks = picksOf(m), isMe = m.id === me.id, venues = [...new Set(picks.map(p => p.v.id))];
      let body = '';
      if (!picks.length) body = '<p class="empty">' + (isMe ? 'Tu n’as encore rien choisi. Touche « J’y vais » à côté d’un DJ, dans « Par lieu ».' : esc(m.pseudo) + ' n’a encore rien choisi.') + '</p>';
      for (const vid of venues) {
        const v = byId(vid);
        body += '<div class="pl-v"><button type="button" class="pl-vn" data-sel="' + v.id + '">' + esc(v.n) + '</button><span class="pl-h">' + hoursOf(v) + '</span></div><ul class="artists">' +
          picks.filter(p => p.v.id === vid).map(p => {
            if (isMe) return artistLi(v, p.a);
            const t = tagOf(p.a), also = myStars.has(p.k);
            return '<li class="' + (t === 'skip' ? 'a-skip' : '') + '"><span class="a-name"><b>' + esc(p.a) + '</b><span class="a-meta">' + (t ? '<span class="tag t-' + t + '">' + TAG_TXT[t] + '</span>' : '') + (also ? '<span class="tag t-also">Toi aussi</span>' : '') + '</span></span></li>';
          }).join('') + '</ul>';
      }
      html += '<article class="card pl" id="pl-' + m.id + '"><div class="pl-head"><span class="dot" style="--c:' + esc(m.color) + '">' + esc(initial(m.pseudo)) + '</span><div><b>' + esc(isMe ? m.pseudo + ' (toi)' : m.pseudo) + '</b>' +
        '<div class="pl-sub">' + picks.length + (picks.length > 1 ? ' DJ' : ' DJ') + ' · ' + venues.length + (venues.length > 1 ? ' lieux' : ' lieu') + '</div></div></div>' + body + '</article>';
    }
    $('#lu-potes').innerHTML = html;
  }
  $('#lu-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    luMode = b.dataset.m; $$('#lu-mode button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderLineup();
  });
  $('#lu-potes').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) select(b.dataset.sel, true); });
  function openCrewPlan(id) {
    luMode = 'potes'; $$('#lu-mode button').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === 'potes'));
    showTab('lineup'); renderLineup();
    const el = document.getElementById('pl-' + id); if (el) el.scrollIntoView({ block: 'start', behavior: smooth() });
  }

  // ---------- Chat ----------
  function markRead() {
    unread = 0;
    const last = messages.length ? messages[messages.length - 1].id : 0;
    if (last > seen) { seen = last; store.set('l26.seen', seen); }
    renderBadge();
  }
  function renderBadge() { const b = $('#badge'); b.hidden = unread < 1; b.textContent = unread > 99 ? '99+' : unread; }
  function addMsg(m) {
    if (messages.some(x => x.id === m.id)) return;
    messages.push(m); if (messages.length > 500) messages.shift();
    if (m.kind === 'rdv') showRdv();
    const stick = nearBottom();
    renderMsgs();
    if (tab === 'chat') { markRead(); scrollMsgs(stick || m.from === me.id); }
    else if (m.from !== me.id) { unread++; renderBadge(); }
  }
  const nearBottom = () => { const el = $('#msgs'); return el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  function scrollMsgs(force) { const el = $('#msgs'); if (force) el.scrollTop = el.scrollHeight; }
  let renderedMax = 0; // seuls les messages arrivés après le dernier affichage s'animent
  function renderMsgs() {
    let html = '', lastDay = '', lastFrom = null;
    for (const m of messages) {
      const fresh = renderedMax > 0 && m.id > renderedMax;
      const d = dayKey(m.t);
      if (d !== lastDay) { html += '<li class="day">' + esc(dayLabel(m.t)) + '</li>'; lastDay = d; lastFrom = null; }
      const mine = m.from === me.id;
      const who = !mine && lastFrom !== m.from ? '<span class="who" style="color:' + esc(m.color) + '">' + esc(m.pseudo) + '</span>' : '';
      const body = m.kind === 'rdv'
        ? '<p>Rendez-vous : ' + esc(m.text) + '<button class="btn" type="button" data-rdv="' + m.id + '">Voir sur la carte</button></p>'
        : m.kind === 'here'
          ? '<p>' + esc(m.text) + '<button class="btn" type="button" data-rdv="' + m.id + '">Voir sur la carte</button></p>'
          : '<p>' + esc(m.text) + '</p>';
      html += '<li class="m' + (mine ? ' mine' : '') + (m.kind === 'rdv' ? ' rdv' : m.kind === 'here' ? ' here' : '') + (fresh ? ' pop' : '') + '">' + who + body + '<time datetime="' + new Date(m.t).toISOString() + '">' + clock(m.t) + '</time></li>';
      lastFrom = m.from;
    }
    $('#msgs').innerHTML = html || '<li class="day">Aucun message. Lance la conversation.</li>';
    if (messages.length) renderedMax = messages[messages.length - 1].id;
  }
  $('#msgs').addEventListener('click', e => {
    const b = e.target.closest('[data-rdv]'); if (!b) return;
    const m = messages.find(x => x.id === +b.dataset.rdv); if (!m) return;
    showTab('carte'); map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 17), { duration: reduced() ? 0 : .6 });
    if (m.kind === 'here') showHere(m);
  });
  async function send(text) {
    text = text.trim(); if (!text) return;
    try { addMsg(await api('/api/msg', { text })); } catch (err) { if (err.message !== '401') toast(err.message); return false; }
    return true;
  }
  $('#composer').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#msg-in'), v = inp.value;
    inp.value = '';
    if (!(await send(v))) inp.value = v;
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

  // ---------- Statut rapide ----------
  let myStatus = null, statusHtml = '';
  function renderStatus() {
    const mine = members.get(me.id);
    if (mine) myStatus = mine.status || null;
    const html = STATUS.map(s => '<button type="button" class="chip' + (s === 'Je suis perdu' ? ' lost' : '') + '" aria-pressed="' + (s === myStatus) + '" data-s="' + esc(s) + '">' + esc(s) + '</button>').join('');
    if (html !== statusHtml) { statusHtml = html; $('#status-chips').innerHTML = html; } // ne touche pas au DOM si rien ne change
  }
  $('#status-chips').addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const next = b.dataset.s === myStatus ? null : b.dataset.s;
    myStatus = next; renderStatus();
    try { await api('/api/status', { status: next }); } catch (err) { if (err.message !== '401') toast(err.message); return; }
    if (next === 'Je suis perdu') sendHere('Je suis perdu, voici ma position');
  });

  // Le plus gros marcheur
  function renderWalker() {
    const arr = [...members.values()].map(m => ({ n: m.id === me.id ? 'toi' : m.pseudo, km: m.id === me.id ? Math.max(walked, m.km || 0) : (m.km || 0) }))
      .filter(x => x.km > 0).sort((a, b) => b.km - a.km);
    const el = $('#walker');
    if (arr.length < 2 || arr[0].km < 0.3) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = arr[0].n === 'toi' ? 'Tu es le plus gros marcheur : ' + fmtDist(arr[0].km * 1000) + '.' : 'Le plus gros marcheur : ' + arr[0].n + ' (' + fmtDist(arr[0].km * 1000) + ').';
  }

  // ---------- Ma position dans le chat ----------
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
      try {
        addMsg(await api('/api/msg', { text: text || 'Position de ' + me.pseudo, kind: 'here', lat: myPos.lat, lng: myPos.lng }));
        toast('Position envoyée au groupe.');
      } catch (err) { if (err.message !== '401') toast(err.message); }
    }, err => toast(geoMessage(err)), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

  // ---------- Faire du bruit ----------
  async function sendBoom() {
    try { await api('/api/boom'); } catch (err) { if (err.message !== '401') toast(err.message); }
  }
  $('#btn-boom').addEventListener('click', sendBoom);
  function onBoom(d) {
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) { /* pas de vibreur */ }
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

  // Clavier ouvert sur téléphone : les onglets laissent la place à la zone de saisie
  $('#msg-in').addEventListener('focus', () => { document.body.classList.add('kb'); scrollMsgs(true); });
  $('#msg-in').addEventListener('blur', () => document.body.classList.remove('kb'));
  // Sur téléphone, toucher les messages referme le clavier et ramène les onglets
  $('#msgs').addEventListener('pointerdown', () => { if (matchMedia('(pointer: coarse)').matches) $('#msg-in').blur(); });

  // ---------- Profil ----------
  function renderMeChip() {
    $('#me-chip').innerHTML = '<span class="dot" style="--c:' + esc(me.color) + '">' + esc(initial(me.pseudo)) + '</span><span class="nm">' + esc(me.pseudo) + '</span>';
  }
  $('#me-chip').addEventListener('click', () => {
    $('#me-name').textContent = me.pseudo;
    $('#me-km').textContent = walked >= 0.05 ? 'Tes pas : ' + fmtDist(walked * 1000) + ' (comptés tant que tu partages ta position).' : '';
    $('#me-info').textContent = members.size + ' dans le groupe. Pour te reconnecter sur un autre téléphone, entre le même pseudo avec le code du groupe.';
    const d = $('#me-dialog'); if (d.showModal) d.showModal();
  });
  $('#me-invite').addEventListener('click', async () => {
    const code = store.get('l26.last', {}).code || '';
    const link = location.origin + '/?c=' + encodeURIComponent(code);
    try { await navigator.clipboard.writeText(link); toast('Lien d’invitation copié.'); }
    catch (e) { toast('Copie impossible. Lien : ' + link); }
    $('#me-dialog').close();
  });
  $('#me-leave').addEventListener('click', async () => {
    try { await api('/api/leave'); } catch (e) { /* déjà sorti */ }
    $('#me-dialog').close(); logout();
  });

  // ---------- Compte à rebours ----------
  function countdown() {
    const h = nowH(), el = $('#countdown');
    if (h >= 14 && h < 38) return void (el.textContent = 'En cours');
    if (h >= 38) return void (el.textContent = 'Fini');
    let today;
    try { today = new Intl.DateTimeFormat('en-CA', BXL).format(new Date()); } catch (e) { today = new Date().toISOString().slice(0, 10); }
    const [y, m, d] = today.split('-').map(Number);
    const days = Math.round((Date.UTC(2026, 10, 21) - Date.UTC(y, m - 1, d)) / 864e5);
    el.textContent = days === 0 ? 'Jour J' : 'J-' + days;
  }

  // ---------- Affichage complet ----------
  function renderAll() {
    renderMeChip(); renderShareBtn(); renderPotes(); renderVenue(); renderFrise(); renderSteps(); renderLineup(); renderMsgs(); renderBadge();
    refreshRouteSelects(); syncFriendMarkers(); showRdv(); scrollMsgs(true);
  }

  // ---------- Départ ----------
  const d0 = store.get('l26.depart', null);
  if (typeof d0 === 'string' && d0.trim()) $('#depart').value = d0;
  countdown(); setInterval(countdown, 60e3);
  if (me && me.token) boot(); else showLogin();
})();
