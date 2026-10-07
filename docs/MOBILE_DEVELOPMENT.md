# Citizen app development

The source of the reviewable mobile app is `mobile/src`. `mobile/src/App.tsx` handles home, lists, detail and notices; `Onboarding.tsx` handles the clearly labeled test onboarding; `ReportFlow.tsx` handles the three-step complaint form.

## Local review

From the repository root:

```powershell
npm install
cd mobile
npm install
cd ..
node scripts/mobile-web.mjs
npm run dev
```

Open the URL printed by the web server. The root goes to the citizen app. The supporting admin portal is `/admin`.

For a fresh local browser, visit `/signin-with-chatgpt?return_to=/app/` once to establish the starter's loopback-only mock workspace identity. This is separate from the citizen's simulated phone sign-in. It is never real resident authentication.

For a new checkout, build once (`npm run build`), then apply the generated local migration:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_red_wolverine.sql
```

Do not replay an already-applied local migration. Sites applies hosted migrations during publication.

## Android and iOS development

```powershell
cd mobile
npx expo start
```

Use a matching Expo Go development environment or create a development build. Set the test API URL to the local portal; generate a resident-only token in `/admin` → Settings. Android emulator uses `http://10.0.2.2:5173`; an iOS simulator on the same Mac uses localhost. On a physical device use a LAN address and explicitly start the portal with `npm run dev -- --host 0.0.0.0`. Use test data only.

The owner-private hosted Site is a browser review surface; its outer sign-in gate does not expose a public native API. Production mobile needs a separately accessible authenticated API and genuine resident sessions.

`app.config.js` is the active Expo configuration. EAS preview and production profiles are included, but building signed binaries requires the owner's Expo/Apple/Google accounts and a reviewed application identifier. Current `in.samadhan.citizen` identifiers are development placeholders.

## Build and verification

```powershell
# root
node node_modules/typescript/bin/tsc --noEmit
node --test tests/workflow.test.mjs
node tests/api-smoke.mjs
node scripts/mobile-web.mjs

# mobile
node node_modules/typescript/bin/tsc --noEmit
npx expo export --platform all --output-dir native-dist
```

The smoke test creates clearly marked synthetic test records in the local mock workspace. It is not intended for production.

The preview build copies the canonical `shared/domain.ts` into `mobile/shared/domain.ts`, exports the same native app for web, and installs it under `public/mobile-app`. Do not hand-edit the exported bundles. Native data lives on the backend; SecureStore only retains the pairing credential. Onboarding test-profile state lasts for the current preview session.

Expo APIs used: [ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/), [Location](https://docs.expo.dev/versions/latest/sdk/location/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [web export subpaths](https://docs.expo.dev/more/expo-cli/#hosting-with-sub-paths).
