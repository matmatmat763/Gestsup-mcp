-- Jeu de données d'exemple : techniciens, demandeurs, tickets, commentaires.
-- (Le mot de passe de tous ces comptes est "admin".)
SET SESSION sql_mode='';

-- Techniciens (profil 4 = admin, pour avoir tous les droits en démo)
INSERT INTO `tusers` (`id`,`login`,`password`,`salt`,`firstname`,`lastname`,`profile`,`mail`,`phone`,`disable`,`language`) VALUES
(10,'paul','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Paul','Technicien',4,'paul@demo.local','0102030405',0,'fr_FR'),
(11,'lea','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Lea','Support',4,'lea@demo.local','0102030406',0,'fr_FR');

-- Demandeurs (profil 2 = utilisateur)
INSERT INTO `tusers` (`id`,`login`,`password`,`salt`,`firstname`,`lastname`,`profile`,`mail`,`phone`,`disable`,`language`) VALUES
(20,'marie','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Marie','Martin',2,'marie@demo.local','0601020304',0,'fr_FR'),
(21,'jean','$2y$10$B1QeMLjUsMUyIL6uTGnpYOQoY.a9Sq.7/01y6DcxiVU/vbgS3Jbla','salt','Jean','Durand',2,'jean@demo.local','0601020305',0,'fr_FR');

-- Tickets (technician : 10=Paul, 11=Lea, 1=admin ; state : 1=Attente,2=En cours,3=Résolu ; type : 1=Demande,2=Incident)
INSERT INTO `tincidents`
  (`user`,`type`,`technician`,`title`,`description`,`date_create`,`date_modif`,`state`,`category`,`subcat`,`priority`,`criticality`,`disable`) VALUES
(20,2,10,'Imprimante HS etage 2','Bourrage papier recurrent et plus de toner.','2025-06-02 09:10:00','2025-06-02 09:10:00',2,1,1,2,2,0),
(21,1,10,'Demande acces VPN','Nouveau collaborateur, besoin acces VPN.','2025-06-03 11:00:00','2025-06-04 08:00:00',1,1,1,1,1,0),
(20,2,10,'Ecran noir au demarrage','Le PC ne demarre plus depuis ce matin.','2025-06-05 08:30:00','2025-06-06 14:00:00',3,1,1,3,2,0),
(21,2,11,'Wifi instable salle reunion','Coupures wifi pendant les visio.','2025-06-06 10:15:00','2025-06-06 16:20:00',2,1,1,2,2,0),
(20,1,11,'Installation logiciel comptable','Installer Sage sur le poste compta.','2025-06-07 09:45:00','2025-06-07 09:45:00',1,1,1,1,1,0),
(21,2,1,'Messagerie inaccessible','Outlook ne se connecte plus au serveur.','2025-06-08 07:50:00','2025-06-09 09:30:00',2,1,1,3,3,0),
(20,2,11,'Telephone IP muet','Pas de son sur le telephone du poste 12.','2025-06-09 13:20:00','2025-06-09 13:20:00',1,1,1,2,1,0),
(21,1,10,'Reset mot de passe','Mot de passe oublie pour le compte AD.','2025-06-10 08:05:00','2025-06-10 08:40:00',3,1,1,1,1,0);

-- Commentaires (threads) — type 0 = texte
INSERT INTO `tthreads` (`ticket`,`author`,`date`,`type`,`text`) VALUES
(1,10,'2025-06-02 09:30:00',0,'Intervention planifiee cet apres-midi, toner commande.'),
(1,20,'2025-06-02 10:00:00',0,'Merci, c est urgent.'),
(3,10,'2025-06-06 14:00:00',0,'Alimentation remplacee, ticket resolu.'),
(6,1,'2025-06-09 09:30:00',0,'Profil Outlook recree, en cours de verification.');
