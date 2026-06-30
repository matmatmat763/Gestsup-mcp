-- ============================================================================
-- Jeu de données VOLUMINEUX pour une démo réaliste :
--   - 5 techniciens (Paul, Lea déjà créés + Lucas, Sophie, Karim)
--   - 200 demandeurs
--   - quelques référentiels (lieux, groupes, catégories, sous-catégories)
--   - 5000 tickets variés (type, état, priorité, criticité, lieu, dates)
--   - commentaires (type 0) et résolutions (type 4) cohérents
--
-- Généré via le moteur SEQUENCE de MariaDB (seq_1_to_N) — rapide, pas de boucle.
-- (Mot de passe de tous les comptes : "admin".)
--
-- NB : les scripts d'init ne s'exécutent QUE sur une base vierge. Pour rejouer
--      ce seed : `docker compose down -v` puis `docker compose up -d --build`.
-- ============================================================================
SET SESSION sql_mode='';
-- Empêche la fusion des sous-requêtes pour que chaque RAND() soit évalué une
-- seule fois par ligne (sinon les colonnes dérivées seraient incohérentes).
SET SESSION optimizer_switch='derived_merge=off';

-- --- Référentiels : lieux (multi-site) --------------------------------------
INSERT INTO `tplaces` (`id`,`name`) VALUES
(1,'Site Lyon'),(2,'Site Paris'),(3,'Site Marseille'),(4,'Site Lille'),(5,'Site Toulouse');

-- --- Référentiels : groupes de techniciens ----------------------------------
INSERT INTO `tgroups` (`id`,`name`,`type`,`service`,`disable`) VALUES
(1,'Support N1',1,0,0),(2,'Support N2',1,0,0);

-- --- Référentiels : catégories (ids 3..7 ; 0/1/2 réservés par le socle) ------
INSERT INTO `tcategory` (`id`,`number`,`name`,`service`,`technician`,`technician_group`,`type`) VALUES
(3,3,'Materiel',0,0,0,0),(4,4,'Reseau',0,0,0,0),(5,5,'Logiciel',0,0,0,0),
(6,6,'Comptes et acces',0,0,0,0),(7,7,'Telephonie',0,0,0,0);

-- --- Référentiels : sous-catégories (id = categorie*10 + n) ------------------
INSERT INTO `tsubcat` (`id`,`cat`,`name`,`technician`,`technician_group`) VALUES
(31,3,'Imprimante',0,0),(32,3,'Poste fixe',0,0),(33,3,'Peripherique',0,0),
(41,4,'Wifi',0,0),(42,4,'VPN',0,0),(43,4,'Partage reseau',0,0),
(51,5,'Bureautique',0,0),(52,5,'Logiciel metier',0,0),(53,5,'Mise a jour',0,0),
(61,6,'Mot de passe',0,0),(62,6,'Creation de compte',0,0),(63,6,'Droits',0,0),
(71,7,'Telephone IP',0,0),(72,7,'Messagerie vocale',0,0),(73,7,'Standard',0,0);

-- --- 3 techniciens supplémentaires (total 5 avec Paul=10, Lea=11) -----------
INSERT INTO `tusers` (`id`,`login`,`password`,`salt`,`firstname`,`lastname`,`profile`,`mail`,`phone`,`disable`,`language`) VALUES
(12,'lucas','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Lucas','Moreau',4,'lucas@demo.local','0102030407',0,'fr_FR'),
(13,'sophie','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Sophie','Bernard',4,'sophie@demo.local','0102030408',0,'fr_FR'),
(14,'karim','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Karim','Haddad',4,'karim@demo.local','0102030409',0,'fr_FR');

-- --- 200 demandeurs (profil 2), ids 1001..1200 ------------------------------
INSERT INTO `tusers` (`id`,`login`,`password`,`salt`,`firstname`,`lastname`,`profile`,`mail`,`phone`,`disable`,`language`)
SELECT
  1000+seq,
  CONCAT('user',seq),
  '$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt',
  ELT(1+MOD(seq,10),'Alex','Camille','Dominique','Emma','Hugo','Ines','Louis','Nora','Sam','Yanis'),
  ELT(1+MOD(seq*7,12),'Petit','Roux','Faure','Blanc','Garcia','Lopez','Henry','Girard','Lefevre','Mercier','Dupont','Marchand'),
  2,
  CONCAT('user',seq,'@demo.local'),
  CONCAT('06',LPAD(seq,8,'0')),
  0,'fr_FR'
FROM seq_1_to_200;

-- --- 5000 tickets -----------------------------------------------------------
INSERT INTO `tincidents`
  (`user`,`type`,`technician`,`title`,`description`,`date_create`,`date_modif`,`date_res`,
   `state`,`category`,`subcat`,`priority`,`criticality`,`place`,`time`,`time_hope`,`creator`,`billable`,`disable`)
SELECT
  r.uid,
  r.ttype,
  CASE WHEN r.state = 5 THEN 0 ELSE ELT(r.rtech+1, 10, 11, 12, 13, 14) END,
  CONCAT(
    ELT(r.subj,
      'Imprimante en panne','Ecran noir au demarrage','Wifi instable','Messagerie inaccessible',
      'Telephone IP muet','Acces VPN a creer','Reinitialisation mot de passe','Installation logiciel metier',
      'Poste tres lent','Partage reseau inaccessible','Badge acces defectueux','Mise a jour bloquee'),
    ' (', ELT(r.place,'Lyon','Paris','Marseille','Lille','Toulouse'), ')'),
  ELT(r.subj,
    'Bourrage papier recurrent et plus de toner.','Le PC ne demarre plus depuis ce matin.',
    'Coupures wifi pendant les visios.','Outlook ne se connecte plus au serveur.',
    'Pas de son sur le telephone du poste.','Nouveau collaborateur, besoin acces VPN.',
    'Mot de passe oublie pour le compte AD.','Besoin dinstaller le logiciel metier.',
    'Lenteurs importantes au quotidien.','Le lecteur reseau napparait plus.',
    'Le badge ne deverrouille plus la porte.','La mise a jour reste bloquee a mi-parcours.'),
  r.dc,
  r.dm,
  CASE WHEN r.state IN (3,4) THEN r.dm ELSE '0000-00-00 00:00:00' END,
  r.state, r.cat, r.cat*10 + r.sub, r.prio, r.crit, r.place,
  CASE WHEN r.state IN (3,4) THEN r.ttime ELSE 0 END,
  r.thope, 1, 0, 0
FROM (
  SELECT
    base.*,
    CASE
      WHEN base.rs < 20 THEN 5   -- Non attribué
      WHEN base.rs < 45 THEN 1   -- Attente PEC
      WHEN base.rs < 70 THEN 2   -- En cours
      WHEN base.rs < 90 THEN 3   -- Résolu
      WHEN base.rs < 96 THEN 6   -- Attente retour
      ELSE 4                     -- Rejeté
    END AS state,
    base.dc + INTERVAL base.dmoff MINUTE AS dm
  FROM (
    SELECT
      1000 + FLOOR(1+RAND()*200) AS uid,
      1 + FLOOR(RAND()*2)        AS ttype,
      FLOOR(RAND()*100)          AS rs,
      FLOOR(RAND()*5)            AS rtech,
      3 + FLOOR(RAND()*5)        AS cat,
      1 + FLOOR(RAND()*3)        AS sub,
      1 + FLOOR(RAND()*6)        AS prio,
      1 + FLOOR(RAND()*4)        AS crit,
      1 + FLOOR(RAND()*5)        AS place,
      1 + FLOOR(RAND()*12)       AS subj,
      NOW() - INTERVAL FLOOR(RAND()*365) DAY - INTERVAL FLOOR(RAND()*86400) SECOND AS dc,
      FLOOR(RAND()*180)          AS ttime,
      FLOOR(RAND()*240)          AS thope,
      FLOOR(RAND()*4320)         AS dmoff
    FROM seq_1_to_5000
  ) base
) r;

-- --- Commentaires (type 0) sur ~60% des tickets générés ---------------------
INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`state`,`private`,`time`)
SELECT
  id,
  date_create + INTERVAL FLOOR(RAND()*240) MINUTE,
  IF(technician > 0, technician, user),
  ELT(1+FLOOR(RAND()*5),
    'Intervention planifiee.',
    'Pris en charge, diagnostic en cours.',
    'Information complementaire demandee au demandeur.',
    'En attente dune piece detachee.',
    'Probleme reproduit lors du test.'),
  0, state, 0, 0
FROM `tincidents`
WHERE id > 8 AND RAND() < 0.6;

-- --- Résolutions (type 4) pour les tickets résolus / rejetés ----------------
INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`state`,`private`,`time`)
SELECT
  id,
  IF(date_res = '0000-00-00 00:00:00', date_modif, date_res),
  IF(technician > 0, technician, 10),
  ELT(1+FLOOR(RAND()*5),
    'Remplacement du materiel defectueux, test OK.',
    'Redemarrage du service et verification, retabli.',
    'Compte recree et droits reappliques.',
    'Mise a jour appliquee, incident cloture.',
    'Configuration corrigee, validee avec le demandeur.'),
  4, state, 0, FLOOR(RAND()*60)
FROM `tincidents`
WHERE id > 8 AND state IN (3,4);

-- Rétablit le comportement par défaut de l'optimiseur.
SET SESSION optimizer_switch='derived_merge=on';
