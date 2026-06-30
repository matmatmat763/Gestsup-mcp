SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";
SET default_storage_engine=INNODB;

INSERT INTO `tplugins` (`name`, `label`, `description`, `icon`, `version`) VALUES ('gestsup_mcp','MCP / API étendue','Ajoute des endpoints API (lecture + écriture) pour le serveur MCP : recherche de tickets, référentiels, commentaire/note, état, affectation, mise à jour, clôture conforme, création complète. Réutilise la clé API GestSup.','robot','1.0');
