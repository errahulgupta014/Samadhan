/** The administrator session cookie: httpOnly, SameSite=Lax, Path=/, Secure on https, 12 hours (renewed on activity). The value is an opaque random token; only its SHA-256 is stored server-side. */
export const ADMIN_COOKIE = 'samadhan_admin';
export const ADMIN_COOKIE_MAX_AGE = 12 * 3600;

/** The raw value of the admin cookie, or null when the browser sent none (a present but malformed value is returned as is and fails validation later). */
export function adminTokenOf(request: Pick<Request, 'headers'>): string | null {
 const header = request.headers.get('cookie');
 if (!header) return null;
 for (const part of header.split(';')) {
  const index = part.indexOf('=');
  if (index > 0 && part.slice(0, index).trim() === ADMIN_COOKIE) return part.slice(index + 1).trim();
 }
 return null;
}
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean) {
 return `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}${secure ? '; Secure' : ''}`;
}
export const clearedCookie = (secure: boolean) => `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
export const isSecureRequest = (request: Pick<Request, 'url' | 'headers'>) => new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
