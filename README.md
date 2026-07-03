# Floor Request

Deux apps + un serveur qui tourne sur ton ordinateur, en réseau local (même WiFi).

- **App publique** : les gens sur le dancefloor scannent un QR code et demandent un morceau (recherche Beatport en direct, ou message libre).
- **App DJ** : dashboard temps réel sur ton laptop, avec classement des morceaux les plus demandés et un widget façon "encoche" qui affiche le top du moment.

## Installation

Il te faut [Node.js](https://nodejs.org) installé (version 18 ou plus, pour `fetch` natif).

```bash
cd floor-request
npm install
cp .env.example .env
```

Ouvre `.env` et :
- change `DJ_PASSWORD` (le mot de passe pour accéder au dashboard DJ)
- si tu veux la vraie recherche Beatport, renseigne `BEATPORT_CLIENT_ID`, `BEATPORT_ACCESS_TOKEN`, `BEATPORT_REFRESH_TOKEN` (voir les instructions dans `.env.example`). Sans ça, l'app fonctionne quand même, juste en mode "message libre" uniquement.

## Lancer

```bash
npm start
```

Le terminal affiche quelque chose comme :

```
App publique (a scanner)  : http://192.168.1.42:3000/public-app/
Dashboard DJ (sur ton PC) : http://localhost:3000/dj-app/
```

- Ouvre le dashboard DJ **sur ton ordinateur** : `http://localhost:3000/dj-app/`
- Le QR code à scanner par le public s'affiche directement dans le dashboard DJ — imprime-le ou affiche-le sur un écran.
- Les téléphones doivent être **sur le même réseau WiFi** que ton ordinateur pour scanner le QR et accéder à l'app publique.

## Mac : autoriser les connexions entrantes

La première fois que tu lances `npm start`, macOS peut demander si Node a le droit d'accepter des connexions entrantes sur le réseau — accepte, sinon les téléphones ne pourront pas te joindre. Si besoin, vérifie dans Réglages Système → Confidentialité et sécurité → Pare-feu.

## Après la soirée

Les demandes sont stockées en mémoire (pas de base de données) — elles disparaissent quand tu arrêtes le serveur. C'est volontaire pour un usage "une soirée à la fois" ; si tu veux garder un historique entre soirées, on peut ajouter une petite base SQLite.

## Étape suivante : lien avec Serato

Ce serveur n'écrit pas encore dans Serato. L'étape suivante consiste à ajouter un script qui, à chaque nouvelle demande matchée à ta bibliothèque locale, écrit automatiquement dans une crate `.crate` (`_Serato_/Subcrates/Requests.crate`) pour qu'elle apparaisse dans Serato sans effort de ta part.
