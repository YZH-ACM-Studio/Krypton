const CREDENTIAL_SECRET_KEYS = new Set([
    'password',
    'verifypassword',
    'newpassword',
    'adminpassword',
    'currentpassword',
    'current',
    'hash',
    'salt',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'tfa',
    'tfasecret',
    'code',
    'manualcodes',
    'plaintext',
    'csv',
    'pairingcode',
    'ticket',
    'authnchallenge',
    'credentialid',
    'credentialpublickey',
    'attestationobject',
]);

/** Exact credential-field policy shared by generic and account-specific audit sanitizers. */
export function isCredentialSecretKey(key: string): boolean {
    return key.startsWith('__') || CREDENTIAL_SECRET_KEYS.has(key.toLowerCase());
}
