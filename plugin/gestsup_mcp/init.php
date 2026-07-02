<?php
################################################################################
# @Name : plugins/gestsup_mcp/init.php
# @Description : Authentification partagée des endpoints du plugin gestsup_mcp.
#                Reproduit la sécurité de api/v1/init.php (clé API, IP, HTTPS)
#                et vérifie en plus que le plugin est activé.
# @Author : gestsup-mcp
# @Version : 1.0
################################################################################

header('Content-Type: application/json; charset=utf-8');

// Connexion DB + fonctions (chemins relatifs à plugins/gestsup_mcp/)
require_once(__DIR__ . '/../../connect.php');
require_once(__DIR__ . '/../../core/functions.php');

// Tolérance valeurs vides (comme l'API native)
$db->exec('SET sql_mode = ""');

$request_method = $_SERVER['REQUEST_METHOD'];

/** Renvoie une erreur JSON normalisée et stoppe l'exécution. */
function mcp_deny($message, $http = '403 Forbidden')
{
    LogIt('API_error', 'gestsup_mcp : ' . $message, 0);
    header('HTTP/1.1 ' . $http);
    echo json_encode(
        array('code' => 1, 'type' => 'error', 'message' => $message),
        JSON_PRETTY_PRINT
    );
    exit;
}

// --- Paramètres API (partagés avec l'API native) ---------------------------
$qry = $db->prepare('SELECT `api`,`api_key`,`api_client_ip`,`server_url` FROM `tparameters`');
$qry->execute();
$parameters = $qry->fetch();
$qry->closeCursor();

// --- Plugin activé ? -------------------------------------------------------
$qry = $db->prepare("SELECT `enable` FROM `tplugins` WHERE `name`='gestsup_mcp'");
$qry->execute();
$plugin = $qry->fetch();
$qry->closeCursor();
if (empty($plugin) || $plugin['enable'] != 1) {
    mcp_deny('Plugin gestsup_mcp désactivé (activez-le dans Administration > Paramètres > Plugins).');
}

// --- API activée ? ---------------------------------------------------------
if (!$parameters['api']) {
    mcp_deny('API disabled in application');
}

// --- Récupération de la clé (X-API-KEY ou Basic) ---------------------------
if (isset($_SERVER['HTTP_X_API_KEY'])) {
    $api_key = $_SERVER['HTTP_X_API_KEY'];
} else {
    $headers = function_exists('apache_request_headers') ? apache_request_headers() : array();
    if (!empty($headers['Authorization'])) {
        $parts = explode('Basic ', $headers['Authorization']);
        $api_key = isset($parts[1]) ? base64_decode($parts[1]) : '';
    } else {
        mcp_deny('Unable to get API Key, add X-API-KEY header');
    }
}

if (!$parameters['api_key']) {
    mcp_deny('API key not defined in application');
}

// --- Liste blanche d'IP (regex, comme l'API native) ------------------------
if ($parameters['api_client_ip']) {
    $valid_ip = 0;
    foreach (explode(',', $parameters['api_client_ip']) as $ip) {
        $ip = trim($ip);
        // Ancrage strict (^...$) : une entrée « 10.0.0.1 » ne doit PAS matcher
        // « 110.0.0.12 » (l'API native, non ancrée, le permettait par erreur).
        if ($ip !== '' && preg_match('/^(' . $ip . ')$/', $_SERVER['REMOTE_ADDR'])) {
            $valid_ip = 1;
        }
    }
    if (!$valid_ip) {
        mcp_deny('Unauthorized IP (' . $_SERVER['REMOTE_ADDR'] . ') in application');
    }
}

if (empty($api_key)) {
    mcp_deny('Missing API key parameter');
}

// Comparaison clé (avec tolérance de préfixe, comme l'API native).
// hash_equals : temps constant et comparaison strictement binaire (pas de
// juggling numérique PHP sur des clés de la forme "0e123...").
if (!hash_equals((string) $parameters['api_key'], (string) $api_key)) {
    if (!hash_equals((string) $parameters['api_key'], (string) substr($api_key, 1))) {
        mcp_deny('Wrong API Key');
    }
}

// --- HTTPS obligatoire ------------------------------------------------------
if ($_SERVER['SERVER_PORT'] != '443') {
    mcp_deny('Unauthorized access port, use 443. (' . $_SERVER['SERVER_PORT'] . ')');
}
?>
