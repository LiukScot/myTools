<?php
// Simple router for PHP built-in server to support /api/files/* without .htaccess.
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$filePath = __DIR__ . '/../web' . $uri;

// Serve existing files directly
if ($uri && $uri !== '/' && file_exists($filePath) && is_file($filePath)) {
    return false;
}

// Route API requests
if (strpos($uri, '/api/files') === 0) {
    require __DIR__ . '/../web/api/files/index.php';
    return;
}

// Fallback to SPA entry
require __DIR__ . '/../web/index.html';
