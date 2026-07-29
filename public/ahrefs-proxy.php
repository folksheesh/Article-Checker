<?php
// ISI API KEY AHRFFS KAMU DI SINI (hapus tanda // di depan define):
// define('AHREFS_API_KEY', 'isi-api-key-kamu-disini');
// Kalau tidak diisi, proxy coba ambil dari Authorization header frontend.

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Endpoint: /ahrefs-proxy.php?endpoint=overview&keywords=...&country=id&select=...
// Endpoint: /ahrefs-proxy.php?endpoint=related-terms&keywords=...&country=id&select=...
$endpoint   = $_GET['endpoint'] ?? 'overview';
$baseUrl    = 'https://api.ahrefs.com/v3';
$allowed    = ['overview', 'related-terms', 'matching-terms', 'search-suggestions'];
$apiPath    = in_array($endpoint, $allowed) ? "/keywords-explorer/$endpoint" : '/keywords-explorer/overview';
$queryStr   = $_SERVER['QUERY_STRING'] ?? '';
// Remove 'endpoint' param from forwarded query string
$queryStr   = preg_replace('/(^|&)endpoint=[^&]*/', '', $queryStr);
$target     = $baseUrl . $apiPath . ($queryStr ? '?' . $queryStr : '');

// Auth: hardcoded > client header > env var
$authHeader = defined('AHREFS_API_KEY') ? 'Bearer ' . AHREFS_API_KEY : '';
if (!$authHeader) {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
}
if (!$authHeader) {
    $serverKey = getenv('AHREFS_API_KEY');
    if ($serverKey) $authHeader = 'Bearer ' . $serverKey;
}

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => array_filter([
        'Content-Type: application/json',
        $authHeader ? "Authorization: $authHeader" : '',
    ]),
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => true,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error    = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Proxy error: ' . $error]);
    exit;
}

http_response_code($httpCode);
echo $response;
