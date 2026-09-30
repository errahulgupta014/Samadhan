module.exports = {
 expo: {
  name: 'SAMADHAN', slug: 'samadhan-citizen', version: '0.1.0', orientation: 'portrait',
  icon: './assets/samadhan-logo.png', userInterfaceStyle: 'light', scheme: 'samadhan',
  ios: { supportsTablet: true, bundleIdentifier: 'in.samadhan.citizen', infoPlist: {NSLocationWhenInUseUsageDescription: 'Use your location only when you report a civic issue.'} },
  android: { package: 'in.samadhan.citizen', adaptiveIcon: {foregroundImage:'./assets/samadhan-logo.png',backgroundColor:'#ffffff'} },
  web: {favicon:'./assets/samadhan-logo.png',bundler:'metro'}, experiments:{baseUrl:'/mobile-app'},
  plugins: ['expo-router','expo-notifications','expo-secure-store',['expo-image-picker',{photosPermission:'Attach photos to your civic complaint.',cameraPermission:'Take a photo of the civic issue.',microphonePermission:false}],['expo-location',{locationWhenInUsePermission:'Use your location only when reporting a civic issue.'}]]
 }
};
