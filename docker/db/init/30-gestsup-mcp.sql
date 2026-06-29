-- Enregistre ET active le plugin gestsup_mcp dans le stack de test.
-- (Le dossier du plugin est copié dans la source par fetch-source.sh.)
SET SESSION sql_mode='';

INSERT INTO `tplugins` (`name`, `label`, `description`, `icon`, `version`, `enable`)
VALUES ('gestsup_mcp', 'MCP / API étendue',
        'Endpoints API (lecture + écriture) pour le serveur MCP GestSup.',
        'robot', '0.1', 1);

-- Active aussi l'envoi de mails interne pour démontrer les notifications.
-- (Pointez mail_smtp vers un collecteur SMTP si vous voulez capturer les mails.)
UPDATE `tparameters` SET `mail_auto`=1, `mail_auto_user_modify`=1,
       `mail_auto_user_newticket`=1, `mail_auto_tech_attribution`=1
WHERE `id`=1;
