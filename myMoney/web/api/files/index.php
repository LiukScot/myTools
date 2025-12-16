<?php
// Tiny JSON file API using a local SQLite database with simple login.
// Drop this file into public_html/mymoney/api/files/ (or serve locally via testing/run.sh)
// Then point your frontend requests to /api/files/...

// ---- Optional env vars are loaded from .env (ALLOWED_ORIGINS, LOCAL_DB_PATH, etc.) ----
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

function env_get(string $key, $default = '')
{
    $val = getenv($key);
    if ($val === false) {
        return $_ENV[$key] ?? $default;
    }
    return $val;
}

$env_candidates = [
    dirname(__DIR__, 4) . '/.env', // repository root (shared .env)
    dirname(__DIR__, 3) . '/.env',
    dirname(__DIR__, 2) . '/.env',
    dirname(__DIR__) . '/.env',
    __DIR__ . '/.env',
];
load_env_files($env_candidates);

// Session login only; users can self-register when enabled.
$ALLOW_SIGNUP = true; // allow self-registration
$FILES_TABLE = 'files';

// ---- No edits needed below unless you want to customize behavior ----

$isSecure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';

// Keep session files shared across apps (one level above the app folders, e.g. /public_html/sessions)
function resolve_session_dir(): string
{
    $candidates = [
        dirname(__DIR__, 4) . '/sessions', // repo root when using /web/
        dirname(__DIR__, 3) . '/sessions', // public_html when deployed flat
        dirname(__DIR__, 2) . '/sessions',
    ];
    foreach ($candidates as $dir) {
        $parent = dirname($dir);
        if ($parent === '/' || $parent === '\\') {
            continue; // avoid writing to filesystem root
        }
        if (is_dir($dir) || @mkdir($dir, 0700, true)) {
            return $dir;
        }
    }
    $fallback = rtrim(sys_get_temp_dir(), '/\\') . '/mytools_sessions';
    @mkdir($fallback, 0700, true);
    return $fallback;
}

$sessDir = resolve_session_dir();

function configure_session_storage(string $sessDir): string
{
    $handlerChoice = strtolower((string) env_get('SESSION_SAVE_HANDLER', 'auto'));
    $useRedis = $handlerChoice === 'redis' || $handlerChoice === 'auto';
    $redisUrl = (string) env_get('SESSION_REDIS_URL', '');
    $redisHost = (string) env_get('SESSION_REDIS_HOST', '127.0.0.1');
    $redisPort = (int) env_get('SESSION_REDIS_PORT', '6379');
    $redisPassword = (string) env_get('SESSION_REDIS_PASSWORD', '');
    $redisPrefix = (string) env_get('SESSION_REDIS_PREFIX', 'mytools_sess_');
    $connectTimeout = (float) env_get('SESSION_REDIS_CONNECT_TIMEOUT', '0.5');
    $timeout = (float) env_get('SESSION_REDIS_TIMEOUT', '2');
    $readTimeout = (float) env_get('SESSION_REDIS_READ_TIMEOUT', '2');

    if ($useRedis && extension_loaded('redis')) {
        if ($redisUrl !== '') {
            $parsed = parse_url($redisUrl);
            if ($parsed && isset($parsed['host'], $parsed['port'])) {
                $redisHost = $parsed['host'];
                $redisPort = (int) $parsed['port'];
            }
        } else {
            $redisUrl = "tcp://{$redisHost}:{$redisPort}";
        }

        $params = [];
        if ($redisPassword !== '') {
            $params[] = 'auth=' . rawurlencode($redisPassword);
        }
        if ($redisPrefix !== '') {
            $params[] = 'prefix=' . rawurlencode($redisPrefix);
        }
        $params[] = 'persistent=1';
        $params[] = 'timeout=' . $timeout;
        $params[] = 'read_timeout=' . $readTimeout;

        if ($params) {
            $redisUrl .= (strpos($redisUrl, '?') === false ? '?' : '&') . implode('&', $params);
        }

        $canUseRedis = true;
        if (class_exists('Redis')) {
            try {
                $r = new Redis();
                $r->connect($redisHost, $redisPort, max($connectTimeout, 0.1));
                if ($redisPassword !== '') {
                    $r->auth($redisPassword);
                }
                $r->ping();
                $r->close();
            } catch (Throwable $e) {
                $canUseRedis = false;
                error_log('Redis session unavailable, falling back to file sessions: ' . $e->getMessage());
            }
        }

        if ($canUseRedis) {
            ini_set('session.save_handler', 'redis');
            ini_set('session.save_path', $redisUrl);
            return 'redis';
        }
    }

    session_save_path($sessDir);
    return 'files';
}

function cookie_base_domain(?string $host): ?string
{
    $host = strtolower(trim((string) $host));
    if ($host === '') {
        return null;
    }
    $host = preg_replace('/:\d+$/', '', $host);
    $host = trim($host, '[]');
    if (in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
        return null;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return null; // domain attr on IP hosts breaks cookie persistence
    }
    return preg_replace('/^www\./', '', $host);
}

$sessionBackend = configure_session_storage($sessDir);
$sessionLifetime = (int) env_get('SESSION_LIFETIME', 60 * 60 * 24 * 30);
if ($sessionLifetime < 0) {
    $sessionLifetime = 0;
}
$cookieDomain = cookie_base_domain($_SERVER['HTTP_HOST'] ?? '');

// Use 5-arg compatible signature for broader PHP support
session_set_cookie_params($sessionLifetime, '/', $cookieDomain ?? '', $isSecure, true);
session_name('MYTOOLS_SESSID');
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
        'http://192.168.1.13:8000',
        'http://192.168.1.13',
        'http://127.0.0.1:8000',
        'http://127.0.0.1',
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

function resolve_db_path(): string
{
    $envPath = getenv('LOCAL_DB_PATH') ?: ($_ENV['LOCAL_DB_PATH'] ?? '');
    if ($envPath !== '') {
        return $envPath;
    }

    $candidates = [];
    $root = dirname(__DIR__, 4);
    if ($root && $root !== '/' && $root !== '\\') {
        $candidates[] = $root . '/data/mytools.sqlite';
    }
    $candidates[] = dirname(__DIR__, 3) . '/data/mytools.sqlite';
    $candidates[] = dirname(__DIR__, 2) . '/data/mytools.sqlite';
    $candidates[] = dirname(__DIR__) . '/mytools.sqlite';
    $candidates[] = __DIR__ . '/mytools.sqlite';

    foreach ($candidates as $path) {
        $dir = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
            continue;
        }
        return $path;
    }

    respond(500, ['error' => 'no writable db path found']);
}

function ensure_tables(PDO $db, string $filesTable): void
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $filesTable)) {
        respond(500, ['error' => 'invalid table name']);
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT NULL,
            role TEXT DEFAULT 'user',
            email_verified_at TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS {$filesTable} (
            name TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )"
    );
}

function connect_db(string $filesTable): PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        respond(500, ['error' => 'pdo_sqlite extension not loaded']);
    }
    $path = resolve_db_path();
    try {
        $db = new PDO(
            'sqlite:' . $path,
            null,
            null,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
    } catch (Throwable $e) {
        respond(500, ['error' => 'db connect failed', 'detail' => $e->getMessage()]);
    }
    $db->exec('PRAGMA foreign_keys = ON');
    ensure_tables($db, $filesTable);
    return $db;
}

function send_session_cookie($isSecure, int $lifetime)
{
    global $cookieDomain;
    $name = session_name();
    $value = session_id();
    $params = session_get_cookie_params();

    $parts = [
        "$name=$value",
        "path={$params['path']}",
        "HttpOnly"
    ];
    if ($lifetime > 0) {
        $expires = time() + $lifetime;
        $parts[] = "expires=" . gmdate('D, d M Y H:i:s T', $expires);
        $parts[] = "Max-Age=" . $lifetime;
    }
    if ($cookieDomain) {
        $parts[] = "domain=.{$cookieDomain}";
    }
    if ($isSecure)
        $parts[] = "Secure";
    $parts[] = "SameSite=Lax";

    // Use true to REPLACE any previous Set-Cookie headers
    header("Set-Cookie: " . implode('; ', $parts), true);
}
$db = connect_db($FILES_TABLE);

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

// Session status: GET /api/session or /api/files/session
if (preg_match('#/api(?:/files)?/session/?$#', $rawUri)) {
    if ($method !== 'GET') {
        respond(405, ['error' => 'method not allowed']);
    }
    if (!is_authed()) {
        respond(200, ['authed' => false]);
    }
    respond(200, [
        'authed' => true,
        'email' => $_SESSION['email'] ?? null,
        'name' => $_SESSION['name'] ?? null,
        'role' => $_SESSION['role'] ?? null,
        'session_name' => session_name(),
    ]);
}

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
    $stmt = $db->prepare("SELECT id FROM users WHERE email=? LIMIT 1");
    $stmt->execute([$email]);
    if ($stmt->fetch())
        respond(400, ['error' => 'email already exists']);
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $db->prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'user')");
    $stmt->execute([$email, $hash, $name]);
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
        $stmt = $db->prepare("SELECT id, email, password_hash, name, role FROM users WHERE email=? LIMIT 1");
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            respond(401, ['error' => 'invalid credentials']);
        }
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['email'] = $user['email'];
        $_SESSION['name'] = $user['name'];
        $_SESSION['role'] = $user['role'];
        session_regenerate_id(true);
        send_session_cookie($isSecure, $sessionLifetime);
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

// Change password: POST /api/change-password {current_password, new_password}
if (preg_match('#/api(?:/files)?/change-password/?$#', $rawUri)) {
    require_auth();
    if ($method !== 'POST')
        respond(405, ['error' => 'method not allowed']);
    $body = read_json();
    $current = $body['current_password'] ?? '';
    $new = $body['new_password'] ?? '';
    if (!is_string($current) || !is_string($new) || $current === '' || $new === '') {
        respond(400, ['error' => 'current and new password required']);
    }
    if (strlen($new) < 8) {
        respond(400, ['error' => 'new password too short']);
    }
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id=? LIMIT 1");
    $stmt->execute([$_SESSION['user_id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($current, $row['password_hash'] ?? '')) {
        respond(400, ['error' => 'current password incorrect']);
    }
    $newHash = password_hash($new, PASSWORD_DEFAULT);
    $up = $db->prepare("UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
    $up->execute([$newHash, $_SESSION['user_id']]);
    session_regenerate_id(true);
    send_session_cookie($isSecure, $sessionLifetime);
    respond(200, ['status' => 'ok']);
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
    $res = $db->query("SELECT name, LENGTH(data) AS size, updated_at FROM {$FILES_TABLE} ORDER BY name ASC");
    $rows = $res ? $res->fetchAll() : [];
    respond(200, $rows);
}

// Require a name for other operations
if ($name === '') {
    respond(400, ['error' => 'file name required']);
}

// Get a file: GET /api/files/{name}.json
if ($method === 'GET') {
    require_auth();
    $stmt = $db->prepare("SELECT data FROM {$FILES_TABLE} WHERE name=? LIMIT 1");
    $stmt->execute([$name]);
    $row = $stmt->fetch();
    if ($row && isset($row['data'])) {
        echo $row['data']; // already JSON
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
    $stmt = $db->prepare("INSERT INTO {$FILES_TABLE} (name, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP");
    $stmt->execute([$name, $raw]);
    respond(200, ['status' => 'saved', 'file' => $name]);
}

respond(405, ['error' => 'method not allowed']);
