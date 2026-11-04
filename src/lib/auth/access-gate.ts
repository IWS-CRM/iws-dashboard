export const ACCESS_GATE_COOKIE = 'iws-access-gate';
export const ACCESS_TOKEN_FRESH_SECONDS = 120;
export const ACCESS_GATE_TTL_SECONDS = 60;

export type AccessGate = {
  sub: string;
  email: string | null;
  role: string | null;
  accessDisabled: boolean;
  loginEnabled: boolean | null;
  exp: number;
};

export type LocalAccessToken = {
  userId: string;
  email: string | null;
  exp: number;
};

type CookiePair = { name: string; value: string };

const BASE64_PREFIX = 'base64-';

let cachedKey: { secret: string; key: CryptoKey } | null = null;

export function authStorageKey(supabaseUrl: string): string | null {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    if (!projectRef) return null;
    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

export function accessTokenIsFresh(
  token: LocalAccessToken,
  marginSeconds = ACCESS_TOKEN_FRESH_SECONDS
) {
  return token.exp * 1000 > Date.now() + marginSeconds * 1000;
}

export function gateIsBlocked(gate: AccessGate) {
  if (gate.role !== 'creator' && gate.accessDisabled) return true;
  if (gate.role === 'worker' && gate.loginEnabled === false) return true;
  return false;
}

export function readLocalAccessToken(
  cookies: CookiePair[],
  supabaseUrl: string
): LocalAccessToken | null {
  const key = authStorageKey(supabaseUrl);
  if (!key) return null;

  const raw = combineCookie(cookies, key);
  if (!raw) return null;

  let sessionJson = raw;
  if (raw.startsWith(BASE64_PREFIX)) {
    const decoded = textFromBase64Url(raw.slice(BASE64_PREFIX.length));
    if (!decoded) return null;
    sessionJson = decoded;
  }

  let accessToken: string | undefined;
  try {
    const session = JSON.parse(sessionJson) as { access_token?: string };
    accessToken = session.access_token;
  } catch {
    return null;
  }
  if (!accessToken) return null;

  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  const payloadJson = textFromBase64Url(payload);
  if (!payloadJson) return null;

  try {
    const claims = JSON.parse(payloadJson) as {
      sub?: string;
      exp?: number;
      email?: string;
    };
    if (!claims.sub || typeof claims.exp !== 'number') return null;
    return {
      userId: claims.sub,
      email: claims.email ?? null,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}

export async function sealAccessGate(
  payload: Omit<AccessGate, 'exp'>,
  secret: string
): Promise<string> {
  const body: AccessGate = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ACCESS_GATE_TTL_SECONDS,
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))
  );
  return `${encoded}.${bytesToBase64Url(signature)}`;
}

export async function openAccessGate(
  value: string | undefined,
  secret: string
): Promise<AccessGate | null> {
  if (!value || !secret) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const encoded = value.slice(0, dot);
  const signature = bytesFromBase64Url(value.slice(dot + 1));
  if (!signature) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(encoded)
  );
  if (!valid) return null;

  const json = textFromBase64Url(encoded);
  if (!json) return null;

  try {
    const payload = JSON.parse(json) as Partial<AccessGate>;
    if (!isAccessGate(payload)) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function combineCookie(cookies: CookiePair[], key: string) {
  const direct = cookies.find((cookie) => cookie.name === key)?.value;
  if (direct) return direct;

  const chunks: string[] = [];
  for (let index = 0; ; index += 1) {
    const chunk = cookies.find((cookie) => cookie.name === `${key}.${index}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join('') : null;
}

function isAccessGate(value: Partial<AccessGate>): value is AccessGate {
  return (
    typeof value.sub === 'string' &&
    (value.email === null || typeof value.email === 'string') &&
    (value.role === null || typeof value.role === 'string') &&
    typeof value.accessDisabled === 'boolean' &&
    (value.loginEnabled === null || typeof value.loginEnabled === 'boolean') &&
    typeof value.exp === 'number'
  );
}

async function hmacKey(secret: string) {
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  cachedKey = { secret, key };
  return key;
}

function bytesFromBase64Url(value: string) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textFromBase64Url(value: string) {
  const bytes = bytesFromBase64Url(value);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}
