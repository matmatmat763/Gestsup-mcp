SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";
SET default_storage_engine=INNODB;

INSERT INTO `tplugins` (`name`, `label`, `description`, `icon`, `version`) VALUES ('gestsup_mcp','MCP / API étendue','Ajoute des endpoints API en lecture pour le serveur MCP (recherche de tickets, tickets par technicien). Réutilise la clé API GestSup.','robot','0.1');
