# GestSup MCP

Documentation de l'**API REST de GestSup** et plan d'implémentation d'un
**serveur MCP** (Model Context Protocol) pour cette application de gestion de
tickets.

## Contenu

| Document | Description |
|---|---|
| [`docs/gestsup-api.md`](docs/gestsup-api.md) | **Documentation complète de l'API REST GestSup**, reconstruite à partir du code source (auth, endpoints, requêtes/réponses, pièges, modèle de données, exemples cURL). |
| [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md) | **Plan d'implémentation** d'un serveur MCP exposant l'API GestSup à un agent LLM (architecture, tools, sécurité, tests, feuille de route). |
| [`docs/reference/swagger-v1-3.2.55.json`](docs/reference/swagger-v1-3.2.55.json) | Le `swagger.json` d'origine de GestSup (fourni pour référence — **incomplet**, cf. la doc). |

## Contexte & provenance des données

- L'API officielle de GestSup est très peu documentée ; cette doc comble ce
  manque en s'appuyant directement sur le code.
- **Version analysée : GestSup 3.2.55.** La version 3.2.60 visée n'a pas pu
  être téléchargée (le domaine `gestsup.fr` est bloqué par la politique réseau
  de l'environnement de travail). Le code a donc été étudié depuis le mirroir
  public le plus récent,
  [`DeltaForce53/gestsup-3.2.55`](https://github.com/DeltaForce53/gestsup-3.2.55).
- L'API évolue très peu entre versions mineures : la doc est valable à ~99 %
  pour la 3.2.60. La section *« Écarts possibles 3.2.55 → 3.2.60 »* de la doc
  liste les points à revalider sur l'instance cible.

## En bref : ce que l'API GestSup permet (3.2.55)

**Fonctionnel** : créer un ticket · lire un ticket + son fil de résolution ·
ajouter un commentaire · lister les tickets d'un demandeur · lire une fiche
utilisateur · récupérer les référentiels (types / catégories / sous-catégories
/ lieux).

**Non disponible** (endpoints présents mais désactivés → HTTP 405) : modifier /
supprimer un ticket, gérer les utilisateurs. Pas de gestion des équipements via
l'API.

> ⚠️ Le `swagger.json` embarqué dans GestSup sous-documente fortement l'API
> (auth partielle, modèles de réponse vides, base path erroné, endpoints
> masqués). **Référez-vous à `docs/gestsup-api.md`.**
