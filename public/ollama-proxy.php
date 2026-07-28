<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Called directly: POST /ollama-proxy.php  (body forwarded as-is)
$baseUrl  = getenv('OLLAMA_BASE_URL') ?: 'https://ollama.com';
$apiPath  = '/v1/chat/completions';
$target   = $baseUrl . $apiPath;

$serverKey = getenv('OLLAMA_API_KEY');
$authHeader = $serverKey ? 'Bearer ' . $serverKey : ($_SERVER['HTTP_AUTHORIZATION'] ?? '');

$body = file_get_contents('php://input');

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        $authHeader ? "Authorization: $authHeader" : '',
    ],
    CURLOPT_TIMEOUT => 120,
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
