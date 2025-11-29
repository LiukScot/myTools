<?php
// Tiny JSON file API for Hetzner Webhosting (PHP + MySQL) with simple login.
// Drop this file (and the .htaccess in the same folder) into public_html/myhealth/api/files/
// Then point your frontend requests to /api/files/...

// ---- DB credentials are provided via environment (.env file or hosting panel) ----
$_ENV_PATHS_LOADED = [];
function load_env_files(array $paths) {
    global $_ENV_PATHS_LOADED;
    foreach ($paths as $path) {
        if (!is_file($path)) continue;
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (preg_match('/^\s*#/', $line)) continue;
            if (strpos($line, '=') === false) continue;
            [$key, $val] = explode('=', $line, 2);
            $key = trim($key);
            if (stripos($key, 'export ') === 0) {
                $key = trim(substr($key, 7));
            }
            $val = trim($val);
            $val = trim($val, "\"'");
            if ($key === '') continue;
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

// ---- No edits needed below unless you want to customize behavior ----

// Broader cookie scope so auth persists across API calls
$isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') === '443';
session_name('PHPSESSID');
set_session_cookie_params($isSecure);
session_start();

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Content-Type: application/json');
if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: *');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Key');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

function respond($code, $data) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function read_json() {
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
function env_or_fail($key) {
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

function set_session_cookie_params($isSecure) {
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $isSecure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } else {
        session_set_cookie_params(0, '/', '', $isSecure, true);
    }
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

// Helpers
function is_authed() {
    return isset($_SESSION['user_id']);
}

function require_auth() {
    $appKey = getenv('APP_KEY') ?: ($_ENV['APP_KEY'] ?? null);
    $headerKey = $_SERVER['HTTP_X_APP_KEY'] ?? null;
    if ($appKey && $headerKey && hash_equals($appKey, $headerKey)) {
        return;
    }
    if (!is_authed()) {
        respond(401, ['error' => 'unauthorized']);
    }
}

// Determine the path
$rawUri = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Register endpoint: POST /api/register or /api/files/register {email, password, name}
if (preg_match('#/api(?:/files)?/register/?$#', $rawUri)) {
    if (!$ALLOW_SIGNUP) respond(403, ['error' => 'signup disabled']);
    if ($method !== 'POST') respond(405, ['error' => 'method not allowed']);
    $body = read_json();
    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    $name = trim($body['name'] ?? '');
    if ($email === '' || $password === '') respond(400, ['error' => 'email and password required']);
    if (strlen($password) < 8) respond(400, ['error' => 'password too short']);
    $stmt = $mysqli->prepare("SELECT id FROM users WHERE email=? LIMIT 1");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $stmt->store_result();
    if ($stmt->num_rows > 0) respond(400, ['error' => 'email already exists']);
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
    if ($method !== 'POST') respond(405, ['error' => 'method not allowed']);
    $body = read_json();
    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    if ($email === '' || $password === '') respond(400, ['error' => 'email and password required']);
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
    if (PHP_VERSION_ID >= 70300) {
        setcookie(session_name(), session_id(), [
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $isSecure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } else {
        setcookie(session_name(), session_id(), 0, '/', '', $isSecure, true);
    }
    respond(200, ['status' => 'ok', 'email' => $user['email'], 'name' => $user['name'], 'role' => $user['role']]);
}

// Logout endpoint: POST /api/logout or /api/files/logout
if (preg_match('#/api(?:/files)?/logout/?$#', $rawUri)) {
    if ($method !== 'POST') respond(405, ['error' => 'method not allowed']);
    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    session_destroy();
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
