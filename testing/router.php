<?php
// Unified router for local PHP dev: serves hub, myHealth, and myMoney.
// - /           -> hub/index.html
// - /myhealth/* -> myHealth/web/* (API routed to index.php)
// - /mymoney/*  -> myMoney/web/*  (API routed to index.php)

$root = dirname(__DIR__);
$hubRoot = $root . '/hub';
$healthRoot = $root . '/myHealth/web';
$moneyRoot = $root . '/myMoney/web';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '/';

// API routing first
if (strpos($uri, '/myhealth/api/files') === 0) {
    require $healthRoot . '/api/files/index.php';
    return;
}
if (strpos($uri, '/mymoney/api/files') === 0) {
    require $moneyRoot . '/api/files/index.php';
    return;
}

function try_serve(string $file): bool {
    if (!is_file($file)) return false;
    $mime = function_exists('mime_content_type') ? mime_content_type($file) : null;
    if ($mime) {
        header('Content-Type: ' . $mime);
    }
    readfile($file);
    return true;
}

// Helper to resolve and serve static assets inside app roots
function serve_from_app(string $appRoot, string $uri, string $base): bool {
    $rel = substr($uri, strlen($base));
    if ($rel === '' || $rel === false || $rel === null) $rel = '/';
    if ($rel === '/' || $rel === '') $rel = '/index.html';
    $path = realpath($appRoot . $rel);
    if (!$path || strpos($path, realpath($appRoot)) !== 0) {
        return try_serve($appRoot . '/index.html');
    }
    if (is_file($path)) {
        return try_serve($path);
    }
    return try_serve($appRoot . '/index.html');
}

if (strpos($uri, '/myhealth') === 0) {
    if (serve_from_app($healthRoot, $uri, '/myhealth')) return;
}
if (strpos($uri, '/mymoney') === 0) {
    if (serve_from_app($moneyRoot, $uri, '/mymoney')) return;
}

// Default to hub
if ($uri !== '/' && try_serve($hubRoot . $uri)) {
    return;
}
try_serve($hubRoot . '/index.html');
