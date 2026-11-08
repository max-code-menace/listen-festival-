# Plan Listen 2026

Le site du groupe pour le Listen Festival (Bruxelles, sam. 21 nov. 14h → dim. 22 nov. 14h 2026) : la carte des 15 lieux, les potes en direct, les itinéraires à pied, le chat, le line-up avec « J'y vais » partagé. Prévu pour **10 personnes maximum**.

## Lancer chez soi (PowerShell)

Il faut seulement [Node.js](https://nodejs.org) 20 ou plus. Rien à installer d'autre.

```powershell
cd listen-festival-
$env:GROUP_CODE = "mon-code-secret"
node server.js
```

Puis ouvrir http://localhost:3000. Le premier arrivé choisit un pseudo et une couleur avec le code. Les autres font pareil, ou ouvrent le lien d'invitation (profil en haut à droite, « Copier le lien d'invitation »), qui préremplit le code.

Sans `GROUP_CODE`, le code de test est `listen`.

## Sur téléphone

Le site est fait **pour le téléphone uniquement** (référence : 375 × 667). Sur ordinateur, il s'affiche en simple colonne au milieu. Une fois en ligne, ouvrez-le dans Safari ou Chrome puis « Ajouter à l'écran d'accueil » : il s'ouvre en plein écran comme une appli, avec son icône.

Quatre onglets :

- **Carte** : plein écran, avec un panneau qui glisse du bas (replié, moitié, plein). Toucher un lieu ouvre sa fiche : temps de marche depuis toi, heure d'arrivée, ouvert ou pas à l'arrivée. « Y aller » trace l'itinéraire, propose le Listen Express quand il fait gagner du temps, et permet de prévenir le groupe (« j'arrive dans ~8 min »).
- **Programme** : « Maintenant » (ce qui est ouvert, trié par minutes de marche), « Line-up » (recherche, filtres, « J'y vais » en touchant la ligne), « Horaires » (frise, mon parcours d'après mes choix, Listen Express).
- **Groupe** : statut, « faire du bruit », les potes à X min de toi, **« Se retrouver maintenant »** (le lieu le plus juste pour tout le monde), le planning de chacun.
- **Chat** : messages, RDV, position, repère « Nouveaux messages ».

**Hors ligne** : après une première ouverture avec du réseau, l'appli s'ouvre sans réseau (service worker `public/sw.js`), avec la carte des quartiers du festival (téléchargée seule, environ 200 morceaux) et tous les temps de marche entre lieux. Les messages, RDV, statuts et « J'y vais » écrits sans réseau partent tout seuls quand il revient, sans doublon.

Profil (pastille en haut à droite) : allure à pied, gare de départ, **mode économie de batterie**, carte hors ligne, lien d'invitation.

Pour voir l'appli « pendant » le festival : ajoutez `?now=2026-11-22T01:30:00%2B01:00` à l'adresse.

## Tester

```powershell
npm test
```

34 tests : le serveur (code du groupe, groupe complet, messages en direct, anti-doublon hors ligne, positions privées et effacées, « J'y vais », statut, bruit, pas, mode de secours, compression, sécurité des fichiers) et les calculs du site (heures, trajets précalculés, estimation depuis le GPS, arrivée, point de rencontre, Listen Express, fichiers gardés hors ligne). GitHub lance ces tests avant chaque mise en ligne : un test qui échoue bloque le déploiement.

## Recalculer les trajets

Les temps de marche entre lieux sont dans `public/routes.json`, calculés une fois avec le service d'OpenStreetMap. À refaire seulement si un lieu change de place dans `public/data.js` (environ 2 minutes) :

```powershell
npm run routes
```

## Mettre en ligne sur un hébergement mutualisé (cPanel avec « Node.js »)

Il faut que le panneau propose **« Setup Node.js App »** (« Configurer l'application Node.js »). Sans cette option, un hébergement mutualisé ne peut pas faire tourner le site (il ne sait lancer que du PHP) : il faut alors un VPS ou une autre plateforme.

Non testé sur un vrai cPanel (je n'y ai pas accès) : le démarrage derrière Passenger est vérifié en simulation seulement.

1. **Récupérer le code**, en SSH (le dépôt est public) :
   ```bash
   cd ~
   git clone https://github.com/max-code-menace/listen-festival- listen-festival
   mkdir -p ~/listen-data
   ```
   Sans `git` : téléchargez le ZIP depuis GitHub, envoyez-le par le Gestionnaire de fichiers et décompressez-le dans `~/listen-festival` (**pas** dans `public_html`).
2. **cPanel → Setup Node.js App → Create Application** (en français, section LOGICIEL : « Configurer une application Node.js », puis « Créer une application ») :
   - Node.js version : 20 minimum, de préférence la version LTS la plus récente. Si elle n'est pas dans la liste, demandez-la au support : chez EasyHoster c'est gratuit et traité sous 24 h.
   - Application mode : `Production`
   - Application root : `listen-festival`
   - Application URL : votre domaine (ou un sous-domaine comme `listen.mondomaine.be`)
   - Application startup file : **`start.js`** (pas `server.js`)
   - Variables d'environnement :
     | Nom | Valeur |
     |---|---|
     | `GROUP_CODE` | le code secret du groupe |
     | `DATA_FILE` | `/home/VOTRE_UTILISATEUR/listen-data/db.json` |
     | `TRUST_PROXY` | `1` |
   Puis **Create** et **Restart**.
3. **HTTPS** (obligatoire pour la position GPS) : cPanel → *SSL/TLS Status* → *Run AutoSSL* pour le domaine.
4. **Vérifier** : `https://mondomaine.be/healthz` doit répondre `{"ok":true,…}`. Ouvrez ensuite le site : un point en haut indique l'état de la connexion.
   - **« En direct »** : tout fonctionne en temps réel.
   - **« Mode simple »** : l'hébergeur retient la connexion en direct, le site se met alors à jour toutes les 3 secondes (messages, positions et « bruit » marchent, avec un petit délai). C'est automatique.

Mettre à jour : en SSH `cd ~/listen-festival && git pull`, puis **Restart** dans le panneau. Les messages sont gardés dans `~/listen-data/db.json`, hors du dossier du site, donc une mise à jour ne les efface pas.

Si `/healthz` ne répond pas : regardez le journal d'erreurs de l'application (fichier `stderr.log` dans le dossier de l'application, ou le journal d'erreurs du panneau).

## Mettre en ligne sur Fly.io

Fly.io garde le serveur allumé, donne l'HTTPS tout seul et a une région à Paris. La configuration est dans `fly.toml` et `Dockerfile` (non testés en vrai : le conteneur de développement n'a ni Docker ni compte Fly).

À faire une fois, dans PowerShell :

```powershell
iwr https://fly.io/install.ps1 -useb | iex     # installe l'outil fly (puis rouvrir PowerShell)
fly auth signup                                 # ou : fly auth login
cd listen-festival-
git pull
fly launch --no-deploy --copy-config --name NOM-UNIQUE --region cdg
fly volumes create listen_data --region cdg --size 1 --yes
fly secrets set GROUP_CODE="mon-code-secret"
fly deploy --ha=false
fly status
```

- `NOM-UNIQUE` : le nom doit être libre chez Fly. Le site sera sur `https://NOM-UNIQUE.fly.dev`.
- `--ha=false` est important : **une seule machine**. Avec deux, chacune aurait ses propres messages et positions.
- Le volume `listen_data` garde les messages et les membres entre deux démarrages.
- Le code du groupe est un secret Fly : il n'est jamais dans le dépôt.

Mettre à jour après un changement : un `git push` sur `main` suffit, GitHub redéploie tout seul (`.github/workflows/fly-deploy.yml`, avec la clé Fly dans le secret `FLY_API_TOKEN` du dépôt). À la main, depuis le PC : `git pull` puis `fly deploy --ha=false`.

Le site en ligne : https://plan-listen.fly.dev (app `plan-listen`, région Paris).
Voir les journaux : `fly logs`.

Brancher un nom de domaine, plus tard :

```powershell
fly certs add listen.mondomaine.be
fly certs show listen.mondomaine.be     # affiche les enregistrements DNS à créer chez le registraire
```

## Autre hébergeur

Le site a besoin d'un petit serveur Node qui reste allumé, et d'**HTTPS**. Sans HTTPS, les navigateurs refusent de donner la position GPS. Les hébergeurs de type Render, Railway ou Fly.io donnent l'HTTPS tout seuls et acceptent un nom de domaine.

Réglages à donner à l'hébergeur :

| Réglage | Valeur |
|---|---|
| Commande de démarrage | `node server.js` |
| `NODE_ENV` | `production` (le serveur refuse alors de démarrer sans `GROUP_CODE`) |
| `GROUP_CODE` | le code que vous donnez aux potes |
| `PORT` | fourni par l'hébergeur |
| `DATA_FILE` | un fichier sur un **disque qui se conserve** (sinon les messages sont perdus à chaque redémarrage) |
| `MAX_MEMBERS` | 10 par défaut |

## Comment c'est fait

- `server.js` : serveur sans aucune dépendance. Les messages, positions et « J'y vais » sont gardés dans un fichier JSON (`data/db.json`). Le temps réel passe par SSE. Les fichiers texte sont envoyés compressés.
- `public/` : le site. `data.js` contient les lieux, horaires, line-ups et goûts ; `core.js` les calculs (heures, temps de marche, arrivée, rencontre, Express) ; `app.js` l'affichage ; `routes.json` les trajets précalculés ; `sw.js` le hors ligne ; `style.css` l'apparence ; `vendor/leaflet` la carte.
- Fond de carte : OpenStreetMap. Itinéraires : précalculés entre lieux ; depuis ta position, calculés en direct par `routing.openstreetmap.de` (repli hors ligne : trajet gardé depuis le lieu le plus proche, ou estimation).
- `docs/SPEC.md` : le spec complet, le diagnostic et ce qu'il reste à faire.
- `scripts/build-routes.js` : recalcule `public/routes.json`.

## Limites

- Les itinéraires du site sont **à pied**. Le Listen Express est proposé avec une durée estimée (~10 min d'attente, ~5 min entre deux gares) : ses horaires de passage ne sont pas publiés. Pour la STIB, le taxi ou une autre appli, des liens ouvrent Google Maps / Plans / Uber.
- La position se partage seulement quand la page est ouverte (les navigateurs coupent le GPS en arrière-plan). Le site demande à l'écran de rester allumé tant que le partage est actif. Arrêter le partage efface la position ; toutes les positions sont effacées le 23/11 (`PURGE_AT` pour changer la date).
- Quiconque a le code peut reprendre un pseudo existant (utile si on change de téléphone, mais ce n'est pas un vrai compte). À 10 potes de confiance, c'est voulu.
- Le fond de carte et le service d'itinéraires publics d'OpenStreetMap sont faits pour un petit usage comme celui-ci, pas pour beaucoup de monde.
- Heures de passage par DJ non publiées ; Studio CityGate affiché « 23:00 - 23:00 » ; position de Congrès approximative.
