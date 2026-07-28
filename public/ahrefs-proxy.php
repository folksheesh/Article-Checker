<?php
// Optional: hardcode API key here if Authorization header doesn't pass through.
// Uncomment and set your key:  define('AHREFS_API_KEY', 'your-key-here');
// Otherwise, the key comes from the frontend (set via VITE_AHREFS_API_KEY at build time).

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$apiPath   = '/keywords-explorer/keywords-overview';
$baseUrl   = 'https://api.ahrefs.com/v3';
$queryStr  = $_SERVER['QUERY_STRING'] ?? '';
$target    = $baseUrl . $apiPath . ($queryStr ? '?' . $queryStr : '');

$authHeader = '';
// 1. Hardcoded config (most reliable)
if (defined('AHREFS_API_KEY')) {
    $authHeader = 'Bearer ' . AHREFS_API_KEY;
}
// 2. Client Authorization header (sent by built frontend)
if (!$authHeader) {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
}
// 3. Server environment variable (e.g. set in php-fpm pool)
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
