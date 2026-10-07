import {
  Text,
  Pressable,
  Button,
  Chip,
  Glyph,
  Icon,
  IconTile,
  CountBadge,
  LanguageToggle,
  FontsReady,
  CivicWatermark,
  Notice,
  StatusBadge,
  barSurface,
  cardSurface,
  colors,
  glass,
  radius,
  raised,
  rgba,
  textStyles,
  typeScale,
} from './Design';
import {useFonts} from 'expo-font';
import {Poppins_400Regular} from '@expo-google-fonts/poppins/400Regular';
import {Poppins_500Medium} from '@expo-google-fonts/poppins/500Medium';
import {Poppins_600SemiBold} from '@expo-google-fonts/poppins/600SemiBold';
import {Poppins_700Bold} from '@expo-google-fonts/poppins/700Bold';
import CommunityDetail, {ActivityDetail} from './CommunityDetail';
import BackHome from './BackHome';
import HomeScreen from './HomeScreen';
import {TirangaBand, BrandedSplash, WorkspaceLoading, hideNativeSplash, SPLASH_INIT_CAP_MS} from './Brand';
import * as SplashScreen from 'expo-splash-screen';
import {getBrandingCache, fetchBranding} from './branding';
import {router, useLocalSearchParams} from 'expo-router';
import Constants from 'expo-constants';
import {CommunityScreen} from './CommunityScreens';
import Auth from './Auth';
import Inbox from './Inbox';
import ReportFlow from './ReportFlow';
import WardUpdates from './Notices';
import {MaintenanceBanner, UpdateRequired} from './StatusScreens';
import {AppConfigContext} from './appConfigContext';
import {configSignature, maintenanceMessage, resolveSection, sanitizeAppConfig, sectionAvailable, updateRequired, visibleUnread} from './appConfig';
import {
  COMPLAINT_FILTERS,
  categoryLabel,
  filterLabel,
  formatDateTime,
  statusLabel,
  translator,
  type IconName,
} from './labels';
import React, {useCallback, useEffect, useMemo, useState, useRef} from 'react';
import {
  View,
  ScrollView,
  Image,
  StyleSheet,
  AppState,
  ActivityIndicator,
  Platform,
  RefreshControl,
  KeyboardAvoidingView,
  Animated,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {defaultAppConfig, type AppConfig, type Workspace, type Complaint, type IssueCategory} from '../shared/domain';
import {ApiError, fetchPublicConfig, getApiBase, logoutRemote, mediaSource, onUnauthorized, request, type Connection} from './api';
import {clearPushToken, clearSession, loadConfigCache, loadLanguage, loadSession, saveConfigCache, saveLanguage, saveSession} from './session';
import {blockedText, errorText} from './errors';
import {MediaImage, clearMediaCache} from './MediaImage';
import {registerPush, setAppBadge, unregisterPush, usePushEvents, type PushTarget} from './notifications';

// Keep the native launch screen (same logo, same background) up at module load; Brand.hideNativeSplash() releases it once BrandedSplash's first frame has laid out.
SplashScreen.preventAutoHideAsync().catch(() => {});
// The launch animation plays once per launch, even if this route remounts.
let launchSplashPlayed = false;
/** Installed app version (app.json "version"), compared with appConfig.minAppVersion. Empty when unknown, which never blocks. */
const INSTALLED_VERSION = Constants.expoConfig?.version ?? '';
/** How often the pre-login configuration is refreshed while there is no signed-in workspace (maintenance and minimum version stay current). */
const PUBLIC_CONFIG_REFRESH_MS = 5 * 60 * 1000;
/** How often a signed-in workspace is re-fetched while the app is in the foreground. */
const WORKSPACE_REFRESH_MS = 30 * 1000;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <StatusBar style="dark" />
        <CitizenApp />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type TabKey = 'home' | 'complaints' | 'classifieds' | 'activities' | 'city' | 'profile';

const TABS: {key: TabKey; icon: IconName; iconActive: IconName; en: string; hi: string}[] = [
  {key: 'home', icon: 'home-outline', iconActive: 'home', en: 'Home', hi: 'होम'},
  {key: 'complaints', icon: 'document-text-outline', iconActive: 'document-text', en: 'Complaints', hi: 'शिकायतें'},
  {key: 'classifieds', icon: 'pricetags-outline', iconActive: 'pricetags', en: 'Ads', hi: 'विज्ञापन'},
  {key: 'activities', icon: 'calendar-outline', iconActive: 'calendar', en: 'Activities', hi: 'गतिविधियाँ'},
  {key: 'city', icon: 'compass-outline', iconActive: 'compass', en: 'City', hi: 'शहर'},
  {key: 'profile', icon: 'person-outline', iconActive: 'person', en: 'Profile', hi: 'प्रोफ़ाइल'},
];

/** Detail screens that sit under a bottom tab: where Back falls back to without history, and which tab stays highlighted. */
const DETAIL_PARENT: Record<string, TabKey> = {'ad-detail': 'classifieds', 'activity-detail': 'activities', 'place-detail': 'city'};

const isOpenStatus = (status: string) => !['Closed', 'Resolution Proposed', 'Rejected / Duplicate'].includes(status);

function CitizenApp() {
  const [fontsLoaded, fontError] = useFonts({Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold});
  const [splashGone, setSplashGone] = useState(launchSplashPlayed);
  const [capped, setCapped] = useState(false);
  const [reveal] = useState(() => new Animated.Value(launchSplashPlayed ? 1 : 0));
  const [apiBase] = useState(getApiBase);
  // The signed-in session. connectionRef mirrors it for callbacks that outlive a render (401 handler, push, refresh).
  const [connection, setConnection] = useState<Connection | null>(null);
  const connectionRef = useRef<Connection | null>(null);
  const sessionGeneration = useRef(0);
  const versionRef = useRef(0);
  const [data, setData] = useState<Workspace | null>(null);
  // Remote app configuration. Signed in: the copy inside the workspace (refreshed with every workspace load). Otherwise the last good
  // public copy: cached in storage, refreshed in the background, defaults until one exists. It never blocks startup.
  const [knownConfig, setKnownConfig] = useState<AppConfig>(defaultAppConfig);
  const configFresh = useRef(false);
  const workspaceConfig = data?.settings.appConfig;
  const workspaceConfigKey = workspaceConfig ? configSignature(sanitizeAppConfig(workspaceConfig)) : '';
  // Re-reading our own serialisation keeps the object identity stable until the configuration actually changes.
  const config = useMemo(() => (workspaceConfigKey ? (JSON.parse(workspaceConfigKey) as AppConfig) : knownConfig), [workspaceConfigKey, knownConfig]);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });
  const [workspaceSettled, setWorkspaceSettled] = useState(false);
  const [initSettled, setInitSettled] = useState(false);
  const [splashImage, setSplashImage] = useState<string | null | undefined>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [accountBlocked, setAccountBlocked] = useState(false);
  const [loadError, setLoadError] = useState('');
  const fontsSettled = fontsLoaded || !!fontError;
  const ready = capped || (initSettled && fontsSettled);
  const params = useLocalSearchParams<{section?: string; id?: string}>();
  const requestedPage = params.section || 'home';
  // A switched-off or unknown section (old deep link, stale history, a tab hidden while it was open) shows Home instead.
  const page = resolveSection(config, requestedPage);
  const navigationHistory = useRef<{section: string; id: string}[]>([]);
  const setPage = (requested: string, requestedId = '') => {
    const screen = resolveSection(config, requested);
    const id = screen === requested ? requestedId : '';
    if (screen === page && id === (params.id ?? '')) return;
    if (screen === 'home') navigationHistory.current = [];
    else navigationHistory.current.push({section: page, id: params.id ?? ''});
    router.setParams({section: screen, id});
  };
  const goBack = () => {
    const previous = navigationHistory.current.pop() ?? {section: DETAIL_PARENT[page] ?? 'home', id: ''};
    router.setParams(previous);
    setError('');
  };
  const activeTab = DETAIL_PARENT[page] ?? page;
  const [filter, setFilter] = useState('All');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hindi, setHindi] = useState(false);
  const [selected, setSelected] = useState('');
  // Bumped by pull-to-refresh so an open report flow fetches its departments and categories again.
  const [catalogToken, setCatalogToken] = useState(0);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const t = translator(hindi);
  const residentName = data?.profile?.name ?? '';
  const unread = data?.unread ?? {complaints: 0, classifieds: 0, activities: 0, total: 0};

  // Counts every workspace the app has adopted, so a slow background refresh never overwrites the newer answer of an action.
  const appliedCount = useRef(0);
  function applyWorkspace(next: Workspace, version: number) {
    appliedCount.current++;
    setData(next);
    versionRef.current = version;
  }

  /**
   * Fetches the workspace with `c`: the server is the single source of truth, so whatever it returns replaces the local copy.
   * `adoptLanguage` applies the resident's saved language (first load of a session only). `background` marks the timer / foreground
   * refreshes: those are dropped when an action already delivered newer data while they were in flight.
   */
  async function load(c: Connection, adoptLanguage = false, background = false) {
    const generation = sessionGeneration.current;
    const seen = appliedCount.current;
    const r = await request(c);
    if (generation !== sessionGeneration.current) return;
    if (background && appliedCount.current !== seen) return;
    applyWorkspace(r.data, r.version);
    if (adoptLanguage && r.data.profile?.language) {
      const resident = r.data.profile.language === 'hi';
      setHindi(resident);
      void saveLanguage(resident);
    }
  }

  /** Drops the local session (state, stored token, cache, app badge). `expired` shows the "session ended" note on the login screen. */
  const endSession = useCallback((expired: boolean | 'blocked' = false) => {
    setKnownConfig(configRef.current);
    sessionGeneration.current++;
    connectionRef.current = null;
    versionRef.current = 0;
    navigationHistory.current = [];
    void clearSession();
    void clearPushToken();
    clearMediaCache();
    void setAppBadge(0);
    setConnection(null);
    setData(null);
    setSelected('');
    setFilter('All');
    setError('');
    setLoadError('');
    setSessionExpired(expired === true);
    setAccountBlocked(expired === 'blocked');
    router.setParams({section: 'home', id: ''});
  }, []);

  // Any 401 on the current session (workspace, uploads, categories) signs the resident out and shows the login screen.
  useEffect(() => {
    onUnauthorized((token, reason) => {
      if (connectionRef.current?.token === token) endSession(reason === 'blocked' ? 'blocked' : true);
    });
    return () => onUnauthorized(null);
  }, [endSession]);

  // Public configuration (GET /api/app-config) while no workspace is loaded: once at start, again whenever the app returns to the
  // foreground and every few minutes, so maintenance mode and the minimum version also reach residents who are not signed in.
  // A failure (offline, older server) keeps the cached or default configuration.
  const hasWorkspace = !!data;
  const refreshPublicConfig = useCallback(async () => {
    try {
      const result = await fetchPublicConfig(apiBase);
      configFresh.current = true;
      setKnownConfig(current => (configSignature(current) === configSignature(result.appConfig) ? current : result.appConfig));
      void saveConfigCache(apiBase, result.appConfig);
    } catch {
      // Unreachable or no such endpoint yet: nothing to change.
    }
  }, [apiBase]);
  useEffect(() => {
    if (hasWorkspace || !apiBase) return;
    // The effect only starts a network request; its answer arrives asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPublicConfig();
    const timer = setInterval(() => void refreshPublicConfig(), PUBLIC_CONFIG_REFRESH_MS);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshPublicConfig();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [hasWorkspace, apiBase, refreshPublicConfig]);
  // The workspace copy is the freshest: remember it for the next cold start (offline, or before the first fetch answers).
  useEffect(() => {
    if (workspaceConfigKey) void saveConfigCache(apiBase, JSON.parse(workspaceConfigKey) as AppConfig);
  }, [workspaceConfigKey, apiBase]);
  // Tidy the address bar when the requested section is not available (the screen itself already shows Home).
  useEffect(() => {
    if (hasWorkspace && requestedPage !== page) router.setParams({section: page, id: ''});
  }, [hasWorkspace, requestedPage, page]);

  // Startup. Nothing here sets the splash duration: BrandedSplash owns the minimum, the cap below owns the maximum.
  useEffect(() => {
    let alive = true;
    // Branding is cosmetic and never blocks the app. splashImage: null = resolving, undefined = bundled artwork, string = admin artwork.
    async function loadBranding(base: string) {
      try {
        const cached = base ? await getBrandingCache(base) : undefined;
        if (alive) setSplashImage(cached);
        if (!base) return;
        const fresh = await fetchBranding(base);
        if (alive) setSplashImage(fresh);
      } catch {
      } finally {
        if (alive) setSplashImage(current => (current === null ? undefined : current));
      }
    }
    async function init() {
      const branding = loadBranding(apiBase);
      try {
        const [saved, language, cachedConfig] = await Promise.all([loadSession(), loadLanguage(), loadConfigCache(apiBase)]);
        if (language !== null && alive) setHindi(language);
        if (cachedConfig && alive && !configFresh.current) setKnownConfig(cachedConfig);
        if (saved && alive) {
          connectionRef.current = saved;
          setConnection(saved);
          try {
            await load(saved, true);
          } catch (e) {
            // A 401 or a blocked account (403 account_blocked) already ended the session through the handler; any other failure keeps it and offers a retry.
            if (alive && !(e instanceof ApiError && (e.status === 401 || e.code === 'account_blocked'))) setLoadError(errorText(e, translator(language ?? false)));
          }
        }
      } catch {
        // Storage trouble: continue as signed out.
      } finally {
        if (alive) setWorkspaceSettled(true);
      }
      await branding;
      if (alive) setInitSettled(true);
    }
    void init();
    return () => {
      alive = false;
    };
    // Startup runs once; load() only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hard cap: release the ready gate even if fonts, branding or the workspace are still pending (the workspace keeps loading in the background).
  useEffect(() => {
    if (splashGone) return;
    const timer = setTimeout(() => setCapped(true), SPLASH_INIT_CAP_MS);
    const safety = setTimeout(hideNativeSplash, SPLASH_INIT_CAP_MS + 2000);
    // Last resort if the splash overlay itself ever fails to finish: show the app instead of an invisible one.
    const force = setTimeout(() => {
      reveal.setValue(1);
      launchSplashPlayed = true;
      setSplashGone(true);
    }, SPLASH_INIT_CAP_MS + 6000);
    return () => {
      clearTimeout(timer);
      clearTimeout(safety);
      clearTimeout(force);
    };
  }, [splashGone, reveal]);

  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Runs a workspace action as the signed-in resident. The workspace version is a single counter, so when someone else changed
   * the workspace first (409) the app refreshes the version and retries once: nothing was applied by the rejected attempt.
   */
  async function act(body: Record<string, unknown>) {
    const c = connectionRef.current;
    if (!c) throw new ApiError('Please log in again.', {status: 401});
    const generation = sessionGeneration.current;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await request(c, {...body, version: versionRef.current, view: 'resident'});
        if (generation === sessionGeneration.current) applyWorkspace(r.data, r.version);
        return r;
      } catch (e) {
        const failure = e as ApiError;
        if (generation !== sessionGeneration.current) throw e;
        if (failure.data && failure.version) applyWorkspace(failure.data, failure.version);
        if (failure.status === 409 && attempt === 0) {
          await load(c);
          continue;
        }
        throw e;
      }
    }
  }

  /** Login or registration succeeded: verify the token by loading the workspace, store the session and open Home. */
  async function startSession(token: string, isNewResident: boolean) {
    const c: Connection = {url: apiBase, token};
    const r = await request(c);
    await saveSession(c);
    sessionGeneration.current++;
    connectionRef.current = c;
    navigationHistory.current = [];
    applyWorkspace(r.data, r.version);
    setSelected('');
    setError('');
    setLoadError('');
    setSessionExpired(false);
    setAccountBlocked(false);
    router.setParams({section: 'home', id: ''});
    setConnection(c);
    if (isNewResident) {
      // The language picked on the welcome screen becomes the saved preference of the new resident.
      if (r.data.profile && r.data.profile.language !== (hindi ? 'hi' : 'en')) void act({action: 'save-profile', profile: {language: hindi ? 'hi' : 'en'}}).catch(() => {});
    } else if (r.data.profile?.language) {
      const resident = r.data.profile.language === 'hi';
      setHindi(resident);
      void saveLanguage(resident);
    }
  }

  function changeLanguage(next: boolean) {
    setHindi(next);
    void saveLanguage(next);
    if (connectionRef.current && data) void act({action: 'save-profile', profile: {language: next ? 'hi' : 'en'}}).catch(() => {});
  }

  async function logout() {
    const c = connectionRef.current;
    if (!c) return;
    await unregisterPush(token => act({action: 'unregister-push', token}));
    try {
      await logoutRemote(c);
    } catch (e) {
      // An already-invalid session is as good as logged out; anything else (offline, server error) leaves the resident signed in to retry.
      if (!(e instanceof ApiError && e.status === 401)) throw new Error(e instanceof ApiError && e.kind !== 'http' ? errorText(e, t) : t('Logout failed. Please try again.', 'लॉग आउट नहीं हो सका। कृपया फिर से प्रयास करें।'));
    }
    endSession(false);
  }

  // Keep everything in step with the admin portal: every 30 s while the app is in the foreground (one request, skipped in the
  // background or while the previous one is still running), whenever the app returns to the foreground, and when a push arrives.
  const refreshing = useRef(false);
  const refresh = useCallback(() => {
    const c = connectionRef.current;
    if (!c || refreshing.current) return;
    refreshing.current = true;
    void load(c, false, true)
      .catch(() => {})
      .finally(() => {
        refreshing.current = false;
      });
    // load() only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!connection) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, WORKSPACE_REFRESH_MS);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [connection, refresh]);

  const signedIn = !!connection && !!data;

  const c = data?.complaints.find(item => item.id === selected);
  const openComplaintById = (id: string) => {
    setSelected(id);
    setPage('detail');
  };
  const openComplaint = (complaint: Complaint) => openComplaintById(complaint.id);

  // Phone push: register this device once per session, mirror the unread total on the app icon, and open the right screen on a tap.
  const pushedFor = useRef('');
  useEffect(() => {
    if (!connection || !data || pushedFor.current === connection.token) return;
    pushedFor.current = connection.token;
    void registerPush(token => act({action: 'register-push', token}));
    // act() is recreated every render and only reads refs; the guard above makes this run once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, data]);
  const unreadTotal = visibleUnread(data?.unread, config);
  useEffect(() => {
    if (signedIn) void setAppBadge(unreadTotal);
  }, [signedIn, unreadTotal]);
  usePushEvents({
    enabled: signedIn,
    onTap: (target: PushTarget) => {
      refresh();
      // A tap that targets a switched-off section (Ads / Activities hidden) opens the notifications inbox instead.
      if (target.kind === 'complaint') openComplaintById(target.complaintId);
      else if (target.kind === 'classified') setPage(sectionAvailable(config, 'ad-detail') ? 'ad-detail' : 'notifications', target.classifiedId);
      else if (target.kind === 'activity') setPage(sectionAvailable(config, 'activity-detail') ? 'activity-detail' : 'notifications', target.activityId);
      else setPage('notifications');
    },
    onReceive: refresh,
  });

  // Opening a complaint, an ad or an activity that has unread notifications marks them read, so the badges never lag behind what was seen.
  const autoRead = useRef(new Set<string>());
  useEffect(() => {
    if (!data?.notifications?.length) return;
    const targets = data.notifications.filter(
      n => !n.read && !autoRead.current.has(n.id) && ((page === 'detail' && !!n.complaintId && n.complaintId === selected) || (page === 'ad-detail' && !!n.classifiedId && n.classifiedId === params.id) || (page === 'activity-detail' && !!n.activityId && n.activityId === params.id)),
    );
    if (!targets.length) return;
    targets.forEach(n => autoRead.current.add(n.id));
    void (async () => {
      for (const n of targets) {
        try {
          await act({action: 'read-notification', id: n.id});
        } catch {
          return;
        }
      }
    })();
    // act() is recreated every render; autoRead guarantees each notification is attempted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, selected, params.id]);

  // The app tree is mounted under the launch splash as soon as the gate is ready and cross-fades in while the splash fades out (no instant swap).
  // CivicWatermark lives in the root below (outside KeyboardAvoidingView), so every screen below sits on top of it and keyboard resizes never squeeze it.
  const maintenance = maintenanceMessage(config, hindi);
  const screen = (() => {
    // An installed version below minAppVersion blocks everything, signed in or not.
    if (updateRequired(INSTALLED_VERSION, config.minAppVersion)) {
      return <UpdateRequired hindi={hindi} installed={INSTALLED_VERSION} required={config.minAppVersion} onToggleLanguage={() => changeLanguage(!hindi)} />;
    }
    if (!workspaceSettled) return <WorkspaceLoading />;
    if (!connection) {
      return (
        <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {maintenance ? <MaintenanceBanner message={maintenance} /> : null}
          <Auth
            hindi={hindi}
            setHindi={changeLanguage}
            brandingImage={splashImage}
            base={apiBase}
            notice={accountBlocked ? blockedText(t) : sessionExpired ? t('Your session has ended. Please log in again.', 'आपका सत्र समाप्त हो गया है। कृपया फिर से लॉग इन करें।') : undefined}
            onAuthenticated={startSession}
          />
        </KeyboardAvoidingView>
      );
    }
    return (
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TirangaBand />
        {maintenance ? <MaintenanceBanner message={maintenance} /> : null}
        <AppHeader hindi={hindi} onToggleLanguage={() => changeLanguage(!hindi)} />
        <ScrollView
          key={`${page}:${params.id ?? ''}`}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={data ? <RefreshControl refreshing={busy} onRefresh={() =>
                void perform(async () => {
                  setCatalogToken(n => n + 1);
                  await load(connection);
                })
              } colors={[colors.green]} tintColor={colors.green} /> : undefined}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!data ? (
            <View style={s.reconnect}>
              {loadError ? (
                <>
                  <IconTile name="cloud-offline-outline" size={56} tone="navy" />
                  <Text accessibilityRole="header" style={[s.h1, s.centered]}>
                    {t('We couldn’t load your ward', 'आपका वार्ड लोड नहीं हो सका')}
                  </Text>
                  <Notice tone="error">{loadError}</Notice>
                  <Button
                    variant="accent"
                    loading={busy}
                    disabled={busy}
                    title={t('Try again', 'फिर से प्रयास करें')}
                    style={s.fullWidth}
                    onPress={() =>
                      void perform(async () => {
                        setLoadError('');
                        try {
                          await load(connection, true);
                        } catch (e) {
                          if (!(e instanceof ApiError && (e.status === 401 || e.code === 'account_blocked'))) setLoadError(errorText(e, t));
                        }
                      })
                    }
                  />
                  <Button variant="secondary" title={t('Log in again', 'फिर से लॉग इन करें')} style={s.fullWidth} onPress={() => endSession(false)} />
                </>
              ) : (
                <ActivityIndicator color={colors.green} />
              )}
            </View>
          ) : (
            <>
              {page !== 'home' && page !== 'report' && <BackHome back={goBack} home={() => setPage('home')} hindi={hindi} />}
              {page === 'home' && <HomeScreen connection={connection} data={data} hindi={hindi} name={residentName} navigate={setPage} openComplaint={openComplaint} />}
              {page === 'complaints' && (
                <>
                  <Text accessibilityRole="header" style={s.h1}>
                    {t('My complaints', 'मेरी शिकायतें')}
                  </Text>
                  <View style={s.chips}>
                    {COMPLAINT_FILTERS.map(f => (
                      <Chip key={f} label={filterLabel(f, hindi)} selected={filter === f} onPress={() => setFilter(f)} />
                    ))}
                  </View>
                  <ComplaintList complaints={filteredComplaints(data.complaints, filter)} categories={data.categories} hindi={hindi} open={openComplaint} />
                </>
              )}
              {page === 'report' && (
                <ReportFlow
                  back={goBack}
                  home={() => setPage('home')}
                  connection={connection}
                  ward={data.ward}
                  hindi={hindi}
                  act={act}
                  refreshToken={catalogToken}
                  onSuccess={id => {
                    setSelected(id);
                    navigationHistory.current = navigationHistory.current.filter(p => p.section !== 'report');
                    router.setParams({section: 'detail'});
                  }}
                />
              )}
              {page === 'detail' && !c && (
                <View style={s.empty}>
                  <IconTile name="information-circle-outline" size={52} tone="navy" />
                  <Text style={s.emptyText}>{t('This complaint is no longer available.', 'यह शिकायत अब उपलब्ध नहीं है।')}</Text>
                </View>
              )}
              {page === 'detail' && c && (
                <ComplaintDetail
                  c={c}
                  categories={data.categories}
                  connection={connection}
                  hindi={hindi}
                />
              )}
              {(page === 'ad-detail' || page === 'place-detail') && (
                <CommunityDetail key={`${page}:${params.id}`} kind={page === 'ad-detail' ? 'ad' : 'place'} id={params.id} data={data} connection={connection} hindi={hindi} />
              )}
              {page === 'activity-detail' && <ActivityDetail key={params.id} id={params.id} data={data} connection={connection} hindi={hindi} />}
              {page === 'notifications' && <Inbox data={data} hindi={hindi} act={act} navigate={setPage} openComplaint={openComplaintById} />}
              {['profile', 'classifieds', 'activities', 'city'].includes(page) && (
                <CommunityScreen key={page} page={page} data={data} connection={connection} hindi={hindi} busy={busy} act={act} navigate={setPage} setLanguage={changeLanguage} logout={logout} />
              )}
              {page === 'notices' && <WardUpdates data={data} hindi={hindi} />}
            </>
          )}
          {busy && <ActivityIndicator style={s.spinner} color={colors.green} />}
        </ScrollView>
        {data && (
          <TabBar
            onHeight={setTabBarHeight}
            tabs={config.tabs}
            active={activeTab}
            hindi={hindi}
            badges={{complaints: unread.complaints, classifieds: unread.classifieds, activities: unread.activities ?? 0}}
            onSelect={key => {
              setPage(key);
              setError('');
            }}
          />
        )}
      </KeyboardAvoidingView>
    );
  })();

  return (
    <FontsReady.Provider value={fontsLoaded}>
      <AppConfigContext.Provider value={config}>
        <View style={s.root}>
          <CivicWatermark bottomInset={data && connection ? tabBarHeight : 0} />
          {ready || splashGone ? (
            <LaunchContent interactive={splashGone}>
              <Animated.View style={[s.fill, {opacity: reveal}]} aria-hidden={!splashGone} accessibilityElementsHidden={!splashGone} importantForAccessibility={splashGone ? 'auto' : 'no-hide-descendants'}>
                {screen}
              </Animated.View>
            </LaunchContent>
          ) : null}
          {!splashGone ? (
            <BrandedSplash
              imageUrl={splashImage}
              ready={ready}
              fontsSettled={fontsSettled}
              reveal={reveal}
              onFinish={() => {
                launchSplashPlayed = true;
                setSplashGone(true);
              }}
            />
          ) : null}
        </View>
      </AppConfigContext.Provider>
    </FontsReady.Provider>
  );
}

// Native a11y props do not suppress web keyboard focus. Keep the app inert until
// the launch overlay has actually exited, while allowing the visual cross-fade.
function LaunchContent({interactive, children}: {interactive: boolean; children: React.ReactNode}) {
  return Platform.OS === 'web' ? (
    <div inert={!interactive} style={{display: 'flex', flex: 1, minHeight: 0}}>
      {children}
    </div>
  ) : (
    <>{children}</>
  );
}

function filteredComplaints(complaints: Complaint[], filter: string) {
  return complaints.filter(item => filter === 'All' || (filter === 'Closed' ? item.status === 'Closed' : filter === 'To confirm' ? item.status === 'Resolution Proposed' : isOpenStatus(item.status)));
}

/* ------------------------------------------------------------ chrome */

function AppHeader({hindi, onToggleLanguage}: {hindi: boolean; onToggleLanguage: () => void}) {
  return (
    <View style={s.header}>
      <View style={s.brand}>
        <Image source={require('../assets/samadhan-logo.png')} style={s.headerLogo} resizeMode="contain" />
        <View style={s.flex}>
          <Text style={s.wordmark}>SAMADHAN</Text>
          <Text style={s.tagline}>जनता की बात, समाधान के साथ</Text>
        </View>
      </View>
      <LanguageToggle hindi={hindi} onPress={onToggleLanguage} />
    </View>
  );
}

function TabBar({tabs, active, hindi, onSelect, onHeight, badges}: {tabs: AppConfig['tabs']; active: string; hindi: boolean; onSelect: (key: TabKey) => void; onHeight: (height: number) => void; badges: Partial<Record<TabKey, number>>}) {
  // Phones narrower than 360 px give up the wider touch-target floor so six labels still fit unclipped.
  const compact = useWindowDimensions().width < 360;
  // Home, Complaints and Profile are always there; Ads, Activities and City follow the admin's switches (3 to 6 tabs).
  const visible = TABS.filter(tab => (tab.key === 'classifieds' || tab.key === 'activities' || tab.key === 'city' ? tabs[tab.key] : true));
  return (
    <View testID="tab-bar" onLayout={e => onHeight(e.nativeEvent.layout.height)} style={s.tabBar}>
      {visible.map(tab => {
        const selected = active === tab.key;
        const label = hindi ? tab.hi : tab.en;
        const count = badges[tab.key] ?? 0;
        const spoken = count > 0 ? `${label}, ${count} ${hindi ? 'अपठित' : 'unread'}` : label;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={spoken} accessibilityState={{selected}} style={[s.tab, compact && s.tabCompact, selected && s.tabActive]} onPress={() => onSelect(tab.key)}>
            <View style={s.tabIcon}>
              <Icon name={selected ? tab.iconActive : tab.icon} size={22} color={selected ? colors.navy : colors.textTertiary} />
              <CountBadge count={count} style={s.tabBadge} />
            </View>
            <Text style={[s.tabLabel, selected && s.tabLabelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------- complaints */

function ComplaintList({complaints, categories, hindi, open}: {complaints: Complaint[]; categories: IssueCategory[]; hindi: boolean; open: (c: Complaint) => void}) {
  if (!complaints.length) {
    return (
      <View style={s.empty}>
        <IconTile name="documents-outline" size={52} tone="green" />
        <Text style={s.emptyText}>{hindi ? 'इस सूची में अभी कोई शिकायत नहीं है।' : 'No complaints in this view yet.'}</Text>
      </View>
    );
  }
  return (
    <>
      {complaints.map(item => (
        <ComplaintCard key={item.id} c={item} categories={categories} hindi={hindi} open={() => open(item)} />
      ))}
    </>
  );
}

function ComplaintCard({c, categories, hindi, open}: {c: Complaint; categories: IssueCategory[]; hindi: boolean; open: () => void}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${c.title}. ${statusLabel(c.status, hindi)}`} style={s.card} onPress={open}>
      <View style={s.between}>
        <Text style={[s.caption, s.flex]}>{c.id}</Text>
        <StatusBadge status={c.status} hindi={hindi} />
      </View>
      <Text style={s.cardTitle}>{c.title}</Text>
      <View style={s.cardFoot}>
        <Icon name="location-outline" size={15} color={colors.textSecondary} />
        <Text style={[s.caption, s.flex]}>
          {categoryLabel(c, categories, hindi)} · {c.locality}
        </Text>
        <Glyph name="chevron-forward" size={18} color={colors.navy} />
      </View>
    </Pressable>
  );
}

type DetailProps = {
  c: Complaint;
  categories: IssueCategory[];
  connection: Connection;
  hindi: boolean;
};

function ComplaintDetail({c, categories, connection, hindi}: DetailProps) {
  const t = translator(hindi);
  const history = [...c.history].reverse();
  return (
    <>
      <View style={s.refCard}>
        <Text style={s.refLabel}>{t('REFERENCE NUMBER', 'शिकायत संख्या')}</Text>
        <Text selectable style={s.refId}>
          {c.id}
        </Text>
      </View>
      <Text accessibilityRole="header" style={s.h1}>
        {c.title}
      </Text>
      <View style={s.badgeRow}>
        <StatusBadge status={c.status} hindi={hindi} />
        <Text style={s.caption}>{categoryLabel(c, categories, hindi)}</Text>
      </View>
      <Text style={s.p}>{c.description}</Text>
      <View style={s.infoCard}>
        <InfoRow icon="location-outline" text={c.locality} strong />
        <InfoRow icon="people-outline" text={c.assignee || t('Awaiting team assignment', 'टीम का आवंटन प्रतीक्षित')} />
        <InfoRow icon="time-outline" text={`${t('Target', 'लक्ष्य समय')}: ${formatDateTime(c.dueAt, hindi)}`} />
      </View>
      <Text style={s.h2}>{t('Submitted evidence', 'जमा किए गए प्रमाण')}</Text>
      <Media ids={c.media} connection={connection} hindi={hindi} />
      <Text style={s.h2}>{t('After-work evidence', 'काम के बाद के प्रमाण')}</Text>
      <Media ids={c.afterMedia} connection={connection} hindi={hindi} />
      {c.status === 'Resolution Proposed' && (
        <View style={s.confirmCard}>
          <Text style={s.h2}>{t('Is the problem resolved?', 'क्या समस्या का समाधान हो गया?')}</Text>
          <Text style={s.p}>
            {t(
              'Your ward team says the work is complete. We have sent a closure OTP to your WhatsApp number. Share it with the ward officer only if the problem is fixed; the officer closes the complaint after entering it.',
              'वार्ड टीम के अनुसार काम पूरा हो गया है। आपके WhatsApp नंबर पर समाधान OTP भेजा गया है। समस्या ठीक होने पर ही इसे वार्ड अधिकारी को बताएं; OTP दर्ज करने के बाद अधिकारी शिकायत बंद करेंगे।',
            )}
          </Text>
        </View>
      )}
      <Text style={s.h2}>{t('Complaint timeline', 'शिकायत की टाइमलाइन')}</Text>
      {history.map((h, i) => (
        <View key={i} style={s.timelineRow}>
          <View style={s.rail}>
            <View style={[s.railDot, i === 0 ? s.railDotLatest : s.railDotPast]}>{i === 0 ? <Glyph name="check" size={12} color={colors.white} /> : null}</View>
            {i < history.length - 1 && <View style={s.railLine} />}
          </View>
          <View style={s.timelineCard}>
            <Text style={s.label}>{statusLabel(h.status, hindi)}</Text>
            <Text style={s.timelineNote}>{h.note}</Text>
            <Text style={s.caption}>
              {formatDateTime(h.at, hindi)} · {h.actor}
            </Text>
          </View>
        </View>
      ))}
    </>
  );
}

function InfoRow({icon, text, strong = false}: {icon: IconName; text: string; strong?: boolean}) {
  return (
    <View style={s.infoRow}>
      <Icon name={icon} size={18} color={colors.navy} />
      <Text style={[s.infoText, strong && s.infoStrong]}>{text}</Text>
    </View>
  );
}

function Media({ids, connection, hindi}: {ids: string[]; connection: Connection; hindi: boolean}) {
  return ids.length ? (
    <View style={s.photos}>
      {ids.map(id => (
        <View key={id} style={s.photoFrame}>
          <MediaImage
            accessibilityLabel={hindi ? 'शिकायत का प्रमाण' : 'Complaint evidence'}
            style={s.photo}
            source={mediaSource(connection, id)}
          />
        </View>
      ))}
    </View>
  ) : (
    <Text style={s.caption}>{hindi ? 'कोई फोटो नहीं जोड़ी गई।' : 'No photographs were added.'}</Text>
  );
}

const headerSurface = {
  backgroundColor: glass(0.94, colors.paper),
  borderBottomWidth: 2,
  borderBottomColor: colors.border,
  boxShadow: [
    {offsetX: 0, offsetY: 3, blurRadius: 10, spreadDistance: -5, color: rgba(colors.navy, 0.09)},
    {inset: true, offsetX: 0, offsetY: 1, blurRadius: 0, color: rgba(colors.white, 0.5)},
  ],
} as const;

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.paper},
  root: {flex: 1, backgroundColor: colors.paper, overflow: 'hidden'},
  fill: {flex: 1},
  flex: {flex: 1},
  header: {...headerSurface, paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, zIndex: 2},
  brand: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10},
  headerLogo: {width: 38, height: 38},
  wordmark: {fontSize: typeScale.titleMd.fontSize, fontWeight: '800', letterSpacing: 1, color: colors.navy},
  tagline: {fontSize: 12, letterSpacing: 0.4, color: colors.textSecondary, marginTop: 2},
  centered: {textAlign: 'center'},
  fullWidth: {alignSelf: 'stretch'},
  reconnect: {alignItems: 'center', gap: 14, paddingVertical: 36},
  content: {padding: 20, paddingBottom: 32},
  logo: {marginVertical: 25},
  h1: {...textStyles.h1, marginVertical: 13},
  h2: {...textStyles.h2, marginTop: 22, marginBottom: 12},
  p: {...textStyles.body, marginVertical: 9},
  caption: textStyles.caption,
  label: {...textStyles.label, marginBottom: 6},
  spinner: {margin: 16},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 15},
  between: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8},
  card: {...cardSurface(glass(0.9)), padding: 16, marginVertical: 7},
  cardTitle: {fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.navy, marginVertical: 12},
  cardFoot: {flexDirection: 'row', alignItems: 'center', gap: 6},
  empty: {alignItems: 'center', gap: 14, paddingVertical: 36},
  emptyText: {...textStyles.body, textAlign: 'center'},
  refCard: {...cardSurface(glass(0.9, colors.greenSoft), {radius: radius.md}), padding: 14, alignItems: 'center', marginBottom: 6},
  refLabel: {...textStyles.eyebrow, marginBottom: 4},
  refId: {fontSize: typeScale.titleSm.fontSize, lineHeight: 24, fontWeight: '700', color: colors.navy},
  badgeRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6},
  infoCard: {...cardSurface(glass(0.9)), padding: 16, gap: 12, marginTop: 14},
  infoRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  infoText: {...textStyles.body, flex: 1, marginVertical: 0, lineHeight: 21},
  infoStrong: {fontWeight: '600', color: colors.ink},
  confirmCard: {...cardSurface(glass(0.92, colors.saffronSoft)), padding: 18, marginTop: 24},
  photos: {flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 12},
  photoFrame: {...cardSurface(colors.white, {lip: 3, level: 'sm', radius: radius.md}), padding: 3},
  photo: {width: 100, height: 85, borderRadius: radius.sm},
  timelineRow: {flexDirection: 'row', gap: 12},
  rail: {alignItems: 'center', width: 20},
  railDot: {width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  railDotLatest: {...raised(colors.green, {lip: 2, level: 'sm'})},
  railDotPast: {backgroundColor: colors.inset, borderWidth: 2, borderColor: colors.borderStrong},
  railLine: {flex: 1, width: 3, borderRadius: 2, backgroundColor: colors.border, marginVertical: 3},
  timelineCard: {...cardSurface(glass(0.9), {lip: 2, level: 'sm', radius: radius.md}), flex: 1, padding: 13, marginBottom: 12},
  timelineNote: {...textStyles.body, marginVertical: 4},
  tabBar: {
    ...barSurface(colors.surface),
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 1,
  },
  // Six tabs on a 375 px phone: each tab is as wide as its label (flexBasis auto, so "Complaints" and "Activities" are never clipped) plus an equal share of the spare width, with a floor so short labels ("Ads", "City") keep a usable touch target (relaxed below 360 px so 320 px phones still fit).
  tab: {flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 48, alignItems: 'center', gap: 3, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 16, borderBottomWidth: 3, borderBottomColor: 'transparent'},
  tabCompact: {minWidth: 40},
  tabActive: {...raised(colors.saffronSoft, {lip: 3, level: 'sm'}), borderBottomColor: colors.saffron},
  tabIcon: {alignItems: 'center', justifyContent: 'center'},
  tabBadge: {position: 'absolute', top: -7, right: -16},
  tabLabel: {fontSize: 12, lineHeight: 16, fontWeight: '500', color: colors.textSecondary, textAlign: 'center'},
  tabLabelActive: {fontWeight: '600', color: colors.navy},
});
