<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_assign.php
# @Description : Affecte un ticket à un technicien OU à un groupe de techniciens.
#                Réplique core/ticket.php : historique type 1 (attribution) ou
#                type 2 (transfert) selon la transition, bump d'état natif
#                "Non attribué" -> "Attente PEC", puis NOTIFICATION NATIVE
#                (mail_auto_tech_attribution) au nouveau technicien/groupe.
#                Technicien/groupe = ids de l'instance (jamais codés en dur).
# @Method : POST
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

// Convention interne GestSup : état id 5 = "Non attribué" (bump vers 1 à l'attribution).
define('GS_STATE_UNASSIGNED', 5);
define('GS_STATE_WAIT_PEC', 1);

$ticket_id      = mcp_post_int('ticket_id');
$technician_id  = mcp_post_int('technician_id');   // affecter à un technicien
$group_id       = mcp_post_int('group_id');        // OU à un groupe
$notify         = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

if (!$ticket_id) { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }
if (($technician_id === null || $technician_id <= 0) && ($group_id === null || $group_id <= 0)) {
    mcp_deny('Fournir technician_id OU group_id.', '400 Bad Request');
}

// --- Validation des cibles (listes vivantes de l'instance)
if ($technician_id) {
    $q = $db->prepare("SELECT `id` FROM `tusers` WHERE `id`=:id AND `disable`=0");
    $q->execute(array('id' => $technician_id)); $ok = $q->fetch(); $q->closeCursor();
    if (!$ok) { mcp_deny("technician_id $technician_id inconnu.", '400 Bad Request'); }
}
if ($group_id) {
    $q = $db->prepare("SELECT `id` FROM `tgroups` WHERE `id`=:id AND `disable`=0");
    $q->execute(array('id' => $group_id)); $ok = $q->fetch(); $q->closeCursor();
    if (!$ok) { mcp_deny("group_id $group_id inconnu.", '400 Bad Request'); }
}

// --- Ticket courant
$q = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id AND `disable`=0");
$q->execute(array('id' => $ticket_id)); $globalrow = $q->fetch(); $q->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }

$old_tech  = (int) $globalrow['technician'];
$old_group = (int) $globalrow['t_group'];
$old_state = (int) $globalrow['state'];
$datetime  = date('Y-m-d H:i:s');

// Cible : technicien prioritaire, sinon groupe
if ($technician_id) { $new_tech = (int) $technician_id; $new_group = 0; $assign_kind = 'technician'; }
else                { $new_tech = 0; $new_group = (int) $group_id; $assign_kind = 'group'; }

$thread_type = 'none';
$new_state   = $old_state;

try {
    $db->beginTransaction();

    // --- Historique attribution/transfert (réplique core/ticket.php l.376-424)
    if ($new_tech > 0) {
        if ($old_tech === 0 && $old_group === 0) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`,`tech1`) VALUES (:t,:d,:a,'1',:tech1)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'tech1' => $new_tech));
            $thread_type = 'attribution';
        } elseif ($old_tech !== 0 && $new_tech !== $old_tech) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`tech1`,`tech2`) VALUES (:t,:d,:a,'','2',:tech1,:tech2)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'tech1' => $old_tech, 'tech2' => $new_tech));
            $thread_type = 'transfert';
        } elseif ($old_group !== 0) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`group1`,`tech2`) VALUES (:t,:d,:a,'','2',:group1,:tech2)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'group1' => $old_group, 'tech2' => $new_tech));
            $thread_type = 'transfert';
        }
    } else { // groupe
        if ($old_group === 0 && $old_tech === 0) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`,`group1`) VALUES (:t,:d,:a,'1',:group1)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'group1' => $new_group));
            $thread_type = 'attribution';
        } elseif ($old_group !== 0 && $new_group !== $old_group && $old_tech === 0) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`group1`,`group2`) VALUES (:t,:d,:a,'','2',:group1,:group2)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'group1' => $old_group, 'group2' => $new_group));
            $thread_type = 'transfert';
        } elseif ($old_tech !== 0) {
            $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`text`,`type`,`tech1`,`group2`) VALUES (:t,:d,:a,'','2',:tech1,:group2)")
               ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 'tech1' => $old_tech, 'group2' => $new_group));
            $thread_type = 'transfert';
        }
    }

    // Bump natif "Non attribué" (5) -> "Attente PEC" (1) à l'attribution
    // (le contrôleur le fait pour une attribution technicien OU groupe)
    if ($thread_type !== 'none' && $old_state === GS_STATE_UNASSIGNED) {
        $new_state = GS_STATE_WAIT_PEC;
        $db->prepare("INSERT INTO `tthreads` (`ticket`,`date`,`author`,`type`,`state`) VALUES (:t,:d,:a,'5',:s)")
           ->execute(array('t' => $ticket_id, 'd' => $datetime, 'a' => $_SESSION['user_id'], 's' => $new_state));
    }

    // --- Mise à jour du ticket
    $db->prepare("UPDATE `tincidents` SET `technician`=:tech, `t_group`=:grp, `state`=:state, `date_modif`=:dm WHERE `id`=:id")
       ->execute(array('tech' => $new_tech, 'grp' => $new_group, 'state' => $new_state, 'dm' => $datetime, 'id' => $ticket_id));

    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_db_error($e);
}

// --- Notification native (attribution au nouveau technicien/groupe)
$mail_status = 'skipped';
if ($notify) {
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'modify'     => '1',
        'send'       => '1',
        'technician' => $new_tech,
        't_group'    => $new_group,
        'state'      => $new_state,
    ));
}

mcp_ok(array(
    'code'         => 0,
    'type'         => 'success',
    'action'       => 'TicketAssign',
    'ticket_id'    => (string) $ticket_id,
    'assigned_to'  => $assign_kind,
    'technician'   => (string) $new_tech,
    'group'        => (string) $new_group,
    'history'      => $thread_type,
    'new_state'    => (string) $new_state,
    'notified'     => (bool) $notify,
    'mail'         => $mail_status,
));
?>
