// Dynamic Expo config. Identity and branding live in app.json (name, slug, version, icon, scheme ...) and arrive here as `config`,
// so the two files are one config, not two competing ones. Everything native/plugin related is defined below.
module.exports = ({ config }) => ({
 ...config,
 ios: {
  ...config.ios,
  supportsTablet: true,
  bundleIdentifier: 'in.samadhan.citizen',
  infoPlist: { NSLocationWhenInUseUsageDescription: 'Use your location only when you report a civic issue.' },
 },
 android: {
  ...config.android,
  package: 'in.samadhan.citizen',
  adaptiveIcon: { foregroundImage: './assets/samadhan-logo.png', backgroundColor: '#ffffff' },
 },
 web: { ...config.web, favicon: './assets/samadhan-logo.png', bundler: 'metro' },
 experiments: { ...config.experiments, baseUrl: '/app' },
 extra: {
  ...config.extra,
  // Portal origin the native app talks to (see mobile/src/api.ts). On web the app always uses the origin it is served from.
  // Set EXPO_PUBLIC_API_URL for builds; without it the native dev defaults apply (10.0.2.2:5173 on Android, localhost:5173 elsewhere).
  apiUrl: process.env.EXPO_PUBLIC_API_URL || undefined,
  // EAS project id: required for Expo push tokens. Without it the app simply skips push registration.
  eas: process.env.EAS_PROJECT_ID ? { ...config.extra?.eas, projectId: process.env.EAS_PROJECT_ID } : config.extra?.eas,
 },
 plugins: [
  'expo-font',
  // Native launch screen. The first frame of BrandedSplash (mobile/src/Brand.tsx) must match it exactly, so keep
  // imageWidth === SPLASH_LOGO_SIZE and backgroundColor === SPLASH_BG there. splash-logo.png is a 640px optimised copy of the logo
  // (the original is 1254px / 662KB). Android 12+ clips the icon to a circle, which 160dp keeps clear of the wordmark.
  ['expo-splash-screen', { image: './assets/splash-logo.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#FFFEFA' }],
  'expo-router',
  'expo-notifications',
  'expo-secure-store',
  ['expo-image-picker', { photosPermission: 'Choose a profile photo or attach photos to your civic complaint.', cameraPermission: 'Take your profile photo or a photo of the civic issue you are reporting.', microphonePermission: false }],
  ['expo-location', { locationWhenInUsePermission: 'Use your location only when reporting a civic issue.' }],
 ],
});
