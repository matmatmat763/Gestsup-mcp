<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_create.php
# @Description : Création COMPLÈTE d'un ticket (demandeur, catégorie, sous-cat,
#                priorité, criticité, type, titre, description, temps passé/prévu,
#                technicien/groupe, lieu, échéance). Réplique l'INSERT natif de
#                core/ticket.php puis NOTIFICATION NATIVE (nouveau ticket).
#                Toutes les valeurs de liste sont validées contre l'instance.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 1.0
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

$title       = isset($_POST['title']) ? trim((string) $_POST['title']) : '';
$description = isset($_POST['description']) ? trim((string) $_POST['description']) : '';
$notify      = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;

if ($title === '')       { mcp_deny('Paramètre title manquant.', '400 Bad Request'); }
if ($description === '') { mcp_deny('Paramètre description manquant.', '400 Bad Request'); }

/** Valide un id contre une table de référence (si fourni). */
function mcp_check_ref($db, $table, $id, $label) {
    $q = $db->prepare("SELECT 1 FROM `$table` WHERE `id`=:id");
    $q->execute(array('id' => $id));
    $ok = (bool) $q->fetchColumn();
    $q->closeCursor();
    if (!$ok) { mcp_deny("$label=$id inconnu dans l'instance.", '400 Bad Request'); }
}

// --- Champs de liste (validés s'ils sont fournis)
$type        = mcp_post_int('type');        if ($type !== null)        { mcp_check_ref($db, 'ttypes', $type, 'type'); }        else { $type = 0; }
$category    = mcp_post_int('category');     if ($category !== null)    { mcp_check_ref($db, 'tcategory', $category, 'category'); } else { $category = 0; }
$subcat      = mcp_post_int('subcat');       if ($subcat !== null)      { mcp_check_ref($db, 'tsubcat', $subcat, 'subcat'); }     else { $subcat = 0; }
$priority    = mcp_post_int('priority');     if ($priority !== null)    { mcp_check_ref($db, 'tpriority', $priority, 'priority'); } else { $priority = 0; }
$criticality = mcp_post_int('criticality');  if ($criticality !== null) { mcp_check_ref($db, 'tcriticality', $criticality, 'criticality'); } else { $criticality = 0; }
$place       = mcp_post_int('place');        if ($place !== null)       { mcp_check_ref($db, 'tplaces', $place, 'place'); }       else { $place = 0; }
$technician  = mcp_post_int('technician_id'); if ($technician !== null && $technician > 0) { mcp_check_ref($db, 'tusers', $technician, 'technician_id'); } else { $technician = 0; }
$t_group     = mcp_post_int('group_id');     if ($t_group !== null && $t_group > 0)        { mcp_check_ref($db, 'tgroups', $t_group, 'group_id'); }       else { $t_group = 0; }

$time      = mcp_post_int('time');      if ($time === null)      { $time = 0; }
$time_hope = mcp_post_int('time_hope'); if ($time_hope === null) { $time_hope = 0; }

// --- Demandeur : requester_id prioritaire, sinon requester_email, sinon 0
$user = 0;
$requester_id = mcp_post_int('requester_id');
if ($requester_id !== null && $requester_id > 0) {
    mcp_check_ref($db, 'tusers', $requester_id, 'requester_id');
    $user = $requester_id;
} elseif (!empty($_POST['requester_email'])) {
    $q = $db->prepare("SELECT `id` FROM `tusers` WHERE `mail`=:mail AND `disable`=0");
    $q->execute(array('mail' => $_POST['requester_email']));
    $row = $q->fetch(); $q->closeCursor();
    $user = $row ? (int) $row['id'] : 0;
}

// --- État : fourni (validé) sinon défaut de l'instance (ticket_default_state)
$state = mcp_post_int('state');
if ($state !== null) {
    mcp_check_ref($db, 'tstates', $state, 'state');
} else {
    $state = (int) $rparameters['ticket_default_state'];
    if ($state <= 0) { $state = 5; }
}

// --- Échéance optionnelle
$date_hope = (!empty($_POST['date_hope']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_POST['date_hope']))
    ? $_POST['date_hope'] : '0000-00-00';

// --- Champs obligatoires : on REPRODUIT les obligations définies dans GestSup
// (droits ticket_*_mandatory du profil du technicien), comme le contrôleur natif.
$qry = $db->prepare("SELECT * FROM `trights` WHERE `profile`=:p");
$qry->execute(array('p' => $author['profile']));
$rright = $qry->fetch();
$qry->closeCursor();
if ($rright) {
    $req = function ($k) use ($rright) { return !empty($rright[$k]); };
    $missing = array();
    if ($req('ticket_title_mandatory') && $title === '') { $missing[] = 'title'; }
    if ($req('ticket_description_mandatory') && $description === '') { $missing[] = 'description'; }
    if ($req('ticket_type_mandatory') && $rparameters['ticket_type'] && !$type) { $missing[] = 'type'; }
    if ($req('ticket_cat_mandatory') && (!$category || !$subcat)) { $missing[] = 'category+subcat'; }
    if ($req('ticket_priority_mandatory') && !$priority) { $missing[] = 'priority'; }
    if ($req('ticket_criticality_mandatory') && !$criticality) { $missing[] = 'criticality'; }
    if ($req('ticket_place_mandatory') && $rparameters['ticket_places'] && !$place) { $missing[] = 'place'; }
    if ($req('ticket_user_mandatory') && !$user) { $missing[] = 'requester'; }
    if ($missing) {
        mcp_deny('Champs obligatoires manquants (selon la configuration GestSup) : ' . implode(', ', $missing) . '.', '400 Bad Request');
    }
}

$title_secure       = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
$description_secure = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');
$datetime = date('Y-m-d H:i:s');

try {
    $db->beginTransaction();
    $qry = $db->prepare("INSERT INTO `tincidents`
        (`user`,`type`,`type_answer`,`technician`,`t_group`,`title`,`description`,`date_create`,`date_modif`,`date_hope`,`priority`,`criticality`,`billable`,`state`,`creator`,`time`,`time_hope`,`category`,`subcat`,`techread`,`techread_date`,`userread`,`place`)
        VALUES
        (:user,:type,'0',:technician,:t_group,:title,:description,:date_create,:date_modif,:date_hope,:priority,:criticality,'0',:state,:creator,:time,:time_hope,:category,:subcat,'1',:techread_date,'1',:place)");
    $qry->execute(array(
        'user' => $user, 'type' => $type, 'technician' => $technician, 't_group' => $t_group,
        'title' => $title_secure, 'description' => $description_secure,
        'date_create' => $datetime, 'date_modif' => $datetime, 'date_hope' => $date_hope,
        'priority' => $priority, 'criticality' => $criticality, 'state' => $state,
        'creator' => $_SESSION['user_id'], 'time' => $time, 'time_hope' => $time_hope,
        'category' => $category, 'subcat' => $subcat, 'techread_date' => $datetime, 'place' => $place,
    ));
    $ticket_id = $db->lastInsertId();
    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_db_error($e);
}

// Recharge le ticket comme $globalrow pour la notification
$q = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id");
$q->execute(array('id' => $ticket_id)); $globalrow = $q->fetch(); $q->closeCursor();

// --- Notification native "nouveau ticket"
$mail_status = 'skipped';
if ($notify) {
    $_GET['action'] = 'new';
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'modify'     => '1',
        'send'       => '1',
        'state'      => $state,
        'technician' => $technician,
        'title'      => $title_secure,
    ));
}

$ticket_url = rtrim((string) $rparameters['server_url'], '/') . '/index.php?page=ticket&id=' . $ticket_id;
mcp_ok(array(
    'code'       => 0,
    'type'       => 'success',
    'action'     => 'TicketCreate',
    'message'    => 'Ticket ' . $ticket_id . ' créé',
    'ticket_id'  => (string) $ticket_id,
    'ticket_url' => $ticket_url,
    'user'       => (string) $user,
    'state'      => (string) $state,
    'notified'   => (bool) $notify,
    'mail'       => $mail_status,
));
?>
