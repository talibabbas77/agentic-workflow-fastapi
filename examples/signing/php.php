<?php
// composer require firebase/php-jwt
use Firebase\JWT\JWT;

function docent_token(array $user): string
{
    $now = time();
    $claims = [
        'iss' => getenv('DOCENT_WIDGET_ID'),
        'aud' => 'docent',
        'sub' => (string) $user['id'],
        'iat' => $now,
        'exp' => $now + 300,
        'jti' => bin2hex(random_bytes(16)),
        'name' => $user['name'],
        'email' => $user['email'],
        'ctx' => ['plan' => $user['plan']],
    ];
    return JWT::encode($claims, getenv('DOCENT_PRIVATE_KEY'), 'ES256', getenv('DOCENT_KEY_ID'));
}

// Laravel, behind your login check:
// Route::get('/docent-token', fn () => response(
//     docent_token(auth()->user()->only('id', 'name', 'email', 'plan'))
// ))->middleware('auth');

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    require __DIR__ . '/vendor/autoload.php';
    $user = [
        'id' => 'user-123', 'name' => 'Ana Souza', 'email' => 'ana@example.com', 'plan' => 'Team',
    ];
    echo docent_token($user), PHP_EOL;
}
