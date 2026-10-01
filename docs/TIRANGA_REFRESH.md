# Tiranga and splash update — 1 October 2026

The citizen app and admin portal use saffron, white, green and navy accents, with refreshed home cards, navigation, typography and onboarding.

The supplied `Splash.jpg` is bundled unchanged as the default launch artwork. The in-app splash fades in and gently zooms, respects reduced-motion preferences, and displays the complete image without cropping. The native operating-system launch screen uses the SAMADHAN logo before the configurable in-app splash.

Admins with `settings.manage` can open **Settings → App splash screen**, upload an image, preview it and select **Publish splash screen**. **Restore supplied image**, followed by publishing, reinstates the bundled artwork. Configuration is stored on the server; replacement images are stored in R2. The branding endpoint only exposes the currently selected splash image before sign-in; ordinary uploaded photos remain protected.

Verified: mobile TypeScript and Expo lint; root TypeScript; 17 workflow/community tests; branding upload, publication, pre-login image retrieval, invalid-image rejection, private-photo protection and restoration integration checks; production web build; Android/iOS JavaScript exports. Native device and store-release verification remain pending.
