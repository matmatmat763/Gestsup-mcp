<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_state.php
# @Description : Change l'état d'un ticket (résoudre, rejeter, etc. — l'état est
#                un id choisi dans la liste DE L'INSTANCE). Réplique core/ticket.php :
#                thread type 5 (changement d'état) ou type 4 (clôture) + date_res,
#                puis NOTIFICATION NATIVE. Aucun état codé en dur côté plugin :
#                seul l'id 3 (= "résolu") est la convention interne de GestSup,
#                répliquée à l'identique du contrôleur.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

// Convention interne de GestSup (core/ticket.php) : l'état "résolu" porte l'id 3.
// On RÉPLIQUE la règle du contrôleur, on ne l'invente pas.
define('GS_STATE_RESOLVED', 3);

// --- Paramètres
$ticket_id = mcp_post_int('ticket_id');
$state_id  = mcp_post_int('state_id');
$text      = isset($_POST['text']) ? (string) $_POST['text'] : '';
$private   = !empty($_POST['private']) ? 1 : 0;
$time      = mcp_post_int('time'); if ($time === null) { $time = 0; }
$notify    = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

if (!$ticket_id) { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }
if ($state_id === null) { mcp_deny('Paramètre state_id manquant.', '400 Bad Request'); }

// --- L'état doit exister dans l'instance (liste vivante, pas de valeur en dur)
$qry = $db->prepare("SELECT `id`,`name` FROM `tstates` WHERE `id`=:id");
$qry->execute(array('id' => $state_id));
$state = $qry->fetch();
$qry->closeCursor();
if (!$state) { mcp_deny("state_id $state_id inconnu dans cette instance.", '400 Bad Request'); }

// --- Ticket courant
$qry = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id AND `disable`=0");
$qry->execute(array('id' => $ticket_id));
$globalrow = $qry->fetch();
$qry->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }

$old_state    = (int) $globalrow['state'];
$new_state    = (int) $state_id;
$is_resolve   = ($new_state === GS_STATE_RESOLVED && $old_state !== GS_STATE_RESOLVED);
$leave_resolve = ($old_state === GS_STATE_RESOLVED && $new_state !== GS_STATE_RESOLVED);
$datetime     = date('Y-m-d H:i:s');

// Texte sécurisé (cohérent API native)
$text_secure = $text !== '' ? htmlspecialchars($text, ENT_QUOTES, 'UTF-8') : '';

try {
    $db->beginTransaction();

    // 1) Commentaire de résolution optionnel (réplique l'insert commentaire)
    if ($text_secure !== '') {
        $q = $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`private`,`time`) VALUES (:ticket,:date,:author,:text,'0',:private,:time)");
        $q->execute(array('ticket' => $ticket_id, 'date' => $datetime, 'author' => $_SESSION['user_id'], 'text' => $text_secure, 'private' => $private, 'time' => $time));
        if ($globalrow['technician'] == $_SESSION['user_id']) {
            $db->prepare("UPDATE `tincidents` SET `userread`='0' WHERE `id`=:id")->execute(array('id' => $ticket_id));
        }
    }

    // 2) Historique du changement d'état (réplique core/ticket.php)
    if ($new_state !== $old_state) {
        if ($is_resolve) {
            // clôture : thread type 4 (réplique l.850-857)
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`) VALUES (:ticket,:date,:author,'4')")
               ->execute(array('ticket' => $ticket_id, 'date' => $datetime, 'author' => $_SESSION['user_id']));
        } else {
            // changement d'état : thread type 5 (réplique l.428-436)
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`,`state`) VALUES (:ticket,:date,:author,'5',:state)")
               ->execute(array('ticket' => $ticket_id, 'date' => $datetime, 'author' => $_SESSION['user_id'], 'state' => $new_state));
        }
    }

    // 3) date_res (réplique l.492-495)
    $date_res = $globalrow['date_res'];
    if ($is_resolve)        { $date_res = $datetime; }
    elseif ($leave_resolve) { $date_res = '0000-00-00 00:00:00'; }

    // 4) Mise à jour du ticket
    $db->prepare("UPDATE `tincidents` SET `state`=:state, `date_res`=:date_res, `date_modif`=:date_modif WHERE `id`=:id")
       ->execute(array('state' => $new_state, 'date_res' => $date_res, 'date_modif' => $datetime, 'id' => $ticket_id));

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_deny('Erreur base de données : ' . $e->getMessage(), '500 Internal Server Error');
}

// --- Notification native (modify/close selon l'état, géré par auto_mail.php)
$mail_status = 'skipped';
if ($notify) {
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'resolution' => $text_secure,
        'private'    => $private,
        'modify'     => '1',
        'send'       => '1',
        'state'      => $new_state,
        'close'      => $is_resolve ? '1' : '',
        'technician' => $globalrow['technician'],
    ));
}

mcp_ok(array(
    'code'        => 0,
    'type'        => 'success',
    'action'      => 'TicketState',
    'ticket_id'   => (string) $ticket_id,
    'old_state'   => (string) $old_state,
    'new_state'   => (string) $new_state,
    'state_name'  => $state['name'],
    'resolved'    => $is_resolve,
    'comment'     => $text_secure !== '' ? 'added' : 'none',
    'notified'    => (bool) $notify,
    'mail'        => $mail_status,
));
?>
