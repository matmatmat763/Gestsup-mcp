# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [SemVer](https://semver.org/lang/fr/).

## [1.0.0] - 2026-06-30

Première version stable. Serveur MCP GestSup + plugin serveur + documentation
Obsidian.

### Ajouté

**Serveur MCP (TypeScript)** — 20 outils :
- Lecture : `gestsup_get_ticket`, `gestsup_find_tickets_by_user`, `gestsup_get_user`,
  `gestsup_search_tickets`, `gestsup_list_referential`.
- Écriture GestSup : `gestsup_create_ticket`, `gestsup_create_ticket_full`,
  `gestsup_add_ticket_comment`, `gestsup_set_ticket_state`, `gestsup_assign_ticket`,
  `gestsup_update_ticket`, `gestsup_close_ticket` (clôture conforme).
- Documentation : `gestsup_assess_ticket_quality`, `gestsup_suggest_documentation`,
  `gestsup_document_ticket`, `obsidian_list_notes`, `obsidian_search`,
  `obsidian_read_note`, `obsidian_write_note`, `obsidian_append_section`.

**Plugin serveur GestSup (PHP)** — 8 endpoints répliquant la logique native et
réutilisant le mailer natif (recherche, référentiels, commentaire, état,
affectation, mise à jour, clôture, création complète).

**Documentation Obsidian** : accès par fichiers (vault local ou partage réseau
SMB/NFS monté), frontmatter, recherche, détection de doublon par résolution,
proposition de documentation en fin de ticket.

**Outillage** : stack Docker de test, harnais d'intégration, documentation de
l'API native, runbook de maintenance, guides d'installation et de démarrage.

### Sécurité
- Écritures attribuées uniquement à un compte ayant le droit technicien
  (`ticket_tech`).
- Erreurs base de données génériques côté client (détail journalisé).
- Liste blanche d'IP ancrée (plus de match en sous-chaîne).
- `GESTSUP_INSECURE_TLS` refusé vers un hôte public (anti-MITM).
- Vault : anti path-traversal, écrasement explicite, kill-switch d'écriture.
- Voir [`SECURITY.md`](SECURITY.md) pour le modèle de confiance complet.

### Tests
- 81 tests unitaires (client, normalisation, vault, qualité, similarité, outils,
  configuration).

[1.0.0]: https://github.com/matmatmat763/gestsup-mcp/releases/tag/v1.0.0
