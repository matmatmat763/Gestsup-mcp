<?php
################################################################################
# @Name : plugins/gestsup_mcp/referentials.php
# @Description : Endpoint LECTURE SEULE — listes de référence DÉFINIES PAR
#                L'INSTANCE (états, priorités, criticités, causes de résolution).
#                Aucune valeur n'est codée en dur : tout vient de la base.
# @Method : GET ; param `kind` = state | priority | criticality | cause
# @Auth : clé API GestSup (voir init.php)
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/init.php');

if ($request_method !== 'GET') {
    header('HTTP/1.1 405 Method Not Allowed');
    echo json_encode(array('code' => 1, 'type' => 'error', 'message' => 'Only GET is allowed'), JSON_PRETTY_PRINT);
    exit;
}

$kind = isset($_GET['kind']) ? $_GET['kind'] : '';
$items = array();

switch ($kind) {
    case 'state':
        $qry = $db->query("SELECT `id`,`number`,`name`,`meta`,`hide` FROM `tstates` ORDER BY `number`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array(
                'id' => $r['id'], 'name' => $r['name'],
                'number' => $r['number'], 'meta' => $r['meta'], 'hidden' => $r['hide'],
            );
        }
        break;
    case 'priority':
        $qry = $db->query("SELECT `id`,`number`,`name`,`color` FROM `tpriority` WHERE `id`!=0 ORDER BY `number`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name'], 'number' => $r['number'], 'color' => $r['color']);
        }
        break;
    case 'criticality':
        $qry = $db->query("SELECT `id`,`number`,`name`,`color` FROM `tcriticality` WHERE `id`!=0 ORDER BY `number`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name'], 'number' => $r['number'], 'color' => $r['color']);
        }
        break;
    case 'cause':
        $qry = $db->query("SELECT `id`,`name` FROM `ttypes_answer` WHERE `disable`=0 ORDER BY `name`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name']);
        }
        break;
    case 'group':
        // Groupes de techniciens définis par l'instance
        $qry = $db->query("SELECT `id`,`name`,`type` FROM `tgroups` WHERE `disable`=0 ORDER BY `name`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name'], 'type' => $r['type']);
        }
        break;
    case 'procedure':
        // Procédures (base de connaissances) définies par l'instance
        $where = "`disable`=0";
        $params = array();
        if (isset($_GET['category']) && is_numeric($_GET['category'])) {
            $where .= " AND `category`=:cat"; $params['cat'] = intval($_GET['category']);
        }
        $qry = $db->prepare("SELECT `id`,`name`,`category`,`subcat` FROM `tprocedures` WHERE $where ORDER BY `name`");
        $qry->execute($params);
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name'], 'category' => $r['category'], 'subcat' => $r['subcat']);
        }
        break;
    case 'technician':
        // Utilisateurs autorisés à être techniciens (droit ticket_tech), selon l'instance
        $qry = $db->query("SELECT `tusers`.`id`, TRIM(CONCAT(COALESCE(`tusers`.`firstname`,''),' ',COALESCE(`tusers`.`lastname`,''))) AS `name`, `tusers`.`mail`
                           FROM `tusers` JOIN `trights` ON `tusers`.`profile`=`trights`.`profile`
                           WHERE `trights`.`ticket_tech`!=0 AND `tusers`.`disable`=0 AND `tusers`.`id`!=0
                           ORDER BY `name`");
        foreach ($qry->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $items[] = array('id' => $r['id'], 'name' => $r['name'], 'mail' => $r['mail']);
        }
        break;
    default:
        header('HTTP/1.1 400 Bad Request');
        echo json_encode(array('code' => 1, 'type' => 'error', 'message' => "Paramètre kind invalide (state|priority|criticality|cause|group|technician|procedure)"), JSON_PRETTY_PRINT);
        exit;
}

header('HTTP/1.1 200 OK');
echo json_encode(array(
    'code' => 0, 'type' => 'success', 'action' => 'Referential',
    'kind' => $kind, 'count' => count($items), 'items' => $items,
), JSON_PRETTY_PRINT);
?>
