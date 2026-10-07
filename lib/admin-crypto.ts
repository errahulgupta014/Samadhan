/**
 * Administrator password hashing and opaque tokens (WebCrypto only: runs in Workers and Node).
 * Passwords: PBKDF2-SHA256, per-user random 16-byte salt, 256-bit output, compared in constant time. The iteration count is stored next to
 * each hash so it can be raised later without invalidating old passwords (the next successful sign-in re-hashes, see needsRehash).
 * Nothing here logs or returns a password; callers must not either.
 */
export const PBKDF2_ITERATIONS = 210000;
export const MIN_PBKDF2_ITERATIONS = 150000;
export type PasswordRecord = {hash: string; salt: string; iterations: number};

const encoder = new TextEncoder();
export const toHex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
export function fromHex(hex: string) {
 if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Invalid hex');
 return Uint8Array.from(hex.match(/../g)!, h => parseInt(h, 16));
}
export const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
/** SHA-256 hex of a string (session tokens and IP buckets are stored only in this form). */
export async function sha256Hex(value: string) {return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));}

/** Constant-time equality of two equal-purpose byte strings; a length mismatch is still compared over the longer length. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
 let diff = a.length ^ b.length;
 const n = Math.max(a.length, b.length);
 for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
 return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations}, key, 256));
}

export async function hashPassword(password: string, options: {iterations?: number; salt?: string} = {}): Promise<PasswordRecord> {
 const iterations = options.iterations ?? PBKDF2_ITERATIONS;
 if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS) throw new Error('Too few PBKDF2 iterations.');
 const salt = options.salt ?? randomHex(16);
 return {hash: toHex(await derive(password, fromHex(salt), iterations)), salt, iterations};
}

/** True when `password` matches the stored record. Malformed records never match (and never throw). */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
 try {
  if (!Number.isInteger(record.iterations) || record.iterations < 1) return false;
  return timingSafeEqual(await derive(password, fromHex(record.salt), record.iterations), fromHex(record.hash));
 } catch {return false;}
}

/** Old hashes are upgraded after a correct sign-in once the standard iteration count rises. */
export const needsRehash = (record: Pick<PasswordRecord, 'iterations'>) => record.iterations < PBKDF2_ITERATIONS;

let dummy: Promise<PasswordRecord> | undefined;
/**
 * Burns the same work as a real verification so that "unknown user" and "wrong password" take the same time.
 * The dummy record is derived from a random secret that is never revealed.
 */
export async function burnPasswordCheck(password: string) {
 dummy ??= hashPassword(randomHex(16));
 await verifyPassword(password, await dummy);
}
