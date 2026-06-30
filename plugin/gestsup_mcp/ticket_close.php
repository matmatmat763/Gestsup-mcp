<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_close.php
# @Description : Clôture CONFORME d'un ticket, selon son TYPE :
#                - INCIDENT  : cause ET résolution obligatoires ;
#                - DEMANDE   : résolution obligatoire (cause facultative).
#                La clôture est refusée si une obligation manque. La cause est
#                ajoutée à la fin de la description ; la résolution (+ procédure
#                éventuelle) est consignée. Réplique la résolution native
#                (commentaire + thread type 4 + date_res) puis notifie.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 1.0
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

// Convention interne de GestSup : état id 3 = "résolu".
define('GS_STATE_RESOLVED', 3);

$ticket_id      = mcp_post_int('ticket_id');
$cause          = isset($_POST['cause']) ? trim((string) $_POST['cause']) : '';
$resolution     = isset($_POST['resolution']) ? trim((string) $_POST['resolution']) : '';
$procedure_id   = mcp_post_int('procedure_id');
$procedure_text = isset($_POST['procedure_text']) ? trim((string) $_POST['procedure_text']) : '';
$time           = mcp_post_int('time'); if ($time === null) { $time = 0; }
$notify         = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

// Politique "incident" : ids de types fournis par l'appelant (config), sinon
// détection par le nom du type (repli). Override explicite possible via require_cause.
$require_cause_param = array_key_exists('require_cause', $_POST) && $_POST['require_cause'] !== ''
    ? !empty($_POST['require_cause']) : null;
$incident_type_ids = array();
if (!empty($_POST['incident_type_ids'])) {
    $incident_type_ids = array_values(array_filter(array_map('intval', explode(',', $_POST['incident_type_ids']))));
}

if (!$ticket_id) { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }

// --- Ticket courant + nom du type
$q = $db->prepare("SELECT i.*, ty.`name` AS type_name FROM `tincidents` i LEFT JOIN `ttypes` ty ON i.`type`=ty.`id` WHERE i.`id`=:id AND i.`disable`=0");
$q->execute(array('id' => $ticket_id)); $globalrow = $q->fetch(); $q->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }
if ((int) $globalrow['state'] === GS_STATE_RESOLVED) {
    mcp_deny('Ticket ' . $ticket_id . ' déjà résolu.', '400 Bad Request');
}

// --- La cause est-elle obligatoire ? (incident)
if ($require_cause_param !== null) {
    $require_cause = $require_cause_param;
} elseif ($incident_type_ids) {
    $require_cause = in_array((int) $globalrow['type'], $incident_type_ids, true);
} else {
    // Repli : type dont le nom contient "incident"
    $require_cause = (bool) preg_match('/incident/i', (string) $globalrow['type_name']);
}

// --- Garde-fou de conformité
if ($resolution === '') {
    mcp_deny('Clôture non conforme : la RÉSOLUTION (ce qui a permis de résoudre) est obligatoire.', '400 Bad Request');
}
if ($require_cause && $cause === '') {
    mcp_deny('Clôture non conforme : la CAUSE est obligatoire pour un incident.', '400 Bad Request');
}

// --- Procédure GestSup (optionnelle) : validation + nom
$procedure_name = '';
if ($procedure_id !== null && $procedure_id > 0) {
    $q = $db->prepare("SELECT `name` FROM `tprocedures` WHERE `id`=:id AND `disable`=0");
    $q->execute(array('id' => $procedure_id)); $proc = $q->fetch(); $q->closeCursor();
    if (!$proc) { mcp_deny("procedure_id $procedure_id inconnue dans l'instance.", '400 Bad Request'); }
    $procedure_name = $proc['name'];
}

$datetime = date('Y-m-d H:i:s');

// --- Commentaire de résolution (résolution + procédure éventuelle)
$parts = array(htmlspecialchars($resolution, ENT_QUOTES, 'UTF-8'));
$proc_block = array();
if ($procedure_name !== '') { $proc_block[] = '<b>Procédure appliquée :</b> ' . htmlspecialchars($procedure_name, ENT_QUOTES, 'UTF-8'); }
if ($procedure_text !== '') { $proc_block[] = '<b>Procédure :</b> ' . htmlspecialchars($procedure_text, ENT_QUOTES, 'UTF-8'); }
if ($proc_block) { $parts[] = implode('<br>', $proc_block); }
$comment = implode('<br><br>', $parts);

// --- Cause ajoutée à la TOUTE FIN de la description (si fournie)
$cause_appended = false;
$new_description = (string) $globalrow['description'];
if ($cause !== '') {
    $new_description .= '<br><br><b>Cause :</b><br>' . htmlspecialchars($cause, ENT_QUOTES, 'UTF-8');
    $cause_appended = true;
}

try {
    $db->beginTransaction();

    if ($cause_appended) {
        $db->prepare("UPDATE `tincidents` SET `description`=:d WHERE `id`=:id")
           ->execute(array('d' => $new_description, 'id' => $ticket_id));
    }

    // Commentaire de résolution (type 0)
    $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`private`,`time`) VALUES (:t,:d,:a,:text,'0','0',:time)")
       ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'text' => $comment, 'time' => $time));
    if ($globalrow['technician'] == $_SESSION['user_id']) {
        $db->prepare("UPDATE `tincidents` SET `userread`='0' WHERE `id`=:id")->execute(array('id' => $ticket_id));
    }

    // Thread de clôture (type 4)
    $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`) VALUES (:t,:d,:a,'4')")
       ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id']));

    // État résolu + date_res
    $db->prepare("UPDATE `tincidents` SET `state`=:state, `date_res`=:dr, `date_modif`=:dm WHERE `id`=:id")
       ->execute(array('state' => GS_STATE_RESOLVED, 'dr' => $datetime, 'dm' => $datetime, 'id' => $ticket_id));

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_db_error($e);
}

// --- Notification native de clôture
$mail_status = 'skipped';
if ($notify) {
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'resolution' => $comment,
        'private'    => '0',
        'modify'     => '1',
        'send'       => '1',
        'state'      => GS_STATE_RESOLVED,
        'close'      => '1',
        'technician' => $globalrow['technician'],
    ));
}

mcp_ok(array(
    'code'           => 0,
    'type'           => 'success',
    'action'         => 'TicketClose',
    'ticket_id'      => (string) $ticket_id,
    'ticket_type'    => $globalrow['type_name'],
    'cause_required' => (bool) $require_cause,
    'cause_appended' => $cause_appended,
    'resolved'       => true,
    'procedure'      => $procedure_name !== '' ? $procedure_name : ($procedure_text !== '' ? '(texte)' : ''),
    'notified'       => (bool) $notify,
    'mail'           => $mail_status,
));
?>
