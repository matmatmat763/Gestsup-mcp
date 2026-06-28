<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_close.php
# @Description : Clôture CONFORME d'un ticket : exige la CAUSE (ajoutée à la fin
#                de la description du ticket) et la PROCÉDURE de résolution
#                (procédure GestSup et/ou texte libre). Réplique la résolution
#                native (commentaire + thread de clôture type 4 + date_res), puis
#                NOTIFICATION NATIVE de clôture. Refuse la clôture non conforme.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

// Convention interne de GestSup : état id 3 = "résolu".
define('GS_STATE_RESOLVED', 3);

$ticket_id      = mcp_post_int('ticket_id');
$cause          = isset($_POST['cause']) ? trim((string) $_POST['cause']) : '';
$procedure_id   = mcp_post_int('procedure_id');
$procedure_text = isset($_POST['procedure_text']) ? trim((string) $_POST['procedure_text']) : '';
$resolution     = isset($_POST['resolution']) ? trim((string) $_POST['resolution']) : '';
$time           = mcp_post_int('time'); if ($time === null) { $time = 0; }
$notify         = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

if (!$ticket_id) { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }

// --- Garde-fou de conformité
$has_procedure = (($procedure_id !== null && $procedure_id > 0) || $procedure_text !== '');
if ($cause === '') {
    mcp_deny('Clôture non conforme : la CAUSE de résolution est requise.', '400 Bad Request');
}
if (!$has_procedure) {
    mcp_deny('Clôture non conforme : indiquer une PROCÉDURE (procedure_id et/ou procedure_text).', '400 Bad Request');
}

// --- Ticket courant
$q = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id AND `disable`=0");
$q->execute(array('id' => $ticket_id)); $globalrow = $q->fetch(); $q->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }
if ((int) $globalrow['state'] === GS_STATE_RESOLVED) {
    mcp_deny('Ticket ' . $ticket_id . ' déjà résolu.', '400 Bad Request');
}

// --- Procédure GestSup (optionnelle) : validation + récupération du nom
$procedure_name = '';
if ($procedure_id !== null && $procedure_id > 0) {
    $q = $db->prepare("SELECT `name` FROM `tprocedures` WHERE `id`=:id AND `disable`=0");
    $q->execute(array('id' => $procedure_id)); $proc = $q->fetch(); $q->closeCursor();
    if (!$proc) { mcp_deny("procedure_id $procedure_id inconnue dans l'instance.", '400 Bad Request'); }
    $procedure_name = $proc['name'];
}

$datetime = date('Y-m-d H:i:s');

// --- Construction du commentaire de résolution (résolution + procédure)
$parts = array();
if ($resolution !== '') { $parts[] = htmlspecialchars($resolution, ENT_QUOTES, 'UTF-8'); }
$proc_block = array();
if ($procedure_name !== '') { $proc_block[] = '<b>Procédure appliquée :</b> ' . htmlspecialchars($procedure_name, ENT_QUOTES, 'UTF-8'); }
if ($procedure_text !== '') { $proc_block[] = '<b>Procédure :</b> ' . htmlspecialchars($procedure_text, ENT_QUOTES, 'UTF-8'); }
if ($proc_block) { $parts[] = implode('<br>', $proc_block); }
$comment = implode('<br><br>', $parts);

// --- Cause ajoutée à la TOUTE FIN de la description (préférence demandée)
$cause_block = '<br><br><b>Cause de résolution :</b><br>' . htmlspecialchars($cause, ENT_QUOTES, 'UTF-8');
$new_description = (string) $globalrow['description'] . $cause_block;

try {
    $db->beginTransaction();

    // 1) Description = description + cause (en fin)
    $db->prepare("UPDATE `tincidents` SET `description`=:d WHERE `id`=:id")
       ->execute(array('d' => $new_description, 'id' => $ticket_id));

    // 2) Commentaire de résolution (type 0)
    if ($comment !== '') {
        $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`private`,`time`) VALUES (:t,:d,:a,:text,'0','0',:time)")
           ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'text' => $comment, 'time' => $time));
        if ($globalrow['technician'] == $_SESSION['user_id']) {
            $db->prepare("UPDATE `tincidents` SET `userread`='0' WHERE `id`=:id")->execute(array('id' => $ticket_id));
        }
    }

    // 3) Thread de clôture (type 4) — réplique core/ticket.php
    $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`) VALUES (:t,:d,:a,'4')")
       ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id']));

    // 4) État résolu + date_res
    $db->prepare("UPDATE `tincidents` SET `state`=:state, `date_res`=:dr, `date_modif`=:dm WHERE `id`=:id")
       ->execute(array('state' => GS_STATE_RESOLVED, 'dr' => $datetime, 'dm' => $datetime, 'id' => $ticket_id));

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_deny('Erreur base de données : ' . $e->getMessage(), '500 Internal Server Error');
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
    'code'            => 0,
    'type'            => 'success',
    'action'          => 'TicketClose',
    'ticket_id'       => (string) $ticket_id,
    'resolved'        => true,
    'cause_appended'  => true,
    'procedure'       => $procedure_name !== '' ? $procedure_name : ($procedure_text !== '' ? '(texte)' : ''),
    'notified'        => (bool) $notify,
    'mail'            => $mail_status,
));
?>
