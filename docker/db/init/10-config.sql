-- Active l'API GestSup et fixe une clé connue pour le test local.
SET SESSION sql_mode='';

UPDATE `tparameters` SET
  `api`            = 1,
  `api_key`        = 'TESTKEY_local_dev_0123456789abcdef',
  `api_client_ip`  = '',
  `server_url`     = 'https://localhost:8443'
WHERE `id` = 1;
