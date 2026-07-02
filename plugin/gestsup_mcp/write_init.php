<?php
################################################################################
# @Name : plugins/gestsup_mcp/write_init.php
# @Description : Socle commun aux endpoints d'ÉCRITURE du plugin.
#                Authentifie (via init.php), reconstitue le contexte "technicien"
#                attendu par la logique native de GestSup (session, paramètres),
#                pour pouvoir réutiliser core/auto_mail.php à l'identique.
# @Author : gestsup-mcp
# @Version : 1.0
################################################################################

// Authentification + $db + fonctions + plugin actif (mêmes contrôles que la lecture)
require(__DIR__ . '/init.php');

// Les écritures se font en POST uniquement
if ($request_method !== 'POST') {
    mcp_deny('Seule la méthode POST est autorisée.', '405 Method Not Allowed');
}

// Corps JSON accepté en plus du form-data
$__raw = file_get_contents('php://input');
if ($__raw) {
    $__json = json_decode($__raw, true);
    if (is_array($__json)) { $_POST = array_merge($_POST, $__json); }
}

/** Récupère un POST entier ou null. */
function mcp_post_int($name) {
    return isset($_POST[$name]) && is_numeric($_POST[$name]) ? intval($_POST[$name]) : null;
}

/** Réponse JSON de succès. */
function mcp_ok($data) {
    header('HTTP/1.1 200 OK');
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}

/**
 * Erreur base de données : journalise le détail (LogIt) mais ne renvoie au
 * client qu'un message générique (pas de fuite de schéma/SQL).
 */
function mcp_db_error($e) {
    LogIt('API_error', 'gestsup_mcp DB error : ' . $e->getMessage(), 0);
    mcp_deny('Erreur interne lors de l\'écriture en base.', '500 Internal Server Error');
}

// --- Identité de l'acteur (technicien) : author_id = GESTSUP_DEFAULT_USER_ID côté MCP
$author_id = mcp_post_int('author_id');
if (!$author_id) {
    mcp_deny('Paramètre author_id manquant ou invalide (identité du technicien).', '400 Bad Request');
}
$qry = $db->prepare("SELECT `id`,`profile`,`mail`,`firstname`,`lastname`,`language` FROM `tusers` WHERE `id`=:id AND `disable`=0");
$qry->execute(array('id' => $author_id));
$author = $qry->fetch();
$qry->closeCursor();
if (!$author) {
    mcp_deny('author_id introuvable ou désactivé.', '400 Bad Request');
}

/**
 * Vérifie qu'un utilisateur (actif) possède le droit technicien `ticket_tech`.
 * Renvoie true/false ; à utiliser pour l'auteur ET pour tout technicien cible
 * (création/affectation) afin de ne jamais désigner un non-technicien.
 */
function mcp_is_technician($db, $user_id) {
    $q = $db->prepare("SELECT r.`ticket_tech` FROM `tusers` u JOIN `trights` r ON r.`profile`=u.`profile` WHERE u.`id`=:id AND u.`disable`=0");
    $q->execute(array('id' => $user_id));
    $right = $q->fetch();
    $q->closeCursor();
    return !empty($right) && (int) $right['ticket_tech'] !== 0;
}

// --- Défense en profondeur : l'auteur DOIT être un technicien -----------------
// On n'attribue jamais une écriture à un utilisateur sans le droit `ticket_tech`
// (sinon, avec la clé API, on pourrait agir au nom de n'importe quel compte).
if (!mcp_is_technician($db, $author['id'])) {
    mcp_deny("author_id=$author_id n'a pas le droit technicien (ticket_tech) : écriture refusée.", '403 Forbidden');
}

// --- Paramètres complets (auto_mail.php en a besoin)
$qry = $db->query("SELECT * FROM `tparameters` WHERE `id`=1");
$rparameters = $qry->fetch();
$qry->closeCursor();

// --- Session simulée = le technicien (contexte exigé par core/auto_mail.php)
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }
$_SESSION['user_id'] = $author['id'];
$_SESSION['profile_id'] = $author['profile'];

// Utilisateur courant (utilisé par localization.php et en repli par auto_mail)
$ruser = array('mail' => $author['mail'], 'language' => $author['language']);

/**
 * Déclenche la notification native GestSup (core/auto_mail.php) avec le même
 * contexte que l'interface. À appeler APRÈS l'écriture, et seulement si le SMTP
 * est configuré (comme le fait core/ticket.php).
 * Renvoie un libellé d'état ('sent' / 'skipped: ...' / 'error: ...').
 */
function mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, $postOverrides) {
    // Garde identique à core/ticket.php : pas de SMTP => pas d'envoi
    if (!($rparameters['mail'] && $rparameters['mail_smtp'])) {
        return 'skipped: SMTP non configuré';
    }
    // Drapeaux d'action attendus par auto_mail.php
    foreach ($postOverrides as $k => $v) { $_POST[$k] = $v; }
    $_GET['id'] = $globalrow['id'];
    // Variables d'init attendues (présentes dans le contexte du contrôleur natif)
    $datetime = date('Y-m-d H:i:s');
    if (!isset($_POST['action'])) { $_POST['action'] = ''; }
    if (!isset($_GET['action'])) { $_GET['action'] = ''; }
    $t_group = isset($_POST['t_group']) ? $_POST['t_group'] : '';
    $autoclose = 0;
    $current_user_member_of_tech_group = false;
    $mail_u_group_members = false;
    $send = '';
    $usermail = array('mail' => '');

    // CWD = racine GestSup pour les includes relatifs (localization, ./core/mail.php, template/mail)
    $cwd = getcwd();
    chdir($root);
    // Dépendances natives : autoload (PHPMailer) + localisation/gettext (définit T_ et LOCALE_DIR)
    require_once($root . '/vendor/autoload.php');
    include_once($root . '/localization.php');
    if (!function_exists('T_')) { function T_($s) { return $s; } }
    ob_start();
    $status = 'sent';
    try {
        include('./core/auto_mail.php');
    } catch (\Throwable $e) {
        $status = 'error: ' . $e->getMessage();
    }
    ob_end_clean(); // avale la sortie du mailer (echo/debug), inutile en JSON
    chdir($cwd);
    return $status;
}
?>
