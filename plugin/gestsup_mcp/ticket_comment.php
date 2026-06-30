<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_comment.php
# @Description : Ajoute un commentaire (résolution) à un ticket, public ou
#                INTERNE (private). Réplique fidèlement core/ticket.php (insert
#                tthreads type 0 + date_modif + userread) et déclenche la
#                NOTIFICATION NATIVE (core/auto_mail.php) selon les paramètres
#                de l'application — exactement comme l'interface.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

// --- Paramètres
$ticket_id = mcp_post_int('ticket_id');
$text      = isset($_POST['text']) ? (string) $_POST['text'] : '';
$private   = !empty($_POST['private']) ? 1 : 0;
$time      = mcp_post_int('time'); if ($time === null) { $time = 0; }
// Notification : par défaut on notifie pour un commentaire public ; jamais pour une note interne.
$notify    = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

if (!$ticket_id)      { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }
if (trim($text) === '') { mcp_deny('Paramètre text manquant.', '400 Bad Request'); }

// Sécurisation du texte (cohérent avec l'API native)
$text_secure = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');

// --- Ticket courant ($globalrow), attendu par auto_mail.php
$qry = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id AND `disable`=0");
$qry->execute(array('id' => $ticket_id));
$globalrow = $qry->fetch();
$qry->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }

$datetime = date('Y-m-d H:i:s');

// --- Écriture (transaction) — réplique core/ticket.php (l.837-846)
try {
    $db->beginTransaction();

    $qry = $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`private`,`time`) VALUES (:ticket,:date,:author,:text,'0',:private,:time)");
    $qry->execute(array(
        'ticket'  => $ticket_id,
        'date'    => $datetime,
        'author'  => $_SESSION['user_id'],
        'text'    => $text_secure,
        'private' => $private,
        'time'    => $time,
    ));
    $thread_id = $db->lastInsertId();

    $db->prepare("UPDATE `tincidents` SET `date_modif`=:d WHERE `id`=:id")
       ->execute(array('d' => $datetime, 'id' => $ticket_id));

    // Marque "non lu" pour le demandeur quand le technicien du ticket commente
    if ($globalrow['technician'] == $_SESSION['user_id']) {
        $db->prepare("UPDATE `tincidents` SET `userread`='0' WHERE `id`=:id")
           ->execute(array('id' => $ticket_id));
    }

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_db_error($e);
}

// --- Notification native (jamais pour une note interne)
$mail_status = 'skipped: note interne';
if ($notify && !$private) {
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'resolution' => $text_secure,
        'private'    => 0,
        'modify'     => '1',
        'send'       => '1',
        'technician' => $globalrow['technician'],
        'state'      => $globalrow['state'],
    ));
}

mcp_ok(array(
    'code'      => 0,
    'type'      => 'success',
    'action'    => 'TicketComment',
    'ticket_id' => (string) $ticket_id,
    'thread_id' => (string) $thread_id,
    'private'   => $private,
    'time'      => $time,
    'notified'  => ($notify && !$private),
    'mail'      => $mail_status,
));
?>
