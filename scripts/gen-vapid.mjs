// 產生推播通知用的 VAPID 金鑰：node scripts/gen-vapid.mjs
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const b64u = (u) => Buffer.from(u).toString('base64url');
console.log(JSON.stringify({ public: b64u(raw), private: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) }));
