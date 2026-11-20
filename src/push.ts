/**
 * Web Push（RFC 8291 aes128gcm 加密 + RFC 8292 VAPID），只用 WebCrypto，不需要外部套件。
 */
import type { Env } from './env';

const enc = new TextEncoder();

export function b64uDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function b64uEncode(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** 依 RFC 8291 加密推播內容，回傳要 POST 給推播服務的 body */
export async function encryptPayload(p256dh: string, authSecret: string, payload: Uint8Array, salt?: Uint8Array, asKeys?: CryptoKeyPair): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const auth = b64uDecode(authSecret);
  const keys = asKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, keys.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = (await hmac(prkKey, keyInfo)).slice(0, 32);
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(s, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** VAPID JWT（ES256） */
export async function vapidJwt(privateJwk: JsonWebKey, audience: string, subject: string): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64uEncode(sig)}`;
}

export interface PushMessage { title: string; body: string; url: string }

/** 推播給某位用戶的所有裝置；失效的訂閱會自動刪除 */
export async function pushToUser(env: Env, userId: string, msg: PushMessage) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return;
  const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? LIMIT 10').bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();
  if (!subs.results.length) return;
  let jwk: JsonWebKey;
  try { jwk = JSON.parse(env.VAPID_PRIVATE_JWK); } catch { console.log('VAPID_PRIVATE_JWK 格式錯誤，請用 scripts/gen-vapid.mjs 重新產生'); return; }
  const payload = enc.encode(JSON.stringify(msg));
  await Promise.all(subs.results.map(async (s) => {
    try {
      const aud = new URL(s.endpoint).origin;
      const jwt = await vapidJwt(jwk, aud, env.VAPID_SUBJECT || env.SITE_URL);
      const body = await encryptPayload(s.p256dh, s.auth, payload);
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: {
          authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal',
        },
        body,
      });
      if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run();
    } catch (e) {
      console.log('push error', String(e));
    }
  }));
}
