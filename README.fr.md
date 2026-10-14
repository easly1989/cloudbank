<p align="center">
  <img src="docs/img/logo.svg" alt="Logo de CloudBank" width="96" height="96" />
</p>

<h1 align="center">CloudBank</h1>

<p align="center">
  <strong>Votre argent, sur votre serveur.</strong><br />
  Un gestionnaire de finances personnelles gratuit sur le web : une version pour navigateur de <a href="https://www.gethomebank.org/">HomeBank</a>, réécrite de zéro.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.de.md">Deutsch</a> · <strong>Français</strong>
</p>

<p align="center">
  <a href="https://p01--cloudbank--7dcjw6mlmtky.code.run/"><img src="https://img.shields.io/badge/Essayer_la_d%C3%A9mo-2457D6?style=for-the-badge" alt="Essayer la démo" height="34" /></a>
</p>

<p align="center">
  <sub>Des données inventées dans un compte jetable, effacé quand vous ne l’utilisez plus. <a href="docs/demo.md">Ce qu’est la démo</a> (en anglais).</sub>
</p>

<p align="center">
  <a href="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml"><img src="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml/badge.svg" alt="État de la CI" /></a>
  <a href="https://github.com/easly1989/cloudbank/issues"><img src="https://img.shields.io/github/issues/easly1989/cloudbank" alt="Issues ouvertes" /></a>
  <a href="https://github.com/easly1989/cloudbank/pkgs/container/cloudbank"><img src="https://img.shields.io/badge/ghcr.io-cloudbank-2496ED?logo=docker&logoColor=white" alt="Image du conteneur" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="Licence : AGPL v3" /></a>
</p>

---

**CloudBank** est un gestionnaire de finances personnelles gratuit, à héberger vous-même et à utiliser dans le navigateur : une version web, réécrite de zéro, de l’excellente application de bureau [HomeBank](https://www.gethomebank.org/). Il vise à faire tout ce que fait HomeBank, mais pensé pour le navigateur : un seul conteneur Docker que vous faites tourner vous-même, avec les données dans une base SQLite sur un volume que vous contrôlez.

**Essayez d’abord :** la [démo](https://p01--cloudbank--7dcjw6mlmtky.code.run/) est à un clic, sans inscription, avec une année de données inventées. Elle est effacée après deux heures sans utilisation : rien de ce que vous saisissez ne reste.

## Pourquoi

HomeBank est une excellente application de bureau, mais seulement de bureau. CloudBank apporte la même façon de travailler (des comptes, une liste complète des opérations, des opérations récurrentes, des budgets, des rapports détaillés et l’import depuis de nombreux formats, dont le fichier `.xhb` de HomeBank, en **lecture et en écriture**) dans une interface web accessible depuis n’importe quel appareil, pendant que les données restent sur votre serveur.

CloudBank est une **réimplémentation indépendante, en salle blanche**. Il ne copie ni n’utilise aucun code de HomeBank : de l’original, il ne regarde que le comportement documenté et les formats de fichier, et il suit les versions de HomeBank, actuelles comme futures. CloudBank est sous licence **AGPL-3.0** (HomeBank sous GPL-2+).

## Captures d’écran

|                 Vue d’ensemble                |          Opérations : actions sur plusieurs lignes sélectionnées          |
| :--------------------------------------: | :---------------------------------------------------------: |
| :[Vue d’ensemble](docs/img/dashboard.png)     | :[Actions sur plusieurs lignes dans les opérations](docs/img/register-bulk.png) |

|        Échéancier : les factures du mois dans le calendrier        |        À vérifier : doublons possibles de la connexion bancaire        |
| :------------------------------------------------------: | :---------------------------------------------------------: |
| :[Calendrier des opérations récurrentes](docs/img/schedules.png)  | :[À vérifier](docs/img/review.png)                           |

|      Budget : prévu et dépensé, la réponse d’abord      |      Catégories : chaque liste se modifie dans un panneau latéral      |
| :--------------------------------------------------------: | :----------------------------------------------------------: |
| :[Budget](docs/img/budget.png)                              | :[Catégories](docs/img/categories.png)                         |

|                 Rapports interactifs                  |            Apparence : thème, couleur, barre latérale            |
| :-------------------------------------------------: | :------------------------------------------------: |
| :[Rapports](docs/img/reports.png)                     | :[Paramètres](docs/img/settings.png)             |

|            Une vue d’ensemble à disposer librement             |    Import et export : `.xhb` de HomeBank, sauvegarde et restauration    |
| :------------------------------------------------------: | :------------------------------------------------: |
| :[Personnaliser la vue d’ensemble](docs/img/dashboard-customize.png) | :[Export](docs/img/export.png)             |

<sub>Les captures montrent les données inventées de la démo, en anglais.</sub>

## Fonctions

- **Comptes et opérations :** tous les types de compte de HomeBank, chacun dans sa devise, avec le solde actuel et le solde prévisionnel. Les opérations se marquent pointées et rapprochées, avec ventilations, étiquettes et virements ; la liste des opérations a des filtres, des colonnes au choix, des actions sur plusieurs lignes, la recherche et le rapprochement avec le relevé.
- **Opérations récurrentes et calendrier :** ce qui revient régulièrement se saisit tout seul, jusqu’à trois mois à l’avance si vous voulez. Un calendrier montre les échéances du mois avec leur état, ce qui reste à payer et ce qui vous attend ; les modèles et les règles d’affectation remplissent le reste.
- **Budget et rapports :** où est allé l’argent, ce qui est entré et sorti, ce que les comptes contiennent et contiendront, ce que coûte une voiture ; par mois, trimestre ou année, avec des vues enregistrées et des téléchargements en CSV et PNG.
- **Objectifs d’épargne et véhicules :** combien vous avez mis de côté, combien mettre de côté chaque mois pour arriver à temps, et ce qui reste disponible ; pour chaque véhicule, le carburant, les kilomètres, le coût au kilomètre et la consommation.
- **Import et export :** `.xhb` de HomeBank, QIF, OFX/QFX, CSV et CAMT.053 (ISO 20022) en entrée, avec un assistant ; `.xhb`, QIF et CSV en sortie ; sauvegarde et restauration du classeur.
- **Connexion bancaire :** les nouvelles opérations arrivent de la banque, passent par vos règles et se fusionnent avec celles qui existent au lieu d’apparaître en double. Avec vos propres identifiants, via [SimpleFIN](https://www.simplefin.org/), [Enable Banking](https://enablebanking.com/) (UE et Royaume-Uni) et, à titre expérimental, [Pluggy](https://pluggy.ai/) (Amérique latine).
- **Plusieurs devises et utilisateurs :** taux manuels ou en ligne (BCE), plusieurs utilisateurs gérés par l’administrateur, classeurs partagés ; l’application est en anglais et en italien, et en allemand et en français (bêta).
- **Une vue d’ensemble sur mesure :** en haut, ce qui vous attend, en dessous des widgets que vous placez et redimensionnez comme vous voulez, thème clair et sombre dans votre couleur préférée, barre latérale et navigation à réorganiser.
- **Sécurité :** authentification à deux facteurs, connexion par SSO (OIDC), jetons d’API révocables et secrets chiffrés dans la base de données.
- **Application installable :** CloudBank s’installe sur téléphone ou ordinateur comme une application, avec des notifications push pour les échéances, et signale quand une nouvelle version est disponible.
- **IA facultative, avec votre propre clé :** suggestions de catégorie et opérations dictées avec vos mots (« café 3,50 hier »).

## Démarrage rapide

<!-- quick-start -->

Il vous faut [Docker](https://docs.docker.com/get-docker/) avec le plugin Compose.
Créez un `docker-compose.yml` (ou copiez [celui du dépôt](docker-compose.yml)) :

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main # latest stable release (see tags below)
    container_name: cloudbank
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Set to "false" only for a plain-HTTP LAN install without TLS in front.
      CB_SECURE_COOKIES: "false"
    volumes:
      - cloudbank-data:/data

volumes:
  cloudbank-data:
```

Puis démarrez-le et ouvrez l’application :

```bash
docker compose up -d
# open http://localhost:8080 and complete the first-run admin setup
```

C’est toute l’installation : un conteneur, aucune base de données externe. Les données
sont dans le volume `cloudbank-data` (une base SQLite sous `/data`). Pour
sauvegarder, copiez ce volume, ou utilisez la **sauvegarde du classeur** dans
l’application (Paramètres › Import et export) et la **sauvegarde complète** de
l’administrateur : [docs/backup.md](docs/backup.md) explique ce que contient chacune et
comment la restaurer.

Ensuite, suivez [Getting started](docs/getting-started.md) : l’administrateur, un
classeur, les comptes et les catégories, les premières opérations.

Vous le placez derrière HTTPS (recommandé pour tout ce qui dépasse un réseau
domestique de confiance) ? Voir [docs/reverse-proxy.md](docs/reverse-proxy.md). Vous venez
de HomeBank sur ordinateur ? Voir [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).

<!-- /quick-start -->

## Le reste, en anglais

La configuration (les variables `CB_*`), les images de conteneur et le sens des tags, l’installation comme application et tous les guides se trouvent dans le [README anglais](README.md) et dans [docs/](docs/README.md). Attention aux tags : `:main` est la dernière version stable, `:latest` la version nocturne.

## Licence

CloudBank est sous **GNU Affero General Public License v3.0** : voir [LICENSE](LICENSE). Si vous faites tourner une version modifiée comme service en réseau, l’AGPL vous demande d’en proposer le code source à ses utilisateurs.

## Soutenir le projet

CloudBank est un projet open source fait avec passion. S’il vous est utile,
pensez à faire un don : cela aide vraiment et c’est très apprécié. ♥
Le plus simple est [**Buy Me a Coffee**](https://buymeacoffee.com/easly1989).
Si vous préférez un autre moyen, la
[page des dons](https://easly1989.github.io/donate.html) les liste tous :
[PayPal](https://paypal.me/carloruggiero),
[Stripe](https://buy.stripe.com/8x26oAeqA7h6dPk80hfbq00),
[Liberapay](https://liberapay.com/amon2126/donate) ou
[GitHub Sponsors](https://github.com/sponsors/easly1989).

---

<sub>Aligné sur le README de la v3.8.0.</sub>
