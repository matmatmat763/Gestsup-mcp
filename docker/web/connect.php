<?php
################################################################################
# connect.php — pré-rempli pour le stack Docker de test (service "db").
################################################################################
$host='db';
$port='3306';
$db_name='gestsup';
$charset='utf8';
$user='gestsup';
$password='gestsup';

try {
    $db = new PDO(
        "mysql:host=$host;port=$port;dbname=$db_name;charset=$charset",
        "$user",
        "$password",
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION)
    );
} catch (Exception $e) {
    die('Error : ' . $e->getMessage());
}
?>
