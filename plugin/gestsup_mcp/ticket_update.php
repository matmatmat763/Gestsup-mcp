<?php
################################################################################
# @Name : plugins/gestsup_mcp/ticket_update.php
# @Description : Met à jour des champs "simples" d'un ticket (catégorie,
#                sous-catégorie, priorité, criticité, type, temps passé/prévu).
#                Ces champs n'ont pas d'historique dédié dans GestSup : un seul
#                UPDATE + date_modif, puis NOTIFICATION NATIVE (selon paramètres).
#                Chaque valeur est VALIDÉE contre la liste vivante de l'instance.
# @Method : POST
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/write_init.php');
$root = realpath(__DIR__ . '/../../');

$ticket_id = mcp_post_int('ticket_id');
$notify    = array_key_exists('notify', $_POST) ? !empty($_POST['notify']) : true;
if (!$ticket_id) { mcp_deny('Paramètre ticket_id manquant.', '400 Bad Request'); }

// --- Ticket courant
$q = $db->prepare("SELECT * FROM `tincidents` WHERE `id`=:id AND `disable`=0");
$q->execute(array('id' => $ticket_id)); $globalrow = $q->fetch(); $q->closeCursor();
if (!$globalrow) { mcp_deny('Ticket ' . $ticket_id . ' introuvable.', '404 Not Found'); }

/** Valide qu'un id existe dans une table de référence de l'instance. */
function mcp_ref_exists($db, $table, $id) {
    $q = $db->prepare("SELECT 1 FROM `$table` WHERE `id`=:id");
    $q->execute(array('id' => $id));
    $ok = (bool) $q->fetchColumn();
    $q->closeCursor();
    return $ok;
}

// Champs modifiables : param => [colonne, table de validation | null si entier libre]
$editable = array(
    'category'    => array('category',    'tcategory'),
    'subcat'      => array('subcat',      'tsubcat'),
    'priority'    => array('priority',    'tpriority'),
    'criticality' => array('criticality', 'tcriticality'),
    'type'        => array('type',        'ttypes'),
    'place'       => array('place',       'tplaces'),   // lieu (multi-site)
    'time'        => array('time',        null),       // temps passé (minutes)
    'time_hope'   => array('time_hope',   null),       // temps prévu (minutes)
);

$updates = array();
$bind = array();
$changed = array();

foreach ($editable as $param => $def) {
    $val = mcp_post_int($param);
    if ($val === null) { continue; }
    list($column, $table) = $def;
    if ($table !== null && !mcp_ref_exists($db, $table, $val)) {
        mcp_deny("Valeur $param=$val inconnue dans l'instance (référentiel $table).", '400 Bad Request');
    }
    $updates[] = "`$column`=:$param";
    $bind[$param] = $val;
    $changed[$column] = $val;
}

if (empty($updates)) {
    mcp_deny('Aucun champ à mettre à jour (category, subcat, priority, criticality, type, time, time_hope).', '400 Bad Request');
}

$datetime = date('Y-m-d H:i:s');
$updates[] = "`date_modif`=:date_modif";
$bind['date_modif'] = $datetime;
$bind['id'] = $ticket_id;

try {
    $db->beginTransaction();
    $sql = "UPDATE `tincidents` SET " . implode(', ', $updates) . " WHERE `id`=:id AND `disable`=0";
    $db->prepare($sql)->execute($bind);
    $db->commit();
} catch (\Throwable $e) {
    if ($db->inTransaction()) { $db->rollBack(); }
    mcp_db_error($e);
}

// --- Notification native (modification, selon paramètres)
$mail_status = 'skipped';
if ($notify) {
    $mail_status = mcp_native_notify($root, $db, $rparameters, $globalrow, $ruser, array(
        'modify'     => '1',
        'send'       => '1',
        'technician' => $globalrow['technician'],
        'state'      => $globalrow['state'],
    ));
}

mcp_ok(array(
    'code'      => 0,
    'type'      => 'success',
    'action'    => 'TicketUpdate',
    'ticket_id' => (string) $ticket_id,
    'updated'   => $changed,
    'notified'  => (bool) $notify,
    'mail'      => $mail_status,
));
?>
