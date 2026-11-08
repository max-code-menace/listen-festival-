# Plan Listen 2026 : spec complet et plan pour un 10/10

> État décrit : commit `7d6af1b` (7 novembre 2026). Festival : sam. 21 nov. 14:00 → dim. 22 nov. 14:00, soit **J-14**.
> Ce document a trois parties : (A) ce que l'appli fait aujourd'hui, (B) ce qui cloche, (C) ce qu'il faut faire pour qu'elle soit irréprochable **sur téléphone**, avec un gros chapitre sur les trajets.
> Règle de base de ce document : **le téléphone est la seule cible**. L'ordinateur n'est pas un objectif ; il doit seulement ne pas casser.

---

## État d'avancement (mis à jour le 7 novembre 2026, au soir)

Une grande partie du plan est faite. Elle est vérifiée par 34 tests automatiques, et dans le navigateur en taille téléphone (375 × 812) avec une heure simulée pendant le festival (`?now=…`). **Pas encore essayé sur un vrai iPhone ni un vrai Android.**

| Sujet | État | Où |
|---|---|---|
| Hors ligne : service worker, appli et trajets gardés, carte des quartiers téléchargée (zooms 13–16), file d'envoi sans doublon, dernier état affiché sans réseau, bandeau « Hors ligne » | ✅ Fait, testé serveur coupé | `public/sw.js`, `public/app.js` |
| Trajets précalculés entre les 15 lieux et la gare du Midi (240 trajets) | ✅ | `scripts/build-routes.js`, `public/routes.json` |
| Durée partout (épingles, fiche du lieu, Maintenant, line-up, potes, bulles RDV), allure réglable | ✅ | `public/core.js`, `public/app.js` |
| Heure d'arrivée et « encore ouvert ? » | ✅ | idem |
| Listen Express proposé quand il fait gagner ≥ 10 min | ✅ | idem |
| Liens Google Maps / Plans / transports / Uber | ✅ | idem |
| « J'arrive dans ~X min » au groupe ; itinéraire qui suit un pote qui bouge | ✅ | idem |
| « Se retrouver maintenant » (meilleur point de rencontre) | ✅ | onglet Groupe |
| Mon parcours calculé depuis mes « J'y vais » | ✅ (ordre d'ouverture + marches ; pas d'optimisation fine sans heures de passage) | Programme › Horaires |
| Carte plein écran + panneau du bas à 3 hauteurs | ✅ | onglet Carte |
| Onglets Carte · Programme · Groupe · Chat (« Plan » renommé) | ✅ | |
| Programme : Maintenant / Line-up (recherche, filtres avec compteurs, en-têtes collants, ligne entière touchable) / Horaires (frise lisible sur 375 px) | ✅ | |
| Chat : clavier (visualViewport), repère « Nouveaux messages », bouton « ↓ nouveaux », heures regroupées, envoi en attente annulable | ✅ (clavier à vérifier sur un vrai iPhone) | |
| Mode économie de batterie (manuel, et seul sous 20 % sur Android) | ✅ | profil |
| Goûts de Mahx présentés comme « Recos Mahx » aux autres | ✅ (pas encore de goûts par personne) | |
| Corrections B3, B6, B7, B10 (limite sur « J'y vais » ; pas encore sur le nombre de flux), B12, B13, B14, B15, B16, B17 | ✅ | |
| B11 (identifiants stables pour les « J'y vais ») | ❌ pas fait | |
| Effacement des positions à l'arrêt du partage et le 23/11 | ✅ | `server.js` |
| Compression gzip des fichiers | ✅ | `server.js` |

**Pas encore fait** (par ordre d'intérêt) :
1. **Notifications push** (« Léa est perdue » appli fermée) : demande des clés VAPID et un peu de code serveur (§6.3).
2. **Trains SNCB vers sa gare** (iRail) et « bien rentré ? » (§5.9).
3. **Goûts par personne** stockés sur le serveur (§7).
4. Session par cookie au lieu du jeton dans l'adresse du flux (B5).
5. Polices hébergées chez nous (B8) : pour l'instant gardées hors ligne par le service worker.
6. Sondage éclair, réactions, mentions `@`, file d'attente collective, admin des horaires (§4.6, §7).
7. Le serveur Docker tourne toujours en root (le volume Fly appartient à root ; à changer avec une étape de démarrage qui règle les droits).
8. Test de bout en bout sur émulation mobile (Playwright) et essai sur de vrais téléphones (§4.10).

---

## 0. En une minute

**Ce que c'est** : un site (PWA) pour un groupe de 10 potes au Listen Festival. Carte des 15 lieux, potes en direct sur la carte, itinéraires à pied, chat, statut rapide, « faire du bruit », line-up avec « J'y vais » partagé, planning de chacun. Serveur Node sans dépendance, temps réel par SSE, hébergé sur Fly.io (une machine, région Paris).

**Note honnête aujourd'hui**

| Axe | Note | Pourquoi |
|---|---|---|
| Idée et fonctionnalités | 8/10 | Très bon périmètre pour un groupe : potes en direct, RDV, statut, plannings croisés. |
| Mobile | 6/10 | Cibles tactiles correctes, mais la page Carte est une longue page qui défile sous une carte, la frise se lit mal sur 375 px, le line-up est long et ses filtres déroutent, le chat repose sur des hauteurs « à la main ». |
| Trajets | 4/10 | À pied seulement, calculés en direct par un service public gratuit (risque le soir même), aucune durée affichée tant qu'on ne lance pas un calcul, pas d'heure d'arrivée, rien pour les trains, la STIB ou le retour. |
| Tenue sur le terrain | 3/10 | **Pas de mode hors ligne** (aucun service worker). Dans une foule, la 4G sature : l'appli peut ne plus s'ouvrir du tout. Animations lourdes pour la batterie. Pas de notification quand l'appli est fermée. |
| Sécurité et vie privée | 6/10 | Bonnes bases (CSP, jetons hachés, limites anti-abus), mais jeton dans l'URL du flux, positions gardées sur disque sans date de fin, Google Fonts. |
| Qualité du code | 6/10 | Lisible, commenté, sans dépendance. Mais `app.js` fait 934 lignes dans une seule fonction, données et goûts personnels codés en dur, déploiement sans passer par les tests. |

**Les 10 actions qui font passer de 6 à 10** (détail plus bas)

1. **Hors ligne** : service worker, appli et données en cache, tuiles de la zone téléchargées d'avance, messages mis en file d'attente si pas de réseau (§6.1).
2. **Carte plein écran avec un panneau qui glisse du bas** (comme Google Maps) au lieu d'une page qui défile sous la carte (§4.2).
3. **Temps de marche précalculés** entre tous les lieux, affichés partout (« 8 min à pied »), sans réseau (§5.2, §5.3).
4. **Heure d'arrivée et « encore ouvert ? »** sur chaque trajet (§5.4).
5. Onglet **« Programme »** pensé pour le téléphone : « Maintenant » en haut, frise verticale, line-up cherchable (§4.3, §4.4).
6. **Goûts par personne** au lieu des goûts de Mahx codés en dur pour tout le monde (§3, B4).
7. **Notifications push** pour « Je suis perdu », un RDV ou un « bruit », même appli fermée (§6.3).
8. **Mode économie de batterie** : couper l'aurore, les flous et les animations (§4.8).
9. **Rentrer chez soi** : prochain train vers sa gare (iRail), retour à pied ou en taxi, « bien rentré ? » (§5.9).
10. **Les tests avant le déploiement**, et un gel du code à J-2 (§8, §9).

---

# Partie A. Ce que l'appli fait aujourd'hui

## 1. Usage et contraintes

- **Qui** : 10 personnes maximum, qui se connaissent. Un seul code de groupe.
- **Où** : dehors, la nuit, en novembre, dans le centre de Bruxelles, entre 15 lieux espacés de 200 m à 4,7 km.
- **Avec quoi** : un téléphone, souvent à moitié chargé, une main libre, un réseau saturé près des lieux, de la musique forte (on n'entend pas les notifications), de la fatigue et de l'alcool. **Tout doit se faire en un ou deux gestes du pouce, lisible d'un coup d'œil.**
- **Quand** : l'appli sert surtout avant (choisir ses DJ, voir le planning des autres) et pendant (se retrouver, se déplacer). Elle ne sert presque plus après.

## 2. Fonctionnalités, écran par écran

### 2.1 Entrée dans le groupe (`#login`)
- Champs : code du groupe, pseudo (16 caractères max), couleur parmi 10.
- Le lien d'invitation `/?c=CODE` préremplit le code. Le dernier code, pseudo et couleur sont retenus sur le téléphone.
- Reprendre un pseudo existant (même code) = se reconnecter sur un autre téléphone. Pas de mot de passe : voulu, à 10 potes de confiance.
- Le groupe se ferme à `MAX_MEMBERS` (10).

### 2.2 Barre du haut
- Logo, point d'état de la connexion (vert « En direct », rose « Mode simple », jaune clignotant « Reconnexion… » ; le texte n'apparaît qu'au-dessus de 560 px, donc **sur téléphone on ne voit qu'un point de couleur**).
- Compte à rebours (« J-14 », « Jour J », « En cours », « Fini »).
- Pastille « moi » : ouvre le profil (lien d'invitation, quitter le groupe, kilomètres marchés).

### 2.3 Onglet Carte
- **Carte Leaflet** (OpenStreetMap, couleurs inversées pour la nuit), 15 lieux numérotés et colorés par type (club de nuit, club de jour, disquaire), voie ferrée Nord – Congrès – Central – Midi animée. Noms des lieux affichés à partir du zoom 15.
- Raccourcis de zoom : « Tout », « Nord et centre », « Marolles et Midi ».
- Boutons flottants : **Moi** (centrer sur moi), **Tous** (cadrer tout le groupe), **RDV** (toucher la carte pour poser un point de rendez-vous, nommé, envoyé dans le chat).
- **Partager ma position** : suivi GPS continu, envoi au serveur si on a bougé de plus de 25 m, ou de plus de 5 m après 12 s, ou toutes les 45 s. L'écran reste allumé (Wake Lock). S'arrête si on ferme la page.
- Sous la carte, à faire défiler :
  - **Les potes** : pastille, statut, « à l'instant / il y a 3 min », lieu le plus proche (à moins de 120 m), distance à vol d'oiseau, km marchés, boutons « Voir » et « Y aller », lien « Son planning ».
  - **Mon statut** : Au bar, Dans la file, Je danse, Je mange, Je vous cherche, Je rentre, Je suis perdu (ce dernier envoie aussi ma position dans le chat). Un statut s'efface seul au bout de 1 h 30.
  - **Faire du bruit** : éclair plein écran et vibration chez tout le monde (1 toutes les 4 s maximum).
  - **Fiche du lieu** sélectionné : type, horaires, ouvert / ouvre à / terminé, adresse, gare la plus proche à vol d'oiseau, qui du groupe y va, line-up avec « J'y vais ».
  - **Itinéraire à pied** : listes « De » / « Vers » (ma position, potes qui partagent, lieux, gares), calcul par `routing.openstreetmap.de`, tracé sur la carte, durée, distance, étapes. En cas d'échec : ligne droite et estimation (vol d'oiseau × 1,35 à 1,3 m/s).

### 2.4 Onglet Plan
- **Frise « Qui ouvre quand »** : 15 lieux + Listen Express sur 24 h (sam. 14:00 → dim. 14:00), ligne « maintenant », barres colorées, mini-pastilles de qui y va. Largeur minimale 640 px : on la fait glisser de côté.
- **Parcours proposé** (celui de Mahx) : Hexagon 20:00 → North Station 22:30 → Listen Express Nord → Midi vers minuit → Fuse 01:30. Champ « Ta gare de départ » (Mont-Saint-Guibert par défaut). Temps de marche de chaque étape calculé en direct.
- **Listen Express** : dim. 00:00 → 05:00, Nord – Central – Midi, horaires des passages non publiés.
- **Limites connues** et liens (billetterie Fever).

### 2.5 Onglet Line-up
- Deux modes : **Par lieu** et **Par pote**.
- Par lieu : filtres Tout / Mes goûts / J'y vais / Le groupe. Une carte par lieu avec ses DJ, étiquettes « Incontournable / À écouter / Pas pour moi », pastilles de qui y va, bouton « J'y vais ».
- Par pote : « Où vous vous retrouvez » (lieux choisis par au moins 2 personnes), puis le planning de chaque membre, avec « Toi aussi » quand on a choisi le même DJ.

### 2.6 Onglet Chat
- Messages du groupe (500 gardés, 200 envoyés à la connexion), séparés par jour, regroupés par auteur, heure de Bruxelles.
- Raccourcis : Faire du bruit, Ma position, Je suis arrivé, Vous êtes où ?, On bouge ?, J'ai soif, Venez c'est dingue ici, Je rentre.
- Messages spéciaux : **RDV** (rose, bouton « Voir sur la carte ») et **position** (cyan, épingle temporaire 2 min sur la carte).
- Badge de messages non lus sur l'onglet. Quand le clavier s'ouvre, la barre d'onglets disparaît.

### 2.7 Temps réel
- **En direct** : flux SSE `/api/events` (état complet à la connexion, puis événements `member`, `msg`, `boom`, `gone`, et `ping` toutes les 25 s).
- **Mode simple** : si le flux ne répond pas en 7 s, ou échoue 3 fois, interrogation de `/api/sync` toutes les 3 s.
- Un flux silencieux depuis 75 s est relancé.

## 3. Spec technique

### 3.1 Architecture

```
Téléphone (PWA)                                   Fly.io, 1 machine, Paris
┌───────────────────────────────┐   HTTPS     ┌──────────────────────────────┐
│ index.html + style.css        │ ──────────▶ │ server.js (Node 22, 0 dép.)  │
│ data.js  (lieux, line-up,     │   SSE /     │  • fichiers de public/       │
│           goûts, parcours)    │   sync 3 s  │  • API /api/*                │
│ app.js   (toute la logique)   │ ◀────────── │  • état en mémoire           │
│ Leaflet 1.x (vendor)          │             │  • db.json sur volume /data  │
└──────────┬──────────┬─────────┘             └──────────────────────────────┘
           │          │
           ▼          ▼
  tile.openstreetmap.org     routing.openstreetmap.de (itinéraires à pied)
  fonts.googleapis.com
```

### 3.2 Données du festival (`public/data.js`)
| Constante | Contenu |
|---|---|
| `V` | 15 lieux : `id`, nom, type `k` (club / jour / disq), coordonnées, heures `s`/`e` en heures depuis sam. 00:00, adresse, DJ `ar`, drapeaux `approx`, `tbc`, `osm`. |
| `EXPRESS` | Listen Express, 24 → 29 (dim. 00:00 → 05:00). |
| `GARES` | Nord, Congrès, Central, Midi. |
| `T` | **Goûts de Mahx** (pick / check / skip), affichés à **tout le groupe**. |
| `ROUTE` | Parcours de Mahx en 4 étapes. |
| `COLORS`, `STATUS`, `QUICK` | Listes partagées avec le serveur (seul `STATUS` est vérifié par un test). |

### 3.3 Données du serveur (`db.json`)
```js
{ seq, members: { [id]: { id, pseudo, color, tokenHash, stars[], pos{lat,lng,acc,t}, sharing, status, statusAt, km } },
  messages: [ { id, t, from, pseudo, color, kind: 'text'|'rdv'|'here', text, lat?, lng? } ] }  // 500 max
```
Écriture groupée toutes les 400 ms, fichier temporaire puis renommage (pas de fichier à moitié écrit).

### 3.4 API
| Route | Rôle | Limite |
|---|---|---|
| `POST /api/join` | code + pseudo + couleur → jeton | 12 / min / adresse IP |
| `GET /api/events?token=` | flux SSE | aucune |
| `GET /api/sync?after=&since=` | mode simple | 60 / min |
| `POST /api/pos` | position, ou `{sharing:false}` | 90 / min |
| `POST /api/msg` | texte, RDV, position | 25 / min |
| `POST /api/stars` | « J'y vais » (300 max) | **aucune** |
| `POST /api/status` | statut rapide | 30 / min |
| `POST /api/boom` | faire du bruit | 1 / 4 s |
| `POST /api/leave` | quitter le groupe | aucune |
| `GET /healthz` | santé pour l'hébergeur | aucune |

### 3.5 Sécurité en place
CSP stricte (`script-src 'self'`), `nosniff`, `frame-ancestors 'none'`, HSTS en production, jetons aléatoires stockés hachés (SHA-256) et comparés en temps constant, nettoyage des caractères de contrôle, corps de requête limité à 10 ko, protection contre la sortie du dossier `public/`, IP réelle lue derrière le proxy seulement si `TRUST_PROXY=1`.

### 3.6 Déploiement et tests
- Fly.io : `fly.toml` (1 machine, volume `listen_data`, contrôle `/healthz` toutes les 30 s), `Dockerfile` (`node:22-alpine`).
- GitHub Actions : chaque push sur `main` déploie. **Les tests ne sont pas lancés avant.**
- 19 tests serveur (`node --test`). **Aucun test du site lui-même.**
- Autres hébergements documentés : cPanel / Passenger via `start.js`.

---

# Partie B. Ce qui cloche

Classés par gravité. Les liens pointent vers le code actuel.

| # | Gravité | Problème | Où | Correction |
|---|---|---|---|---|
| B1 | **Bloquant terrain** | Aucun service worker : sans réseau, l'appli ne s'ouvre pas, la carte est grise, les itinéraires échouent. C'est exactement la situation dans une foule. | (absent) | §6.1 |
| B2 | **Haute** | Les itinéraires dépendent d'un service public gratuit sans garantie (`routing.openstreetmap.de`), appelé depuis chaque téléphone, au moment où le réseau est le pire. | [app.js:546](../public/app.js) | Matrice précalculée, §5.2 |
| B3 | **Haute** | À la reconnexion, le site « teste » la session en **renvoyant ses « J'y vais » locaux au serveur** : s'ils sont anciens (changés sur un autre téléphone), ils écrasent ceux du serveur. | [app.js:199](../public/app.js) | Ajouter `GET /api/me` et l'utiliser pour tester la session. |
| B4 | **Haute** | Les goûts (`T`), le parcours (`ROUTE`), la gare de départ, le texte « Hors parcours » et « Aucun de tes artistes préférés » sont **ceux de Mahx, affichés à tout le monde**. Pour les 9 autres, le filtre « Mes goûts » et les étiquettes « Incontournable » ne veulent rien dire. | [data.js:65](../public/data.js), [app.js:654](../public/app.js), [index.html:134](../public/index.html) | Goûts par personne (« Je kiffe / Peut-être / Bof ») stockés côté serveur ; ou renommer clairement « Les recos de Mahx ». Parcours généré depuis les « J'y vais » de chacun (§5.8). |
| B5 | Moyenne | Le jeton de session passe dans l'URL du flux (`/api/events?token=…`) : il peut finir dans des journaux de proxy. Il n'expire jamais. | [server.js:108](../server.js) | Cookie `HttpOnly; Secure; SameSite=Strict` posé par `/api/join` ; expiration le 23/11. |
| B6 | Moyenne | Les positions restent sur le disque indéfiniment, même après « arrêter de partager » (seul l'affichage les masque). | [server.js:196](../server.js) | Effacer `pos` quand on arrête ; tout effacer automatiquement le 23/11 ; le dire dans l'appli. |
| B7 | Moyenne | Le déploiement automatique ne lance pas `npm test`, et l'action Fly est prise sur `@master` (non figée). | `.github/workflows/fly-deploy.yml` | Étape `npm test` avant `flyctl deploy` ; figer la version de l'action. |
| B8 | Moyenne | Google Fonts : chaque ouverture contacte Google (vie privée, et polices absentes hors ligne). | [index.html:15](../public/index.html) | Héberger les deux polices dans `public/fonts/` (et retirer Google de la CSP). |
| B9 | Moyenne | Aurore floutée animée en permanence, `backdrop-filter` partout, épingles qui pulsent, rail animé : consommation GPU et batterie toute la nuit. | `style.css` | Mode économie, §4.8. |
| B10 | Basse | `POST /api/stars` sans limite ; pas de limite au nombre de flux SSE ouverts par membre. | [server.js:217](../server.js) | Limiter (30 / min, 3 flux par membre). |
| B11 | Basse | Les « J'y vais » sont stockés sous la forme `lieu|nom du DJ` : corriger une faute dans un nom de DJ fait disparaître les choix. | [app.js:20](../public/app.js) | Identifiant stable par passage (`fuse-mcr-t`). |
| B12 | Basse | Chaque mise à jour d'un pote recrée son icône (`setIcon`) : clignotement de l'étiquette et travail inutile. | [app.js:292](../public/app.js) | Ne changer l'icône que si couleur, initiale ou fraîcheur changent. |
| B13 | Basse | Texte identique dans les deux branches (« dans le groupe » / « DJ »). | [app.js:427](../public/app.js) | Simplifier. |
| B14 | Basse | `COLORS` est copié dans le serveur et dans `data.js` sans test qui vérifie qu'ils sont égaux (`STATUS` l'est). | `server.js`, `data.js` | Ajouter le test, ou une route `/api/config`. |
| B15 | Basse | `data.js` annonce « quatre gares du Listen Express », l'écran en montre trois (Nord, Central, Midi). | [data.js:57](../public/data.js) | Corriger le commentaire. |
| B16 | Basse | `listen-2026.html` (ancienne version, 679 lignes) traîne à la racine. | racine | Supprimer (l'historique Git la garde). |
| B17 | Basse | Le code du groupe reste dans l'adresse (`?c=`) après l'entrée, donc dans l'historique et les captures d'écran. | [app.js:90](../public/app.js) | `history.replaceState` après lecture. |

---

# Partie C. Le plan pour un 10/10

## 4. Mobile, et seulement mobile

### 4.0 Principes
- **Écran de référence : 375 × 667** (iPhone SE / petits Android). Tout doit tenir et se lire là. Vérifier aussi 390 × 844 et 430 × 932.
- **Une main, le pouce** : les actions fréquentes en bas de l'écran, jamais en haut à gauche.
- **Un coup d'œil** : l'information importante (où sont les potes, combien de minutes, ouvert ou pas) se voit sans lire de phrase.
- **Portrait uniquement** (déjà dans le manifeste).
- **Supprimer le travail pour l'ordinateur** : retirer les `@media (min-width: 861px)` et `561px` qui créent des colonnes ; sur ordinateur, l'appli s'affiche simplement en colonne de 480 px centrée. Moins de cas, moins de bugs.
- **Zone sûre** : respecter `env(safe-area-inset-*)` partout (déjà fait pour la barre et les onglets ; à vérifier pour la feuille du bas et le chat).

### 4.1 Nouvelle organisation des onglets
« Plan » veut aussi dire « carte » en français : deux onglets « Carte » et « Plan », c'est ambigu. Proposition :

| Onglet | Contenu |
|---|---|
| **Carte** | Carte plein écran + feuille du bas (lieu, itinéraire, potes proches). |
| **Programme** | Maintenant / Bientôt, frise verticale, line-up cherchable, Listen Express. |
| **Groupe** | Les potes, leur statut, leur planning, « Où vous vous retrouvez », mon statut, faire du bruit. |
| **Chat** | Inchangé dans le principe, mais refait (§4.6). |

Le bouton « Je suis perdu » devient accessible depuis **tous les onglets** (appui long sur la pastille « moi », ou un bouton rouge discret dans la barre), car c'est l'urgence n°1.

### 4.2 Carte : plein écran et feuille du bas
Aujourd'hui, la carte occupe la hauteur de l'écran moins 150 px, puis 5 cartes s'empilent en dessous. Sur téléphone, le doigt hésite entre faire défiler la page et déplacer la carte, et la fiche du lieu est hors de vue quand on touche une épingle.

**Cible** (le modèle de toutes les applis de cartes) :
- Carte sur **tout l'écran** entre la barre du haut et les onglets.
- **Feuille du bas** à trois hauteurs, qu'on fait glisser au pouce :
  - **Repliée** (≈ 96 px) : une ligne d'état. « 3 potes partagent · Léa au bar à C12 · Fuse ouvre dans 40 min ».
  - **Moitié** : la fiche du lieu touché, avec **le temps de marche depuis moi en gros** (« 9 min à pied · arrivée 01:42 · ouvert »), les boutons « Y aller », « RDV ici », « Qui y va ».
  - **Pleine** : line-up du lieu ou étapes de l'itinéraire.
- Toucher une épingle ouvre la feuille à moitié. Toucher la carte vide la replie.
- **Itinéraire** : plus de formulaire « De / Vers » avec deux listes déroulantes. « Y aller » part de ma position (ou de la dernière connue) ; « Changer de départ » ouvre une liste en plein écran avec recherche. Pendant le trajet, un **bandeau fixe** en haut : « 7 min · 550 m · Tourner à gauche rue Haute ».
- Boutons flottants Moi / Tous / RDV : garder, mais les coller au-dessus de la feuille (ils montent avec elle).
- **Partager ma position** : un interrupteur clair dans la feuille repliée, avec l'état (« Tu partages depuis 1 h 12 · batterie ? »), plutôt qu'une pastille posée sur la carte.
- Épingles des potes : ajouter une **flèche de direction** ou une petite traîne des 3 dernières positions, et estomper nettement au-delà de 3 min (déjà fait) avec l'âge écrit (« 12 min »).
- Agrandir les numéros des lieux à 36 px visibles (44 px de zone tactile, déjà fait).

### 4.3 Programme : lisible sur 375 px
La frise horizontale de 640 px oblige à glisser de côté dans une page qui glisse de haut en bas, et on ne voit qu'un tiers de la nuit.

**Cible** :
1. En haut, **« Maintenant »** : la liste des lieux ouverts à l'instant, triés par **temps de marche depuis moi**, avec qui du groupe y est ou y va. Puis **« Bientôt »** : ce qui ouvre dans les 2 heures. C'est ce qu'on veut savoir à 1 h du matin, pas une frise.
2. **Frise verticale** : les heures descendent (14:00 en haut, 14:00 le lendemain en bas), une colonne fine par lieu ou, plus simple, une liste par tranche horaire (« 20:00 – Hexagon ouvre », « 22:00 – North, Central, Congrès ouvrent »…). Ligne « maintenant » qui défile toute seule à l'ouverture.
3. Garder la frise horizontale actuelle seulement si on la rend lisible : noms de lieux courts, 6 heures visibles d'un coup, ouverture centrée sur « maintenant ».
4. **Listen Express** : une carte compacte avec un compte à rebours (« dans 2 h 10 ») et les temps de marche vers chaque gare depuis moi.
5. « Limites connues » et « Source » : repliées dans un « À savoir » en bas.

### 4.4 Line-up : qu'on comprenne du premier coup
Aujourd'hui : deux rangées de boutons empilées (Par lieu / Par pote, puis Tout / Mes goûts / J'y vais / Le groupe), environ 75 lignes à faire défiler, et des étiquettes « Incontournable » qui sont les goûts d'une seule personne.

**Cible** :
- **Une barre de recherche** en haut (« Chercher un DJ ou un lieu »), qui filtre en tapant.
- **Une seule rangée de filtres** qui défile de côté : `Tout` · `Mes choix (4)` · `Le groupe (11)` · `Ouvert maintenant` · `Près de moi`. Les nombres disent ce qu'on va trouver.
- **En-têtes de lieu collants** (`position: sticky`) : en défilant, on sait toujours dans quel lieu on est. Chaque en-tête montre l'horaire, l'état (ouvert / ouvre à 23:00), le temps de marche et les pastilles du groupe.
- **Index rapide** : une rangée de pastilles de lieux en haut pour sauter à un lieu.
- **Ligne d'artiste** : toute la ligne est touchable pour « J'y vais » (pas seulement le bouton), avec un retour de vibration léger. Le bouton devient une étoile ou un cœur à droite, état évident.
- **Goûts** : chacun a les siens (« J'adore / Peut-être / Pas pour moi »), ou bien les goûts de Mahx deviennent explicitement « Recos de Mahx » avec sa pastille.
- **« Par pote »** quitte le line-up et va dans l'onglet **Groupe**.
- Quand les **heures de passage** seront publiées : les afficher par artiste et passer le line-up en ordre chronologique dans chaque lieu (prévoir le champ dès maintenant dans les données, §8.3).

### 4.5 Groupe
- Liste des potes en cartes compactes : pastille, statut en couleur, « à 6 min de toi », lieu actuel, dernière mise à jour. Toucher = feuille d'actions : Voir sur la carte · Y aller · Son planning · Lui envoyer un message (mention dans le chat).
- **« Où vous vous retrouvez »** en haut, avec l'heure du lieu et le temps de marche.
- **Mon statut** : grosses pastilles sur deux lignes, « Je suis perdu » en rouge et à part.
- **Faire du bruit** : gros bouton en bas de l'écran Groupe.
- Le « plus gros marcheur » : petit classement, sans prendre de place.

### 4.6 Chat : parfait sur téléphone
- **Clavier** : la hauteur du chat est calculée à la main (`100dvh - … - 36px`) et la barre d'onglets est cachée au focus. Sur iPhone, `interactive-widget=resizes-content` n'est pas pris en compte. Utiliser l'API `visualViewport` (événement `resize`) pour caler le champ de saisie juste au-dessus du clavier sur iOS et Android, et faire défiler en bas.
- **Envoi sans réseau** : le message s'affiche tout de suite, grisé avec « envoi… », puis « non envoyé, toucher pour réessayer ». File d'attente gardée sur le téléphone (§6.1).
- **Repère « Nouveaux messages »** quand on revient sur l'onglet, et bouton flottant « ↓ 3 nouveaux » si on a remonté l'historique.
- **Raccourcis** : deux lignes au maximum, et les masquer quand le clavier est ouvert (ils prennent la place des messages).
- **Réactions** rapides par appui long (👍 ❤️ 🔥 📍) : utile quand on ne peut pas écrire.
- **Mentions** `@Léa` : vibration et notification pour la personne mentionnée.
- **Messages RDV / position** : afficher la distance et le temps de marche depuis moi directement dans la bulle (« 📍 RDV devant C12 · 4 min à pied »).
- **Accusés de lecture légers** pour les RDV (« vu par 6 »), pour savoir si le groupe a bien reçu.
- Heure discrète, regroupée par tranche de 5 minutes au lieu d'une heure sous chaque bulle.

### 4.7 Barre du haut et états
- Remplacer le point de connexion seul par un **bandeau clair quand ça ne va pas** : « Hors ligne · tes messages partiront dès que le réseau revient ». Rien quand tout va bien.
- Le compte à rebours, utile avant, devient pendant le festival « Il est 01:12 · Express jusqu'à 05:00 ».
- Libérer de la hauteur : la barre fait 64 px + l'encoche ; viser 52 px.

### 4.8 Batterie et fluidité
La nuit dure 12 heures. L'appli doit coûter le moins possible.
- **Mode économie** (interrupteur dans le profil, activé tout seul sous 20 % si l'API batterie le permet, et à partir de 22:00 le jour J) : pas d'aurore, pas de `backdrop-filter`, pas d'épingles qui pulsent, pas de rail animé, éclair « bruit » réduit.
- Fond noir pur (`#000`) en mode économie : sur les écrans OLED, le noir ne consomme rien.
- GPS : en économie, envoyer moins souvent (50 m / 60 s) et passer `enableHighAccuracy` à `false` quand on ne bouge pas.
- Ne pas redessiner tout le chat à chaque message (aujourd'hui, les 500 messages sont reconstruits) : ajouter seulement la nouvelle bulle.
- Tester sur un Android d'entrée de gamme : défilement du line-up et déplacement de la carte sans saccade.

### 4.9 Gestes et retours
- Vibration courte sur « J'y vais », statut, envoi de RDV (si `navigator.vibrate` existe ; rien sur iPhone, c'est normal).
- Bouton retour Android : ferme la feuille du bas ou le dialogue avant de changer d'onglet.
- Tirer vers le bas dans Groupe et Chat : resynchroniser.

### 4.10 Liste de contrôle mobile (à passer avant le 19/11)
- [ ] iPhone Safari, **installé sur l'écran d'accueil** (mode standalone) : entrée, carte, partage de position, chat avec clavier, retour depuis l'arrière-plan.
- [ ] Android Chrome installé : idem, plus le bouton retour.
- [ ] 375 × 667 : aucun texte coupé, aucun défilement horizontal de la page.
- [ ] Mode avion après le premier chargement : l'appli s'ouvre, la carte s'affiche, les temps de marche aussi.
- [ ] Réseau lent (« Slow 3G » dans les outils du navigateur) : un message part, le statut aussi.
- [ ] Luminosité au minimum, la nuit : tout reste lisible (contrastes ≥ 4,5:1).
- [ ] Taille de texte du système agrandie : rien ne casse.
- [ ] 2 heures avec le partage de position actif : mesurer la batterie perdue.

---

## 5. Les trajets

### 5.1 Aujourd'hui
- À pied seulement. Il faut choisir « De » et « Vers » puis toucher « Calculer ».
- Chaque calcul appelle un service public en direct. Rien n'est gardé après avoir fermé la page.
- La fiche d'un lieu donne la gare la plus proche **à vol d'oiseau**, pas un temps de marche.
- Aucune notion d'heure : on ne sait pas si on arrive avant la fermeture.
- Rien pour la STIB, les trains SNCB, le Listen Express (à part un texte), le vélo, le taxi ou le retour.

### 5.2 Matrice des temps de marche, précalculée
Les 15 lieux et 4 gares ne bougent pas : on peut calculer **une fois** tous les trajets (19 × 19 = 342) et les mettre dans les données. Instantané, sans réseau, sans dépendre d'un service gratuit le soir même.

Relevé réel, calculé le 07/11/2026 avec le même service que l'appli (minutes à pied, allure moyenne d'environ 4,6 km/h) :

| De \ Vers | Hexagon | North | Central | C12 | Blur | Fuse | Quadri | CityGate | Standard | Congrès | Gare du Midi |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Hexagon** | – | 21 | 8 | 8 | 11 | 28 | 33 | 51 | 25 | 7 | 34 |
| **North** | 21 | – | 27 | 26 | 26 | 44 | 46 | 62 | 6 | 14 | 46 |
| **Central** | 8 | 27 | – | 2 | 5 | 20 | 26 | 43 | 29 | 13 | 26 |
| **C12** | 8 | 26 | 2 | – | 4 | 22 | 27 | 43 | 28 | 13 | 28 |
| **Blur** | 11 | 26 | 5 | 4 | – | 20 | 24 | 40 | 28 | 15 | 25 |
| **Fuse** | 28 | 44 | 20 | 22 | 20 | – | 9 | 26 | 46 | 33 | 10 |
| **Quadri** | 33 | 46 | 26 | 27 | 24 | 9 | – | 18 | 46 | 38 | 2 |
| **CityGate** | 51 | 62 | 43 | 43 | 40 | 26 | 18 | – | 63 | 54 | 18 |
| **Standard** | 25 | 6 | 29 | 28 | 28 | 46 | 46 | 63 | – | 18 | 47 |
| **Congrès** | 7 | 14 | 13 | 13 | 15 | 33 | 38 | 54 | 18 | – | 39 |
| **Gare du Midi** | 34 | 46 | 26 | 28 | 25 | 10 | 2 | 18 | 47 | 39 | – |

Ce que ça montre tout de suite :
- **Trois quartiers** : Nord (North, Standard : 6 min entre eux), Centre (Central, C12, Blur, Hexagon, Congrès : 2 à 15 min), Midi / Marolles (Fuse, Quadri, Midi, disquaires : 2 à 10 min). Entre deux quartiers, c'est **20 à 45 min**. CityGate est isolé (18 min de Midi, 40 min et plus du centre).
- **Le Listen Express a un vrai intérêt** : North → Fuse, c'est 44 min à pied, contre quelques minutes de train puis 10 min de Midi à Fuse.
- **Mike Servito à CityGate** (hors du parcours) est faisable depuis Fuse : 26 min, ou 18 min depuis Midi.

**À faire** :
- Un script `scripts/build-routes.js` (lancé à la main, pas au démarrage) qui appelle le service une fois pour tous les couples et écrit `public/routes.json` : durée, distance et tracé simplifié (polyline encodée, environ 30 à 60 ko au total).
- Garder le calcul en direct seulement pour « depuis ma position » ou « vers un pote », avec repli sur : tracé précalculé depuis le lieu ou la gare le plus proche de moi + le bout de chemin restant estimé.
- **Allure « festival »** : multiplier par 1,2 la nuit, en groupe (réglable : « on marche vite / normal / tranquille »). Afficher « 21 à 25 min » plutôt qu'un chiffre trop précis.

### 5.3 La durée partout
- Sur chaque épingle de lieu (zoom ≥ 15) : « 8′ » depuis moi.
- Dans la fiche du lieu, le line-up, « Maintenant », les messages RDV, la liste des potes : **le temps de marche depuis moi**, pas la distance à vol d'oiseau.
- Dans « Où vous vous retrouvez » : le temps de chacun pour y aller.
- Sans position connue : temps depuis le lieu sélectionné ou le dernier lieu où j'étais.

### 5.4 Heure d'arrivée et « encore ouvert ? »
Pour chaque trajet : « Départ maintenant → **arrivée 01:42** ». Puis vérifier avec les horaires du lieu :
- ✅ « Ouvert jusqu'à 08:00 ».
- ⚠️ « Ferme à 02:00, tu auras 18 min sur place ».
- ⛔ « Fermé à ton arrivée » / « N'ouvre qu'à 23:00, tu attendras 35 min ».
Quand les heures de passage des DJ seront publiées : « MCR-T joue de 02:00 à 03:30 : pars avant 01:35 ».

### 5.5 Tous les moyens de se déplacer
| Moyen | Ce que l'appli affiche | Source |
|---|---|---|
| **À pied** | Temps, tracé, étapes (déjà là) | Matrice §5.2 + calcul en direct |
| **Listen Express** | « Prochain départ de Nord vers Midi » dès que les horaires sont publiés ; sinon « Passe entre 00:00 et 05:00, Nord – Central – Midi ». Temps total = marche jusqu'à la gare + train (≈ 5 min entre deux gares, **à confirmer**) + marche à l'arrivée. Proposer le Express automatiquement quand il fait gagner plus de 10 min. | Données du festival |
| **STIB de nuit** | Lien vers l'itinéraire STIB ; rappel des horaires de nuit du samedi (métro et bus Noctis, **à vérifier sur stib.be**) | Lien profond |
| **Vélo partagé** | Station la plus proche et lien vers l'appli | Lien profond (Villo, Lime, Dott…) |
| **Taxi / VTC** | Bouton « Commander » qui ouvre l'appli avec la destination remplie | Lien profond (Uber, Bolt, Taxis Verts) |
| **Autre appli** | « Ouvrir dans Google Maps / Plans » avec départ et arrivée | `https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=walking`, `maps://?daddr=` |

Les liens profonds ne coûtent rien, marchent tout de suite et laissent les applis spécialisées faire leur travail.

### 5.6 Rejoindre un pote
- « Y aller » vers un pote : l'itinéraire se **recalcule quand il bouge** (toutes les 30 s ou 50 m).
- Bouton « **J'arrive** » : envoie dans le chat « Max arrive dans ~8 min » avec la flèche sur la carte, et met à jour le temps restant tout seul.
- S'il ne partage plus : aller à sa dernière position, avec un avertissement (« position d'il y a 14 min »).

### 5.7 Le meilleur point de rencontre
Quand le groupe est éparpillé : bouton « **Se retrouver** » qui propose le lieu (ou la gare) qui **minimise le temps de marche du plus éloigné**, en ne gardant que les lieux ouverts. Exemple : un pote à North, un à Fuse, un à C12 → proposer Central ou Blur (≈ 20 à 27 min pour chacun) plutôt que l'un des trois. Un toucher envoie le RDV au groupe. Avec la matrice §5.2, c'est un calcul de quelques lignes, sans réseau.

### 5.8 Mon parcours, calculé depuis mes « J'y vais »
Remplacer le parcours fixe de Mahx par un **parcours propre à chacun** :
1. Prendre mes DJ choisis, et donc mes lieux.
2. Les ordonner selon les horaires d'ouverture et les temps de trajet (y compris le Listen Express).
3. Afficher une frise personnelle : « 20:00 Hexagon (2 h) → 21 min à pied → 22:30 North (1 h 30) → Express 00:10 → 01:30 Fuse ».
4. Signaler les **conflits** (« Tu as choisi 3 lieux qui ferment tous à 05:00 dans 3 quartiers différents ») et les **trous**.
5. Une fois les heures de passage publiées : placer chaque DJ à sa vraie heure.
Le parcours de Mahx devient simplement le sien, calculé de la même façon.

### 5.9 Rentrer
- **Départ** : remplacer le champ texte « Ta gare de départ » par une vraie gare choisie dans une liste (gardée dans le profil de chacun).
- **Trains SNCB** : afficher « Dernier train vers Mont-Saint-Guibert : 23:58 » et « Premier train dimanche : 06:xx » grâce à l'API publique et gratuite **iRail** (`https://api.irail.be/connections/?from=Brussels-Central&to=Mont-Saint-Guibert&format=json`). Appel fait par le serveur (et mis en cache 10 min) pour ne pas exposer chaque téléphone et pour tenir le mode hors ligne.
- Statut « **Je rentre** » : propose de partager le trajet jusqu'à la gare, puis d'envoyer « Bien rentré » d'un toucher. Si rien au bout de 2 h, petit rappel à la personne (pas d'alerte au groupe sans son accord).
- Bouton « Taxi jusqu'à chez moi » (lien profond, §5.5).

### 5.10 Sans réseau
La matrice, les tracés précalculés et les tuiles de la zone (§6.1) suffisent à afficher un itinéraire entre deux lieux **en mode avion**. Seul « depuis ma position exacte » a besoin du réseau, avec repli sur « depuis le lieu le plus proche de toi ».

---

## 6. Tenir sur le terrain

### 6.1 Hors ligne (le plus important)
- **Service worker** (`public/sw.js`) :
  - Pré-cache de l'appli : `index.html`, `app.js`, `data.js`, `style.css`, Leaflet, icônes, polices, `routes.json`.
  - **Tuiles de la carte** de la zone du festival (environ 50.825–50.866 N, 4.315–4.368 E), zooms 13 à 17 : quelques centaines de tuiles, quelques Mo. Les télécharger **au premier lancement en Wi-Fi**, avec une barre « Carte hors ligne prête ». Respecter les règles d'usage des tuiles OpenStreetMap : rester sur cette petite zone, une seule fois, avec un `User-Agent` correct. Plus propre encore : générer ces tuiles une fois et les servir depuis notre propre serveur.
  - Stratégie : appli « cache d'abord » ; API « réseau d'abord » avec repli sur la dernière réponse.
- **File d'attente** des envois (messages, statut, RDV, « J'y vais ») dans IndexedDB, rejouée au retour du réseau, chaque envoi avec un identifiant unique pour que le serveur ne le compte pas deux fois.
- Afficher clairement l'âge des informations : « Positions d'il y a 4 min (hors ligne) ».

### 6.2 Réseau faible
- Envoyer les positions en lots plus petits, et en mode simple, passer de 3 s à 6 s quand rien ne change.
- Compresser les réponses (`gzip`) sauf le flux SSE.
- Le premier état envoie 200 messages : n'envoyer que les 50 derniers, et le reste à la demande en remontant.

### 6.3 Notifications quand l'appli est fermée
Le navigateur coupe le GPS et le flux en arrière-plan : on ne peut pas suivre les potes appli fermée. Mais on peut **prévenir** :
- **Web Push** (fonctionne sur Android, et sur iPhone pour une appli **installée sur l'écran d'accueil**, iOS 16.4 et plus) pour : « Léa est perdue », nouveau RDV, mention `@moi`, « bruit » (option).
- Côté serveur : clés VAPID et envoi signé, faisable sans dépendance avec `node:crypto` (ou accepter une seule petite dépendance comme `web-push`).
- Proposer l'activation **au bon moment** (après le premier RDV reçu), pas à l'entrée.

### 6.4 Sécurité des personnes
- « Je suis perdu » : notification push à tout le groupe, position envoyée, et dans l'appli de la personne : le RDV le plus récent, le pote le plus proche, et un bouton **112**.
- Infos utiles hors ligne : points d'eau, toilettes, postes de secours **si le festival les publie**, numéro du festival, 112.
- Batterie faible (sous 15 %, si le navigateur le donne) : proposer d'envoyer « batterie faible, je risque de couper » avec sa position.

---

## 7. Fonctions de groupe qui font la différence

| Idée | Pourquoi | Effort |
|---|---|---|
| **Sondage éclair** « On bouge à Fuse à 02:00 ? » Oui / Non / Plus tard, résultat en direct | Remplace 15 messages | Petit |
| **File d'attente collective** : quand quelqu'un met « Dans la file » près d'un lieu, afficher « Léa dans la file à Fuse depuis 20 min » sur la fiche du lieu | Info que personne d'autre n'a | Petit |
| **Présence par lieu** : qui est à quel lieu en ce moment (position à moins de 80 m) | Lecture instantanée sur la carte et dans « Maintenant » | Petit |
| **Goûts par personne** et « Toi aussi » partout | Corrige B4, rend « Mes goûts » vrai pour tout le monde | Moyen |
| **Admin du groupe** : la première personne peut modifier les horaires et ajouter les heures de passage sans redéployer (fichier de données sur le serveur, page protégée) | Le programme va bouger d'ici au 21 | Moyen |
| **Souvenir de la nuit** le dimanche : km marchés par personne, lieux visités, DJ vus, carte des trajets du groupe | Fun, partageable | Moyen |

---

## 8. Code et fiabilité

### 8.1 Organisation
- Découper `app.js` en **modules natifs** (sans outil de build) : `net.js` (API, SSE, file d'attente), `map.js`, `routes.js` (matrice, calculs), `program.js`, `group.js`, `chat.js`, `ui.js` (feuille du bas, toasts). Chargés par `<script type="module">`.
- Remplacer les noms d'une lettre de `data.js` (`V`, `T`, `s`, `e`, `k`, `ar`) par des noms parlants (`venues`, `opensAt`, `closesAt`, `kind`, `artists`). Un fichier JSON (`data/festival.json`) servi par le serveur, plutôt que des constantes globales.
- Un seul endroit pour `COLORS` et `STATUS` (servis par `/api/config`), fin des copies.

### 8.2 Tests
- Ajouter des tests pour les fonctions pures du site (temps, matrice, point de rencontre, parcours, file d'attente) avec `node --test`.
- Un test de bout en bout sur **émulation mobile** (Playwright, appareil « iPhone 13 ») : entrer, choisir un DJ, envoyer un message, recevoir chez un second utilisateur, passer en mode avion et rouvrir.
- Lancer `npm test` dans GitHub Actions **avant** `flyctl deploy` ; figer `superfly/flyctl-actions/setup-flyctl` sur une version.

### 8.3 Données
- Identifiant stable par passage : `{ id: 'fuse-mcr-t', artist: 'MCR-T', venue: 'fuse', start: null, end: null }` ; `start`/`end` remplis quand les heures seront publiées.
- Champ `updatedAt` sur les données du festival, affiché (« Programme mis à jour le 18/11 »).
- Relevé à refaire sur listenfestival.be à J-7 et J-2 (horaires, Studio CityGate « 23:00 - 23:00 », adresse de Congrès, horaires de l'Express).

### 8.4 Serveur, vie privée, exploitation
- Cookie de session au lieu du jeton dans l'URL (B5), expiration le 23/11.
- Effacer les positions à l'arrêt du partage (B6) ; effacement complet automatique le 23/11 ; une phrase claire dans l'appli : « Ta position n'est visible que par le groupe, pendant que tu partages, et tout est effacé le 23/11 ».
- Polices hébergées chez nous (B8).
- Docker : lancer en utilisateur `node` plutôt qu'en `root`.
- Sauvegarde : vérifier que les instantanés quotidiens du volume Fly sont actifs (`fly volumes snapshots list`).
- Surveillance pendant la nuit : alerte si `/healthz` tombe (un service gratuit de surveillance suffit), journaux `fly logs` accessibles depuis le téléphone.

---

## 9. Plan de bataille jusqu'au festival

| Quand | Quoi |
|---|---|
| **Semaine du 9/11** | Hors ligne (service worker, tuiles, file d'attente). Matrice de trajets + durée partout + heure d'arrivée. Carte plein écran avec feuille du bas. Corrections B3, B5, B6, B7, B8. |
| **Semaine du 16/11** | Onglets Programme et Groupe, line-up refait, chat refait (clavier, envoi hors ligne, nouveaux messages). Goûts par personne. Mode économie. Push pour « perdu » et RDV. Point de rencontre. |
| **19/11 (J-2)** | **Gel du code.** Liste de contrôle mobile §4.10 sur au moins un iPhone et un Android. Relevé du programme. Chacun installe l'appli sur l'écran d'accueil et ouvre la carte en Wi-Fi (tuiles téléchargées). |
| **20/11 (J-1)** | Seulement les données (horaires, heures de passage si publiées). Aucun changement de code. |
| **21–22/11** | Rien à déployer. Surveiller `/healthz`. |
| **23/11** | Effacement automatique des positions et des sessions. « Souvenir de la nuit ». |

Si le temps manque, l'ordre de priorité est : **hors ligne > durée partout > carte avec feuille du bas > chat > Programme > le reste.**

---

## 10. Ce que veut dire « 10/10 » (critères vérifiables)

- [ ] L'appli s'ouvre et montre la carte, les lieux et les temps de marche **en mode avion**.
- [ ] Depuis n'importe quel écran, on sait en **moins de 3 secondes** où sont les potes et à combien de minutes.
- [ ] Toute action fréquente (statut, RDV, J'y vais, message rapide, « je suis perdu ») se fait en **2 touchers maximum**, au pouce.
- [ ] Chaque lieu affiché montre **ouvert / ferme à / ouvre à** et **le temps de marche depuis moi**.
- [ ] Un message écrit sans réseau **part tout seul** quand le réseau revient, sans doublon.
- [ ] « Je suis perdu » **réveille le téléphone** des autres (push), appli fermée.
- [ ] Rien n'est coupé ni ne défile de côté sur un écran de 375 px ; le clavier ne cache jamais le champ de saisie.
- [ ] 2 heures de partage de position coûtent **moins de 20 %** de batterie sur un téléphone récent en mode économie.
- [ ] Aucun appel à un service tiers n'est nécessaire pour l'usage de base pendant la nuit.
- [ ] Les tests passent avant chaque déploiement, et rien n'est déployé après le 19/11 sauf les données.
- [ ] Les positions sont effacées le 23/11, et l'appli le dit.
