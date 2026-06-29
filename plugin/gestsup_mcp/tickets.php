<?php
################################################################################
# @Name : plugins/gestsup_mcp/tickets.php
# @Description : Endpoint LECTURE SEULE — recherche/liste de tickets avec
#                filtres (technicien, état, catégorie, sous-catégorie, dates,
#                mots-clés), tri et pagination. Comble le manque de l'API native
#                (qui ne sait lister que par demandeur).
# @Method : GET
# @Auth : clé API GestSup (X-API-KEY ou Basic) — voir init.php
# @Author : gestsup-mcp
# @Version : 0.1
################################################################################

require(__DIR__ . '/init.php');

if ($request_method !== 'GET') {
    header('HTTP/1.1 405 Method Not Allowed');
    echo json_encode(
        array('code' => 1, 'type' => 'error', 'message' => 'Only GET is allowed'),
        JSON_PRETTY_PRINT
    );
    exit;
}

// --- Lecture et validation des filtres -------------------------------------
$where = array('i.disable = 0');
$bind = array();

function mcp_int($name)
{
    return isset($_GET[$name]) && is_numeric($_GET[$name]) ? intval($_GET[$name]) : null;
}

$technician = mcp_int('technician');
if ($technician !== null) { $where[] = 'i.technician = :technician'; $bind['technician'] = $technician; }

$state = mcp_int('state');
if ($state !== null) { $where[] = 'i.state = :state'; $bind['state'] = $state; }

$category = mcp_int('category');
if ($category !== null) { $where[] = 'i.category = :category'; $bind['category'] = $category; }

$subcat = mcp_int('subcat');
if ($subcat !== null) { $where[] = 'i.subcat = :subcat'; $bind['subcat'] = $subcat; }

$user = mcp_int('user');
if ($user !== null) { $where[] = 'i.user = :user'; $bind['user'] = $user; }

$technician_group = mcp_int('technician_group');
if ($technician_group !== null) { $where[] = 'i.t_group = :tgroup'; $bind['tgroup'] = $technician_group; }

$type = mcp_int('type');
if ($type !== null) { $where[] = 'i.type = :type'; $bind['type'] = $type; }

// Lieu (multi-site) : filtre sur tincidents.place
$place = mcp_int('place');
if ($place !== null) { $where[] = 'i.place = :place'; $bind['place'] = $place; }

// Plage de dates sur date_create (format YYYY-MM-DD)
if (!empty($_GET['date_from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date_from'])) {
    $where[] = 'i.date_create >= :date_from';
    $bind['date_from'] = $_GET['date_from'] . ' 00:00:00';
}
if (!empty($_GET['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['date_to'])) {
    $where[] = 'i.date_create <= :date_to';
    $bind['date_to'] = $_GET['date_to'] . ' 23:59:59';
}

// Recherche plein-texte simple sur titre/description
if (!empty($_GET['keywords'])) {
    $where[] = '(i.title LIKE :kw OR i.description LIKE :kw)';
    $bind['kw'] = '%' . $_GET['keywords'] . '%';
}

// Exclusion d'états (ex. masquer les tickets résolus pour "mes tickets ouverts").
// Les ids viennent de l'appelant (référentiel d'états de l'instance) : rien en dur.
if (!empty($_GET['exclude_states'])) {
    $ex = array_values(array_filter(array_map('intval', explode(',', $_GET['exclude_states']))));
    if ($ex) {
        $ph = array();
        foreach ($ex as $idx => $sid) { $key = 'exst' . $idx; $ph[] = ':' . $key; $bind[$key] = $sid; }
        $where[] = 'i.state NOT IN (' . implode(',', $ph) . ')';
    }
}

// Tri (liste blanche stricte — pas d'injection possible)
$order_whitelist = array(
    'id' => 'i.id',
    'date_create' => 'i.date_create',
    'date_modif' => 'i.date_modif',
    'state' => 'i.state',
    'priority' => 'i.priority',
);
$order_key = isset($_GET['order']) && isset($order_whitelist[$_GET['order']]) ? $_GET['order'] : 'date_create';
$order_col = $order_whitelist[$order_key];
$sort = (isset($_GET['sort']) && strtoupper($_GET['sort']) === 'ASC') ? 'ASC' : 'DESC';

// Pagination (offset = décalage de lignes réel, contrairement à l'API native)
$limit = mcp_int('limit');
if ($limit === null || $limit <= 0) { $limit = 50; }
if ($limit > 200) { $limit = 200; }
$offset = mcp_int('offset');
if ($offset === null || $offset < 0) { $offset = 0; }

$where_sql = implode(' AND ', $where);

// --- Comptage total --------------------------------------------------------
$count_sql = "SELECT COUNT(*) FROM tincidents i WHERE $where_sql";
$qry = $db->prepare($count_sql);
$qry->execute($bind);
$total = (int) $qry->fetchColumn();
$qry->closeCursor();

// --- Requête principale ----------------------------------------------------
$sql = "
    SELECT
        i.id, i.title, i.state, s.name AS state_name,
        i.type, ty.name AS type_name,
        i.category, i.subcat,
        i.place, pl.name AS place_name,
        i.technician, TRIM(CONCAT(COALESCE(t.firstname,''),' ',COALESCE(t.lastname,''))) AS technician_name,
        i.user, TRIM(CONCAT(COALESCE(u.firstname,''),' ',COALESCE(u.lastname,''))) AS requester_name,
        i.date_create, i.date_modif, i.priority, i.criticality
    FROM tincidents i
    LEFT JOIN tstates s ON i.state = s.id
    LEFT JOIN ttypes ty ON i.type = ty.id
    LEFT JOIN tplaces pl ON i.place = pl.id
    LEFT JOIN tusers t ON i.technician = t.id
    LEFT JOIN tusers u ON i.user = u.id
    WHERE $where_sql
    ORDER BY $order_col $sort
    LIMIT " . intval($limit) . " OFFSET " . intval($offset) . "
";
$qry = $db->prepare($sql);
$qry->execute($bind);

$tickets = array();
while ($row = $qry->fetch(PDO::FETCH_ASSOC)) {
    $tickets[] = array(
        'ticket_id' => $row['id'],
        'title' => $row['title'],
        'state_id' => $row['state'],
        'state_name' => $row['state_name'],
        'type_id' => $row['type'],
        'type_name' => $row['type_name'],
        'category_id' => $row['category'],
        'subcat_id' => $row['subcat'],
        'place_id' => $row['place'],
        'place_name' => $row['place_name'],
        'technician_id' => $row['technician'],
        'technician_name' => $row['technician_name'],
        'user_id' => $row['user'],
        'requester_name' => $row['requester_name'],
        'date_create' => $row['date_create'],
        'date_modif' => $row['date_modif'],
        'priority' => $row['priority'],
        'criticality' => $row['criticality'],
    );
}
$qry->closeCursor();

LogIt('API', 'gestsup_mcp/tickets : ' . count($tickets) . '/' . $total . ' ticket(s) listé(s)', 0);

header('HTTP/1.1 200 OK');
echo json_encode(
    array(
        'code' => 0,
        'type' => 'success',
        'action' => 'TicketList',
        'count' => count($tickets),
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'tickets' => $tickets,
    ),
    JSON_PRETTY_PRINT
);
?>
