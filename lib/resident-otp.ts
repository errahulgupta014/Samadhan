import {digest, ServiceError} from './service';

/**
 * Resident mobile OTP: pure rules, storage behind OtpStore (D1 in lib/resident-auth.ts, memory in tests).
 * Hashes only: neither a mobile number nor an OTP code is ever stored or logged, and a code is never returned by any response.
 */
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 3600000;
export const DEFAULT_TEST_OTP = '123456';

export type OtpEnv = {OTP_PROVIDER?: string; RESIDENT_TEST_OTP?: string};
export type OtpMode = {mode: 'test'; code: string} | {mode: 'provider'; provider: string};

/**
 * THE test-OTP switch. No SMS/WhatsApp provider is connected yet, so while OTP_PROVIDER is unset (or 'test') the server runs in TEST OTP MODE:
 * it accepts the fixed code RESIDENT_TEST_OTP (default 123456) for every mobile number. To go live, set OTP_PROVIDER and implement the matching
 * branch of deliverOtp(); nothing else in the sign-in flow changes. Do not run a production deployment in test mode.
 */
export function residentOtpMode(env: OtpEnv): OtpMode {
 const provider = (env.OTP_PROVIDER ?? '').trim();
 if (!provider || provider.toLowerCase() === 'test') {
  const configured = (env.RESIDENT_TEST_OTP ?? '').trim();
  return {mode: 'test', code: /^\d{6}$/.test(configured) ? configured : DEFAULT_TEST_OTP};
 }
 return {mode: 'provider', provider};
}

/** Delivery hook for real providers. Receives the plain code only for the duration of the call; must not log it. */
export type OtpDeliver = (provider: string, mobile: string, code: string) => Promise<void>;
export const deliverOtp: OtpDeliver = async provider => {
 throw new ServiceError(`OTP delivery provider "${provider}" is not implemented. Unset OTP_PROVIDER to use test OTP mode.`, 503);
};

export type OtpRecord = {mobileHash: string; codeHash: string; expires: number; attempts: number; lastSent: number; sends: number; windowStart: number};
export interface OtpStore {
 get(mobileHash: string): Promise<OtpRecord | null>;
 put(record: OtpRecord): Promise<void>;
 /** Atomically count one attempt against a live, unlocked challenge. false when it is expired, locked or gone. */
 claimAttempt(mobileHash: string, now: number): Promise<boolean>;
 /** Atomically spend the challenge (replay protection). false when another request already spent it. */
 consume(mobileHash: string, codeHash: string): Promise<boolean>;
}

/** Strips spaces, dashes, +91 / 91 and a leading 0, then requires a 10-digit Indian mobile (^[6-9]\d{9}$). */
export function normalizeMobile(raw: unknown): string {
 const bad = new ServiceError('Enter a valid 10-digit Indian mobile number.');
 if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).length > 24) throw bad;
 let d = String(raw).replace(/[\s\-().]/g, '');
 if (d.startsWith('+91')) d = d.slice(3);
 else if (/^91\d{10}$/.test(d)) d = d.slice(2);
 else if (/^0\d{10}$/.test(d)) d = d.slice(1);
 if (!/^[6-9]\d{9}$/.test(d)) throw bad;
 return d;
}
export const mobileHashOf = (mobile: string) => digest(`samadhan-mobile:${mobile}`);
/** Deterministic resident id: the same mobile number is always the same resident. */
export const residentIdOf = async (mobile: string) => `res-${(await digest(`samadhan-resident:${mobile}`)).slice(0, 24)}`;
const codeHashOf = (mobileHash: string, code: string) => digest(`samadhan-otp:${mobileHash}:${code}`);

function randomCode() {const buf = new Uint32Array(1); crypto.getRandomValues(buf); return String(100000 + buf[0] % 900000);}

/** Issues a challenge: 6 digits, 5-minute expiry, 60-second resend cooldown, at most 5 sends per mobile per hour. */
export async function sendOtp(store: OtpStore, mobile: string, now: number, env: OtpEnv, deliver: OtpDeliver = deliverOtp) {
 const mode = residentOtpMode(env), mobileHash = await mobileHashOf(mobile), previous = await store.get(mobileHash);
 if (previous && now - previous.lastSent < OTP_RESEND_SECONDS * 1000) {
  const wait = Math.max(1, Math.ceil((previous.lastSent + OTP_RESEND_SECONDS * 1000 - now) / 1000));
  throw new ServiceError(`Wait ${wait} seconds before requesting another code.`, 429, wait);
 }
 const fresh = !previous || now - previous.windowStart >= HOUR_MS;
 const sends = fresh ? 1 : previous.sends + 1, windowStart = fresh ? now : previous.windowStart;
 // The hourly cap protects a paid SMS/WhatsApp provider; test OTP mode sends nothing, so it must not block testing.
 if (mode.mode !== 'test' && sends > OTP_MAX_SENDS_PER_HOUR) {
  const wait = Math.max(1, Math.ceil((windowStart + HOUR_MS - now) / 1000));
  throw new ServiceError('Too many codes requested for this number. Try again later.', 429, wait);
 }
 const code = mode.mode === 'test' ? mode.code : randomCode();
 if (mode.mode === 'provider') await deliver(mode.provider, mobile, code);
 await store.put({mobileHash, codeHash: await codeHashOf(mobileHash, code), expires: now + OTP_TTL_SECONDS * 1000, attempts: 0, lastSent: now, sends, windowStart});
 return {ok: true as const, expiresIn: OTP_TTL_SECONDS, retryAfter: OTP_RESEND_SECONDS};
}

/** Verifies and spends a challenge. 400 wrong or expired code; 429 once five wrong codes locked the challenge (even for the correct code). */
export async function verifyOtp(store: OtpStore, mobile: string, code: unknown, now: number) {
 const mobileHash = await mobileHashOf(mobile), record = await store.get(mobileHash);
 const expired = () => new ServiceError('This code has expired or was never requested. Request a new code.');
 const locked = () => new ServiceError('Too many incorrect attempts. Request a new code.', 429, Math.max(0, Math.ceil(((record?.lastSent ?? now) + OTP_RESEND_SECONDS * 1000 - now) / 1000)) || undefined);
 if (!record) throw expired();
 if (record.attempts >= OTP_MAX_ATTEMPTS) throw locked();
 if (record.expires <= now) throw expired();
 if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw new ServiceError('Enter the 6-digit code.');
 if (!await store.claimAttempt(mobileHash, now)) {
  const latest = await store.get(mobileHash);
  if (latest && latest.attempts >= OTP_MAX_ATTEMPTS) throw locked();
  throw expired();
 }
 if (await codeHashOf(mobileHash, code.trim()) !== record.codeHash) {
  if (record.attempts + 1 >= OTP_MAX_ATTEMPTS) throw locked();
  throw new ServiceError(`Incorrect code. ${OTP_MAX_ATTEMPTS - record.attempts - 1} attempts left.`);
 }
 if (!await store.consume(mobileHash, record.codeHash)) throw new ServiceError('This code was already used. Request a new code.');
 return {mobileHash};
}
