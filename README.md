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

Le site est pensé pour le téléphone d'abord (cibles tactiles de 44 px minimum, carte pleine largeur, onglets en bas). Une fois en ligne, ouvrez-le dans Safari ou Chrome puis « Ajouter à l'écran d'accueil » : il s'ouvre en plein écran comme une appli, avec son icône.

## Tester

```powershell
npm test
```

19 tests du serveur (code du groupe, groupe complet, messages en direct, positions privées, « J'y vais », statut, bruit, pas, mode de secours, sécurité des fichiers).

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

- `server.js` : serveur sans aucune dépendance. Les messages, positions et « J'y vais » sont gardés dans un fichier JSON (`data/db.json`). Le temps réel passe par SSE.
- `public/` : le site. `data.js` contient les lieux, horaires, line-ups et goûts ; `app.js` la logique ; `style.css` l'apparence ; `vendor/leaflet` la carte.
- Fond de carte : OpenStreetMap. Itinéraires à pied : service de routage d'OpenStreetMap (`routing.openstreetmap.de`), appelé depuis le navigateur.
- `listen-2026.html` : la première version, une page seule sans serveur.

## Limites

- Les itinéraires du site sont **à pied**. Les trains (SNCB, Listen Express) ne sont pas calculés : leurs horaires de nuit ne sont pas publiés.
- La position se partage seulement quand la page est ouverte (les navigateurs coupent le GPS en arrière-plan). Le site demande à l'écran de rester allumé tant que le partage est actif.
- Quiconque a le code peut reprendre un pseudo existant (utile si on change de téléphone, mais ce n'est pas un vrai compte). À 10 potes de confiance, c'est voulu.
- Le fond de carte et le service d'itinéraires publics d'OpenStreetMap sont faits pour un petit usage comme celui-ci, pas pour beaucoup de monde.
- Heures de passage par DJ non publiées ; Studio CityGate affiché « 23:00 - 23:00 » ; position de Congrès approximative.
