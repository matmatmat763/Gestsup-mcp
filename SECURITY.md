# Politique de sécurité

## Modèle de confiance (à lire avant déploiement)

Ce système comporte trois éléments : le **serveur MCP**, le **plugin GestSup**,
et un **vault Obsidian** (optionnel).

### La clé d'API GestSup est un secret de haute valeur

Le plugin reprend le **modèle de l'API native** de GestSup : la **clé d'API**
est le rempart principal. Quiconque possède la clé peut lire et écrire via les
endpoints du plugin, dans les limites ci-dessous. **Traitez la clé comme un
secret critique** :

- ne la committez jamais (utilisez des variables d'environnement / un coffre) ;
- restreignez l'accès réseau au plugin (HTTPS obligatoire, **liste blanche
  d'IP** côté GestSup) ;
- effectuez une **rotation** régulière.

### Attribution des écritures (`author_id`)

Chaque écriture est attribuée à un `author_id`. Garde-fous en place :

1. Côté **serveur MCP**, `author_id` est **figé** sur `GESTSUP_DEFAULT_USER_ID`
   (non exposé comme paramètre d'outil) : un utilisateur du MCP ne peut pas
   choisir une autre identité.
2. Côté **plugin**, `author_id` doit correspondre à un compte **non désactivé**
   **et disposant du droit technicien** (`trights.ticket_tech`). Une écriture
   ne peut donc pas être attribuée à un compte arbitraire.

> Limite assumée : un appelant qui détient la clé d'API **et** contourne le
> serveur MCP (appel direct du plugin) peut toujours choisir n'importe quel
> `author_id` **technicien**. C'est cohérent avec le modèle de l'API native
> (clé = confiance serveur-à-serveur). Pour un cloisonnement plus fin, dédiez
> une clé d'API et un compte technicien au MCP.

### Kill-switches

- `GESTSUP_ALLOW_WRITES=false` : le serveur MCP refuse toute écriture GestSup.
- `OBSIDIAN_ALLOW_WRITES=false` : le vault est en lecture seule.

### TLS

`GESTSUP_INSECURE_TLS` (désactivation de la vérification du certificat) est
**refusé pour un hôte public** et réservé au test local (localhost / IP privée /
`.local`). Ne jamais l'activer en production.

### Vault Obsidian

- Tous les chemins sont confinés dans la racine du vault (**anti
  path-traversal** : `..` et chemins absolus refusés).
- Les écrasements sont **explicites** (`create` échoue si la note existe).
- L'accès se fait par fichiers ; pour un partage réseau, montez-le sur la
  machine du MCP (aucun secret SMB n'est stocké par le serveur).

### Contenu non fiable (prompt-injection)

Les descriptions de tickets et les notes du vault sont du **texte non fiable**
ingéré par le LLM. Appliquez des garde-fous côté agent (validation humaine des
actions sensibles) ; ne faites pas exécuter aveuglément des instructions
trouvées dans un ticket ou une note.

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique pour une faille de sécurité.
Contactez le mainteneur en privé (e-mail du dépôt) avec une description et,
si possible, une preuve de concept. Un accusé de réception est visé sous 72 h.
