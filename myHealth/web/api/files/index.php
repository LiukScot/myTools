<?php
// Tiny JSON file API for Hetzner Webhosting (PHP + MySQL) with simple login.
// Drop this file (and the .htaccess in the same folder) into public_html/myhealth/api/files/
// Then point your frontend requests to /api/files/...

// ---- DB credentials are provided via environment (.env file or hosting panel) ----
$_ENV_PATHS_LOADED = [];
function load_env_files(array $paths)
{
    global $_ENV_PATHS_LOADED;
    foreach ($paths as $path) {
        if (!is_file($path))
            continue;
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (preg_match('/^\s*#/', $line))
                continue;
            if (strpos($line, '=') === false)
                continue;
            [$key, $val] = explode('=', $line, 2);
            $key = trim($key);
            if (stripos($key, 'export ') === 0) {
                $key = trim(substr($key, 7));
            }
            $val = trim($val);
            $val = trim($val, "\"'");
            if ($key === '')
                continue;
            if (function_exists('putenv')) {
                @putenv("$key=$val");
            }
            $_ENV[$key] = $val;
            $_SERVER[$key] = $val;
        }
        $_ENV_PATHS_LOADED[] = $path;
    }
}

// Session login only; users are pre-created by you.
$ALLOW_SIGNUP = false; // leave false to block self-registration
$FILES_TABLE = 'files';
$USER_SETTINGS_TABLE = 'user_settings';
// ---- No edits needed below unless you want to customize behavior ----

$isSecure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';

// Keep session files outside the webroot (one level above /web)
$sessDir = dirname(__DIR__, 3) . '/sessions';
if (!is_dir($sessDir)) {
    @mkdir($sessDir, 0700, true);
}
session_save_path($sessDir);
$logFile = $sessDir . '/api-error.log';

// Use 5-arg compatible signature for broader PHP support
session_set_cookie_params(0, '/', '', $isSecure, true);
session_name('MYHEALTH_SESSID');
session_start();

header('Content-Type: application/json');

// CORS: allow only explicit origins, block everything else when Origin is present
function load_allowed_origins(): array
{
    $env = getenv('ALLOWED_ORIGINS') ?: ($_ENV['ALLOWED_ORIGINS'] ?? '');
    $raw = array_filter(array_map('trim', explode(',', $env)));
    if ($raw) {
        return array_map(static fn($o) => rtrim(strtolower($o), '/'), $raw);
    }
    // sensible defaults for local dev and prod domain
    return [
        'http://127.0.0.1:8000',
        'http://localhost:8000',
        'http://localhost',
        'https://liukscot.com',
        'https://www.liukscot.com',
    ];
}

function normalize_origin(?string $origin): string
{
    return rtrim(strtolower($origin ?? ''), '/');
}

$allowedOrigins = load_allowed_origins();
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$normalizedOrigin = normalize_origin($origin);
if ($origin !== '') {
    if (!in_array($normalizedOrigin, $allowedOrigins, true)) {
        respond(403, ['error' => 'origin not allowed']);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

function respond($code, $data)
{
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function read_json()
{
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        respond(400, ['error' => 'invalid json']);
    }
    return $data;
}

$env_candidates = [
    dirname(__DIR__, 4) . '/.env', // repository root (shared .env)
    dirname(__DIR__, 3) . '/.env',
    dirname(__DIR__, 2) . '/.env',
    dirname(__DIR__) . '/.env',
    __DIR__ . '/.env',
];
load_env_files($env_candidates);

function log_api_error($message)
{
    global $logFile;
    if (!$logFile) {
        error_log($message);
        return;
    }
    $line = date('c') . ' ' . $message . PHP_EOL;
    @file_put_contents($logFile, $line, FILE_APPEND);
}

set_exception_handler(function (Throwable $e) {
    log_api_error("Uncaught exception: " . $e->getMessage() . " in " . $e->getFile() . ":" . $e->getLine());
    respond(500, ['error' => 'exception', 'detail' => $e->getMessage()]);
});

set_error_handler(function ($severity, $message, $file, $line) {
    log_api_error("PHP error [{$severity}] {$message} in {$file}:{$line}");
    respond(500, ['error' => 'php_error', 'detail' => $message, 'line' => $line]);
});

function send_session_cookie($isSecure)
{
    $name = session_name();
    $value = session_id();
    $params = session_get_cookie_params();
    // 30 days persistence
    $expires = time() + 60 * 60 * 24 * 30;
    $date = gmdate('D, d M Y H:i:s T', $expires);

    $parts = [
        "$name=$value",
        "expires=$date",
        "Max-Age=" . (60 * 60 * 24 * 30),
        "path={$params['path']}",
        "HttpOnly"
    ];
    if ($params['domain'])
        $parts[] = "domain={$params['domain']}";
    if ($isSecure)
        $parts[] = "Secure";
    $parts[] = "SameSite=Lax";

    // Use true to REPLACE any previous Set-Cookie headers (e.g. from session_start or regenerate_id)
    // This ensures our fully-configured cookie is the one that sticks.
    header("Set-Cookie: " . implode('; ', $parts), true);
}
function env_or_fail($key)
{
    global $_ENV_PATHS_LOADED;
    $candidates = [
        getenv($key),
        $_ENV[$key] ?? null,
        $_SERVER[$key] ?? null,
    ];
    foreach ($candidates as $val) {
        if ($val !== false && $val !== null && $val !== '') {
            return $val;
        }
    }
    $hint = 'set it via hosting env vars or a .env file';
    if ($_ENV_PATHS_LOADED) {
        $short = array_map(static function ($p) {
            $root = dirname(__DIR__, 4);
            $rel = ltrim(str_replace($root, '', $p), '/');
            return $rel ?: $p;
        }, $_ENV_PATHS_LOADED);
        $hint .= ' (checked: ' . implode(', ', $short) . ')';
    }
    respond(500, ['error' => "missing env $key", 'hint' => $hint]);
}
$DB_HOST = env_or_fail('DB_HOST');
$DB_USER = env_or_fail('DB_USER');
$DB_PASS = env_or_fail('DB_PASS');
$DB_NAME = env_or_fail('DB_NAME');

if (!extension_loaded('mysqli')) {
    respond(500, ['error' => 'mysqli extension not loaded']);
}

$mysqli = @new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($mysqli->connect_errno) {
    respond(500, ['error' => 'db connect failed']);
}

// Ensure tables exist
$mysqli->query(
    "CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(190) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(190) DEFAULT NULL,
        role VARCHAR(50) DEFAULT 'user',
        email_verified_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);
$mysqli->query(
    "CREATE TABLE IF NOT EXISTS {$FILES_TABLE} (
        name VARCHAR(150) PRIMARY KEY,
        data LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);
// Note: gemini_key now stores the user's Mistral API key; column name kept for compatibility.
$mysqli->query(
    "CREATE TABLE IF NOT EXISTS {$USER_SETTINGS_TABLE} (
        user_id INT NOT NULL,
        gemini_key TEXT DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);

// Helpers
function is_authed()
{
    return isset($_SESSION['user_id']);
}

function require_auth()
{
    if (!is_authed()) {
        respond(401, ['error' => 'unauthorized']);
    }
}

// Determine the path
$rawUri = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Register endpoint: POST /api/register or /api/files/register {email, password, name}
if (preg_match('#/api(?:/files)?/register/?$#', $rawUri)) {
    if (!$ALLOW_SIGNUP)
        respond(403, ['error' => 'signup disabled']);
    if ($method !== 'POST')
        respond(405, ['error' => 'method not allowed']);
    $body = read_json();
    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    $name = trim($body['name'] ?? '');
    if ($email === '' || $password === '')
        respond(400, ['error' => 'email and password required']);
    if (strlen($password) < 8)
        respond(400, ['error' => 'password too short']);
    $stmt = $mysqli->prepare("SELECT id FROM users WHERE email=? LIMIT 1");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $stmt->store_result();
    if ($stmt->num_rows > 0)
        respond(400, ['error' => 'email already exists']);
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $mysqli->prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'user')");
    $stmt->bind_param("sss", $email, $hash, $name);
    if (!$stmt->execute()) {
        respond(500, ['error' => 'failed to create user']);
    }
    respond(201, ['status' => 'ok', 'email' => $email]);
}

// Login endpoint: POST /api/login or /api/files/login {email, password}
if (preg_match('#/api(?:/files)?/login/?$#', $rawUri)) {
    try {
        if ($method !== 'POST')
            respond(405, ['error' => 'method not allowed']);
        $body = read_json();
        $email = trim($body['email'] ?? '');
        $password = $body['password'] ?? '';
        if ($email === '' || $password === '')
            respond(400, ['error' => 'email and password required']);
        $stmt = $mysqli->prepare("SELECT id, email, password_hash, name, role FROM users WHERE email=? LIMIT 1");
        $stmt->bind_param("s", $email);
        $stmt->execute();
        $result = $stmt->get_result();
        $user = $result ? $result->fetch_assoc() : null;
        if (!$user || !password_verify($password, $user['password_hash'])) {
            respond(401, ['error' => 'invalid credentials']);
        }
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['email'] = $user['email'];
        $_SESSION['name'] = $user['name'];
        $_SESSION['role'] = $user['role'];
        session_regenerate_id(true);
        send_session_cookie($isSecure);
        respond(200, [
            'status' => 'ok',
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
            'session_name' => session_name(),
            'session_id' => session_id(),
        ]);
    } catch (Throwable $e) {
        respond(500, ['error' => 'login failed', 'detail' => $e->getMessage()]);
    }
}

// Logout endpoint: POST /api/logout or /api/files/logout
if (preg_match('#/api(?:/files)?/logout/?$#', $rawUri)) {
    if ($method !== 'POST')
        respond(405, ['error' => 'method not allowed']);
    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params["path"],
            $params["domain"],
            $params["secure"],
            $params["httponly"]
        );
    }
    session_destroy();
    respond(200, ['status' => 'ok']);
}

function enforce_rate_limit(string $bucket, int $limit = 5, int $windowSeconds = 60)
{
    $now = time();
    if (!isset($_SESSION['rate'][$bucket])) {
        $_SESSION['rate'][$bucket] = [];
    }
    $_SESSION['rate'][$bucket] = array_values(array_filter($_SESSION['rate'][$bucket], static function ($ts) use ($now, $windowSeconds) {
        return ($now - $ts) < $windowSeconds;
    }));
    if (count($_SESSION['rate'][$bucket]) >= $limit) {
        respond(429, ['error' => 'rate limit exceeded']);
    }
    $_SESSION['rate'][$bucket][] = $now;
}

function enforce_chat_limits(int $maxRequestsPerMinute = 2, ?int $maxApproxTokens = 450000)
{
    $now = time();
    if (!isset($_SESSION['chat_times'])) {
        $_SESSION['chat_times'] = [];
    }
    $_SESSION['chat_times'] = array_values(array_filter($_SESSION['chat_times'], static fn($t) => ($now - $t) < 60));
    if (count($_SESSION['chat_times']) >= $maxRequestsPerMinute) {
        respond(429, ['error' => 'chat_rate_limited', 'detail' => 'Too many chat requests per minute']);
    }
    $_SESSION['chat_times'][] = $now;
    if ($maxApproxTokens === null) {
        return static function (int $approxTokens) {
            return $approxTokens; // no-op while keeping signature
        };
    }
    return function (int $approxTokens) use ($maxApproxTokens) {
        if ($approxTokens > $maxApproxTokens) {
            respond(400, ['error' => 'chat_token_limit', 'detail' => 'Request too large for token budget']);
        }
    };
}

function secure_bytes(int $len): string
{
    if (function_exists('random_bytes')) {
        return random_bytes($len);
    }
    $bytes = openssl_random_pseudo_bytes($len, $strong);
    if ($bytes !== false && $strong) {
        return $bytes;
    }
    respond(500, ['error' => 'no secure random source available']);
}

function json_from_files_table(mysqli $mysqli, string $name): ?array
{
    $stmt = $mysqli->prepare("SELECT data FROM files WHERE name=? LIMIT 1");
    $stmt->bind_param("s", $name);
    $stmt->execute();
    $stmt->bind_result($data);
    if ($stmt->fetch()) {
        $decoded = json_decode($data, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $stmt->close();
            return $decoded;
        }
    }
    $stmt->close();
    return null;
}

function sort_rows_by_date(array $rows, array $headers): array
{
    $dKey = in_array('date', $headers, true) ? 'date' : (in_array('Date', $headers, true) ? 'Date' : null);
    $tKey = in_array('hour', $headers, true) ? 'hour' : (in_array('Hour', $headers, true) ? 'Hour' : null);
    usort($rows, static function ($a, $b) use ($dKey, $tKey) {
        $aDate = $dKey ? ($a[$dKey] ?? '') : '';
        $bDate = $dKey ? ($b[$dKey] ?? '') : '';
        $aHour = $tKey ? ($a[$tKey] ?? '') : '';
        $bHour = $tKey ? ($b[$tKey] ?? '') : '';
        $aTs = strtotime($aDate . ' ' . $aHour) ?: 0;
        $bTs = strtotime($bDate . ' ' . $bHour) ?: 0;
        return $bTs <=> $aTs;
    });
    return $rows;
}

function filter_dataset_by_days(?array $dataset, ?int $days): ?array
{
    if (!$dataset || $days === null) return $dataset;
    $headers = $dataset['headers'] ?? [];
    $rows = $dataset['rows'] ?? [];
    $cutoff = strtotime("-{$days} days");
    $dKey = in_array('date', $headers, true) ? 'date' : (in_array('Date', $headers, true) ? 'Date' : null);
    if (!$dKey) return $dataset;
    $filtered = array_values(array_filter($rows, static function ($row) use ($dKey, $cutoff) {
        $d = $row[$dKey] ?? '';
        $ts = strtotime($d);
        return $ts !== false && $ts >= $cutoff;
    }));
    return ['headers' => $headers, 'rows' => $filtered];
}

function rows_to_text(?array $dataset, string $label, ?int $limit = null): string
{
    if (!$dataset || !isset($dataset['rows']) || !is_array($dataset['rows'])) {
        return "";
    }
    $headers = $dataset['headers'] ?? [];
    $rows = sort_rows_by_date($dataset['rows'], $headers);
    if (is_int($limit) && $limit > 0) {
        $rows = array_slice($rows, 0, $limit);
    }
    $parts = [];
    foreach ($rows as $row) {
        $clean = [];
        foreach ($row as $k => $v) {
            $clean[] = "{$k}: {$v}";
        }
        $parts[] = "- " . implode("; ", $clean);
    }
    if (!$parts) return "";
    return strtoupper($label) . ":\n" . implode("\n", $parts);
}

function call_mistral_single(string $apiKey, string $prompt, float $temperature, ?int $maxTokens, string $model): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('curl extension missing');
    }
    $url = "https://api.mistral.ai/v1/chat/completions";
    $payload = [
        "model" => $model,
        "messages" => [
            ["role" => "system", "content" => "You are an assistant for the myHealth diary and pain tracker. Use only the provided context to answer, be concise and actionable."],
            ["role" => "user", "content" => $prompt],
        ],
        "temperature" => $temperature,
        "safe_prompt" => false,
    ];
    if ($maxTokens !== null) {
        $payload["max_tokens"] = $maxTokens;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "Authorization: " . "Bearer {$apiKey}",
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $info = curl_getinfo($ch);
    curl_close($ch);
    if ($errno) {
        throw new RuntimeException("mistral request failed (curl errno {$errno})");
    }
    $decoded = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        log_api_error("Mistral {$model} bad JSON status {$status}; curl info: " . json_encode($info) . "; body: " . substr($response ?? '', 0, 500));
        throw new RuntimeException("mistral returned non-json (status {$status})");
    }
    if ($status >= 400) {
        $detail = isset($decoded['error']['message']) ? $decoded['error']['message'] : 'mistral error';
        log_api_error("Mistral {$model} error status {$status}: {$detail}; body: " . substr(json_encode($decoded), 0, 500));
        throw new RuntimeException("mistral error status {$status}: {$detail}");
    }
    $text = $decoded['choices'][0]['message']['content'] ?? null;
    if (!$text) {
        log_api_error("Mistral {$model} empty response status {$status}; body: " . substr(json_encode($decoded), 0, 500));
        throw new RuntimeException("mistral returned empty response (status {$status})");
    }
    return [
        'text' => is_array($text) ? implode("\n", $text) : $text,
        'raw' => $decoded,
        'model_used' => $decoded['model'] ?? $model,
    ];
}

function call_mistral(string $apiKey, string $prompt, float $temperature = 0.3, ?int $maxTokens = null, string $model = 'mistral-small-latest'): array
{
    $fallbacks = [
        'mistral-small-latest' => ['mistral-medium-latest', 'mistral-large-latest'],
        'mistral-medium-latest' => ['mistral-small-latest', 'mistral-large-latest'],
        'mistral-large-latest' => ['mistral-medium-latest', 'mistral-small-latest'],
    ];
    $sequence = array_unique(array_merge([$model], $fallbacks[$model] ?? []));
    $errors = [];
    foreach ($sequence as $candidate) {
        try {
            return call_mistral_single($apiKey, $prompt, $temperature, $maxTokens, $candidate);
        } catch (RuntimeException $e) {
            $errors[] = $candidate . ": " . $e->getMessage();
        }
    }
    throw new RuntimeException("All model attempts failed: " . implode(" | ", $errors));
}

function compose_fallback_reply(?array $diary, ?array $pain, string $reason): string
{
    $parts = [];
    $parts[] = "LLM unavailable. Reason: {$reason}";
    $diaryRows = $diary['rows'] ?? [];
    $painRows = $pain['rows'] ?? [];
    $parts[] = "Diary entries: " . count($diaryRows) . "; Pain entries: " . count($painRows) . ".";

    $latestPain = null;
    if ($pain && isset($pain['rows']) && isset($pain['headers'])) {
        $sorted = sort_rows_by_date($pain['rows'], $pain['headers']);
        $latestPain = $sorted[0] ?? null;
    }
    if ($latestPain) {
        $snippet = [];
        foreach (['date', 'hour', 'pain level', 'fatigue level', 'symptoms', 'area', 'activities', 'medicines', 'note'] as $k) {
            if (isset($latestPain[$k]) && $latestPain[$k] !== '') {
                $snippet[] = "{$k}: {$latestPain[$k]}";
            }
        }
        if ($snippet) {
            $parts[] = "Latest pain entry -> " . implode("; ", $snippet);
        }
    }

    $latestDiary = null;
    if ($diary && isset($diary['rows']) && isset($diary['headers'])) {
        $sorted = sort_rows_by_date($diary['rows'], $diary['headers']);
        $latestDiary = $sorted[0] ?? null;
    }
    if ($latestDiary) {
        $snippet = [];
        foreach (['date', 'hour', 'mood level', 'depression', 'anxiety', 'description', 'reflection'] as $k) {
            if (isset($latestDiary[$k]) && $latestDiary[$k] !== '') {
                $snippet[] = "{$k}: {$latestDiary[$k]}";
            }
        }
        if ($snippet) {
            $parts[] = "Latest diary entry -> " . implode("; ", $snippet);
        }
    }

    return implode("\n", array_filter($parts));
}

// Mistral API key: GET status, PUT/POST save, DELETE clear
if (preg_match('#/api(?:/files)?/ai-key/?$#', $rawUri)) {
    require_auth();
    $userId = $_SESSION['user_id'];
    if ($method === 'GET') {
        enforce_rate_limit('ai-key:get', 8, 60);
        $stmt = $mysqli->prepare("SELECT gemini_key, updated_at FROM {$USER_SETTINGS_TABLE} WHERE user_id=? LIMIT 1");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $stmt->bind_result($key, $updated);
        if ($stmt->fetch() && $key !== null && $key !== '') {
            $last4 = strlen($key) >= 4 ? substr($key, -4) : '';
            $stmt->close();
            respond(200, ['has_key' => true, 'last4' => $last4, 'updated_at' => $updated]);
        }
        $stmt->close();
        respond(200, ['has_key' => false]);
    }
    if ($method === 'PUT' || $method === 'POST') {
        enforce_rate_limit('ai-key:write', 5, 300);
        $body = read_json();
        $key = trim($body['key'] ?? '');
        if ($key === '')
            respond(400, ['error' => 'key required']);
        if (strlen($key) > 4096)
            respond(400, ['error' => 'key too long']);
        $stmt = $mysqli->prepare("INSERT INTO {$USER_SETTINGS_TABLE} (user_id, gemini_key) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE gemini_key=VALUES(gemini_key), updated_at=CURRENT_TIMESTAMP");
        $stmt->bind_param("is", $userId, $key);
        $stmt->execute();
        $stmt->close();
        respond(200, ['status' => 'saved', 'has_key' => true]);
    }
    if ($method === 'DELETE') {
        enforce_rate_limit('ai-key:write', 5, 300);
        $stmt = $mysqli->prepare("UPDATE {$USER_SETTINGS_TABLE} SET gemini_key=NULL, updated_at=CURRENT_TIMESTAMP WHERE user_id=?");
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $stmt->close();
        respond(200, ['status' => 'cleared', 'has_key' => false]);
    }
    respond(405, ['error' => 'method not allowed']);
}

// Chatbot endpoint: POST /api/files/chat
if (preg_match('#/api(?:/files)?/chat/?$#', $rawUri)) {
    require_auth();
    if ($method !== 'POST') {
        respond(405, ['error' => 'method not allowed']);
    }
    enforce_rate_limit('chat:post', 8, 60);
    $body = read_json();
    $message = trim($body['message'] ?? '');
    if ($message === '') {
        respond(400, ['error' => 'message required']);
    }
    enforce_chat_limits(2, null);
    // Load Mistral key (stored in gemini_key column for compatibility)
    $stmt = $mysqli->prepare("SELECT gemini_key FROM {$USER_SETTINGS_TABLE} WHERE user_id=? LIMIT 1");
    $stmt->bind_param("i", $_SESSION['user_id']);
    $stmt->execute();
    $stmt->bind_result($apiKey);
    if (!$stmt->fetch() || !$apiKey) {
        $stmt->close();
        respond(400, ['error' => 'no mistral key saved']);
    }
    $stmt->close();

    $model = isset($body['model']) && is_string($body['model']) ? trim($body['model']) : 'mistral-small-latest';
    $allowedModels = [
        'mistral-small-latest',
        'mistral-medium-latest',
        'mistral-large-latest',
    ];
    if (!in_array($model, $allowedModels, true)) {
        $model = 'mistral-small-latest';
    }

    $range = isset($body['range']) && is_string($body['range']) ? trim($body['range']) : 'all';
    $days = null;
    if (in_array($range, ['30', '90', '365'], true)) {
        $days = (int)$range;
    }

    // Build context from stored datasets (filtered by range)
    $diary = filter_dataset_by_days(json_from_files_table($mysqli, 'diary.json'), $days);
    $pain = filter_dataset_by_days(json_from_files_table($mysqli, 'pain.json'), $days);
    $ctxParts = [];
    $ctxDiary = rows_to_text($diary, 'diary'); // filtered rows
    $ctxPain = rows_to_text($pain, 'pain');   // filtered rows
    if ($ctxDiary) $ctxParts[] = $ctxDiary;
    if ($ctxPain) $ctxParts[] = $ctxPain;
    $context = $ctxParts ? implode("\n\n", $ctxParts) : "No diary or pain logs available.";

    $maxOutputTokens = null; // let Mistral decide output length

    $prompt = "Use only the provided diary and pain context to answer. If the context is missing information, say you do not know.\n"
        . "Be concise, actionable, and avoid speculation.\n"
        . "Context:\n{$context}\n\n"
        . "User question:\n{$message}\n\n"
        . "Answer with bullet points or short paragraphs. Cite specifics from the context when possible.";
    try {
        $llm = call_mistral($apiKey, $prompt, 0.25, $maxOutputTokens, $model);
        $reply = $llm['text'] ?? 'No answer returned.';
        respond(200, [
            'reply' => $reply,
            'model_used' => $llm['model_used'] ?? $model,
            'used_context' => [
                'diary_rows' => isset($diary['rows']) ? count($diary['rows']) : 0,
                'pain_rows' => isset($pain['rows']) ? count($pain['rows']) : 0,
            ],
        ]);
    } catch (Throwable $e) {
        $fallback = compose_fallback_reply($diary, $pain, $e->getMessage());
        respond(200, [
            'reply' => $fallback,
            'fallback' => true,
            'detail' => $e->getMessage(),
            'model_used' => 'fallback',
            'used_context' => [
                'diary_rows' => isset($diary['rows']) ? count($diary['rows']) : 0,
                'pain_rows' => isset($pain['rows']) ? count($pain['rows']) : 0,
            ],
        ]);
    }
}

// Everything below is file API (requires auth unless APP_KEY matches)

// Remove everything up to /api/files/
$path = preg_replace('#^.*?/api/files/?#', '', $rawUri);
$name = trim($path, '/');
// Normalize to .json filenames
if ($name !== '' && substr($name, -5) !== '.json') {
    $name .= '.json';
}

// List files: GET /api/files
if ($name === '' && $method === 'GET') {
    require_auth();
    $res = $mysqli->query("SELECT name, CHAR_LENGTH(data) AS size, updated_at FROM {$FILES_TABLE} ORDER BY name ASC");
    $rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
    respond(200, $rows);
}

// Require a name for other operations
if ($name === '') {
    respond(400, ['error' => 'file name required']);
}

// Get a file: GET /api/files/{name}.json
if ($method === 'GET') {
    require_auth();
    $stmt = $mysqli->prepare("SELECT data FROM {$FILES_TABLE} WHERE name=?");
    $stmt->bind_param("s", $name);
    $stmt->execute();
    $stmt->bind_result($data);
    if ($stmt->fetch()) {
        echo $data; // already JSON
    } else {
        respond(404, ['error' => 'not found']);
    }
    exit;
}

// Save a file: PUT/POST /api/files/{name}.json
if ($method === 'PUT' || $method === 'POST') {
    require_auth();
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        respond(400, ['error' => 'empty body']);
    }
    json_decode($raw);
    if (json_last_error() !== JSON_ERROR_NONE) {
        respond(400, ['error' => 'invalid json']);
    }
    $stmt = $mysqli->prepare("INSERT INTO {$FILES_TABLE} (name, data) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=CURRENT_TIMESTAMP");
    $stmt->bind_param("ss", $name, $raw);
    $stmt->execute();
    respond(200, ['status' => 'saved', 'file' => $name]);
}

respond(405, ['error' => 'method not allowed']);
