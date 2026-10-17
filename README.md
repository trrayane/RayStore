<p align="center">
  <img src="docs/logo.png" width="110" alt="Logo RayStore">
</p>

<h1 align="center">RayStore</h1>

<p align="center">
  Boutique e-commerce algérienne spécialisée en mangas, manhwas, novels et goodies —<br>
  paiement à la livraison, notifications Telegram, colis Yalidine / ZR Express.
</p>

---

## Aperçu

RayStore est une boutique en ligne complète, déployée sur Vercel :

- **Côté client** : catalogue avec filtres avancés, fiches produits, panier, favoris, commande en paiement à la livraison (COD) avec confirmation WhatsApp.
- **Côté admin** : tableau de bord avec graphiques, gestion des produits/volumes, promotions, commandes, journal des mouvements de stock, colis transporteurs.
- **Côté serveur** : API Express + PostgreSQL (Neon), rendu SEO côté serveur, notifications Telegram (commandes **avec photo des articles** + alertes de stock).

**URL de production** : <https://raystore-black.vercel.app>

## Fonctionnalités

### Boutique
- Catalogue par type (manga, manhwa, novel, comics, goodies), genres, langue, prix et disponibilité.
- Recherche instantanée avec vignettes, tri, filtres persistés dans l'URL.
- Pages produits en URL propre (`/p/jjk-1`) avec couvertures, volumes et stock en direct.
- Panier, favoris, livraison à domicile ou point relais, récapitulatif chiffré.
- Commande COD → notification Telegram détaillée **+ photo de chaque article** → lien WhatsApp pré-rempli.

### Administration (`#/admin`)
- **Tableau de bord** : chiffre d'affaires sur 14 jours, top ventes, répartition des statuts, commandes des 7 derniers jours.
- **Produits** : séries et volumes, import/export, images (téléversement ou lien), stock.
- **Commandes** : statuts, fiche détaillée, export CSV, bloc **Livraison** (création de colis Yalidine / ZR Express, n° de suivi, étiquette).
- **Mouvements de stock** : journal complet des entrées/sorties (commande, annulation, correction, import) avec stock après coup.
- **Paramètres** : boutique, bannière d'accueil (avec vignette de couverture dans le sélecteur), mot de passe, transporteurs.
- **Notifications Telegram** : nouvelle commande (texte + photos), alertes **Épuisé** / **Réassort**.

### SEO & sécurité
- Métadonnées dynamiques, Open Graph, JSON-LD `Product` + `BreadcrumbList`, `sitemap.xml`, `robots.txt`.
- Admin en `noindex`, API protégée par JWT, mots de passe hachés (bcrypt), migrations SQL automatiques.

## Stack technique

| Couche | Technologie |
| --- | --- |
| Frontend | HTML / CSS / JavaScript vanilla (SPA monofichier) |
| Backend | Node.js 24, Express |
| Base de données | PostgreSQL (Neon) via `pg` |
| Hébergement | Vercel (serverless) |
| Notifications | Telegram Bot API |
| Livraison | Yalidine, ZR Express |
| Images | Cloudinary / fichiers statiques |

## Démarrage rapide

**Prérequis** : Node.js 24.x, un base PostgreSQL.

```bash
git clone <url-du-depot> raystore
cd raystore
npm install
cp .env.example .env   # puis remplir .env (voir tableau ci-dessous)
npm run dev            # développement (nodemon)
npm start              # production
```

Le serveur écoute sur `http://localhost:3000` (`GET /api/health` pour vérifier).

## Variables d'environnement (`.env`)

| Variable | Requise | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | ✔ | Chaîne de connexion Postgres (Neon) |
| `DATABASE_URL_UNPOOLED` | option | Variante sans pooling (Neon) |
| `ADMIN_PASSWORD` | ✔ | Mot de passe d’accès à l’administration |
| `JWT_SECRET` | ✔ | Signature des tokens API |
| `TELEGRAM_BOT_TOKEN` | option | Token du bot Telegram (commandes + alertes) |
| `TELEGRAM_CHAT_ID` | option | Identifiant du chat de réception |
| `PUBLIC_URL` | option | URL publique (défaut : URL de production) — sitemap, liens, photos Telegram |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | option | Téléversement d’images |
| `YALIDINE_API_ID` / `YALIDINE_API_TOKEN` | option | Création de colis Yalidine |
| `YALIDINE_FROM_WILAYA` | option | Wilaya de départ (défaut : `Alger`) |
| `YALIDINE_WEIGHT` | option | Poids par défaut (défaut : `1`) |
| `ZREXPRESS_API_KEY` / `ZREXPRESS_TENANT_ID` | option | Création de colis ZR Express |
| `PORT` | option | Port local (défaut : `3000`) |

> Les transporteurs restent affichés « **Non configuré** » tant que leurs clés ne sont pas présentes : ajoute-les dans `.env`, puis dans Vercel (`vercel env add ...`) et redéploie.

## Structure du projet

```
raystore/
├── index.html          # Boutique + administration (SPA)
├── server.js           # Express : API, SEO, sitemap, statique
├── api/index.js        # Point d'entrée serverless (Vercel)
├── db.js               # Pool Postgres + migrations
├── telegram.js         # Commandes (avec photos) + alertes stock
├── stock_alerts.js     # Logique épuisement / réassort
├── stock_journal.js    # Journal des mouvements de stock
├── carriers.js         # Yalidine / ZR Express
├── middleware/auth.js  # Authentification JWT
├── routes/             # auth, products, orders, stock, soon, hero, settings, upload, export
├── p/                  # Images produits
├── docs/logo.png       # Logo
├── robots.txt
└── vercel.json         # Réécritures + fichiers inclus
```

## API

### Publique
| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/api/health` | État du service |
| GET | `/api/products` | Catalogue actif |
| GET | `/api/soon`, `/api/hero`, `/api/settings` | Sections et paramètres publics |
| POST | `/api/orders` | Nouvelle commande (stock décrémenté, Telegram) |
| GET | `/api/upload/img/:id` | Image téléversée |
| GET | `/sitemap.xml`, `/robots.txt`, `/p/:id` | SEO rendu côté serveur |

### Administration (en-tête `Authorization: Bearer <token>`)
| Méthode | Route | Description |
| --- | --- | --- |
| POST | `/api/auth/login` | Connexion → token |
| GET / POST / PUT / DELETE | `/api/products…` | Gestion du catalogue (`/all`, `/replace`, `/:k`) |
| GET / PATCH / DELETE | `/api/orders…` | Liste, stats, statut, suppression |
| GET / POST | `/api/orders/carriers`, `/carriers/test` | État et test des transporteurs |
| POST / GET | `/api/orders/:id/parcel`, `/:id/tracking`, `/:id/label` | Colis, suivi, étiquette |
| GET | `/api/stock/movements` | Journal des mouvements de stock |
| POST / GET / DELETE | `/api/upload…` | Images |
| PUT | `/api/soon`, `/api/hero`, `/api/settings` | Contenu et paramètres |
| GET | `/api/export/json` | Sauvegarde complète |

## Déploiement (Vercel)

```bash
vercel --prod --yes
```

`vercel.json` route tout `/api/*` vers la fonction serverless et inclut `index.html`. Les variables d’environnement se configurent avec `vercel env add <NOM>`. Après chaque déploiement, vérifier : `/sitemap.xml`, `/robots.txt`, et l’envoi Telegram d’une commande de test.

## Vérifications

Avant chaque livraison :

```bash
node --check server.js   # (+ db.js, telegram.js, carriers.js, routes/*.js ...)
```

Deux suites sont exécutées à chaque lot : **38 vérifications serveur** (SEO, sitemap, breadcrumb, journal de stock, transporteurs) et **40 vérifications d’interface** (dashboard, mouvements, fiche commande, sélecteur avec vignettes, régressions).

---

<p align="center">RayStore — boutique, administration et livraison en un seul projet.</p>
