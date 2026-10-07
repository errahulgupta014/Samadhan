import {ApiError} from './api';
import type {Translate} from './labels';

export const blockedText = (t: Translate) => t('Your account has been blocked. Please contact the ward office.', 'आपका खाता ब्लॉक कर दिया गया है। कृपया वार्ड कार्यालय से संपर्क करें।');

/** Resident-facing message for any failure. Server messages (4xx) are shown as sent; connection and server faults get a friendly line in both languages. */
export function errorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code === 'account_blocked') return blockedText(t);
    if (error.kind === 'network') return t('Could not reach SAMADHAN. Check your internet connection and try again.', 'SAMADHAN से संपर्क नहीं हो सका। इंटरनेट कनेक्शन जांचें और फिर से प्रयास करें।');
    if (error.kind === 'timeout') return t('The request took too long. Please try again.', 'अनुरोध में बहुत समय लगा। कृपया फिर से प्रयास करें।');
    if (error.status >= 500) return t('Something went wrong on our side. Please try again in a moment.', 'हमारी ओर से कुछ गड़बड़ हुई। कृपया थोड़ी देर बाद फिर से प्रयास करें।');
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : t('Something went wrong. Please try again.', 'कुछ गड़बड़ हुई। कृपया फिर से प्रयास करें।');
}
