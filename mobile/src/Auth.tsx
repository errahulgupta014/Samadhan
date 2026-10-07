import {Text, TextInput, Pressable, Button, Field, Icon, IconButton, IconTile, LanguageToggle, Notice, SelectionMark, StepDots, cardSurface, colors, glass, insetStyle, radius, textStyles, tricolour, typeScale} from './Design';
import {TirangaBand, Chakra, BrandingArt} from './Brand';
import {Avatar} from './Avatar';
import WardPicker from './WardPicker';
import {ApiError, cleanMobile, fetchWards, isValidMobile, registerResident, sendOtp, upload, verifyOtp} from './api';
import {errorText} from './errors';
import {pickPhoto} from './photo';
import {LegalLinks} from './Support';
import {translator, type IconName} from './labels';
import React, {useEffect, useRef, useState} from 'react';
import {View, Image, StyleSheet, ScrollView, type LayoutChangeEvent} from 'react-native';
import type {PublicWard} from '../shared/community';

type Props = {
  hindi: boolean;
  setHindi: (b: boolean) => void;
  brandingImage?: string | null;
  /** API base the OTP and registration calls go to. */
  base: string;
  /** Shown on the first screens, e.g. after the session expired. */
  notice?: string;
  /**
   * Called with the resident session token once login (registered number) or registration (new number) has succeeded.
   * Rejecting shows the error here; resolving hands over to the app (this screen unmounts).
   */
  onAuthenticated: (token: string, isNewResident: boolean) => Promise<void>;
};

type Step = 0 | 1 | 2 | 3;
type FieldKey = 'name' | 'ward' | 'email' | 'address' | 'photo' | 'consent';
type FieldErrors = Partial<Record<FieldKey, string>>;
type WardsState = {status: 'loading' | 'ready' | 'error'; list: PublicWard[]; message: string};

const FIELD_ORDER: FieldKey[] = ['name', 'ward', 'email', 'address', 'photo', 'consent'];
const FEATURE_TONES = ['saffron', 'navy', 'green'] as const;
const OTP_LENGTH = 6;
const DEFAULT_RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatMobile = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);

/**
 * Sign-in flow: language welcome -> mobile number -> OTP -> (new numbers only) registration form.
 * A registered number goes straight into the app after the OTP; the details form is only ever shown to a new resident.
 * The civic watermark is rendered by App (outside the KeyboardAvoidingView that wraps this screen), so this root is transparent.
 */
export default function Auth({hindi, setHindi, brandingImage, base, notice, onAuthenticated}: Props) {
  const t = translator(hindi);
  const [step, setStep] = useState<Step>(0);
  const [mobile, setMobile] = useState('');
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [otp, setOtp] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [sentTo, setSentTo] = useState(''); // the number the running cooldown belongs to
  const waiting = resendIn > 0 && sentTo === mobile;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [registrationToken, setRegistrationToken] = useState('');
  const [name, setName] = useState('');
  const [wardId, setWardId] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [photo, setPhoto] = useState<{id: string; uri: string} | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [wards, setWards] = useState<WardsState>({status: 'loading', list: [], message: ''});
  /** The ward list loaded but is empty: nobody can register until the administrators add a ward. */
  const noWards = wards.status === 'ready' && wards.list.length === 0;

  const scroller = useRef<ScrollView>(null);
  const formTop = useRef(0);
  const fieldTop = useRef<Partial<Record<FieldKey, number>>>({});

  useEffect(() => {
    scroller.current?.scrollTo({y: 0, animated: false});
  }, [step]);

  // Resend countdown: one tick per second until it reaches zero.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(n => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const track = (key: FieldKey) => (e: LayoutChangeEvent) => {
    fieldTop.current[key] = e.nativeEvent.layout.y;
  };
  const scrollToField = (key: FieldKey) => scroller.current?.scrollTo({y: Math.max(0, formTop.current + (fieldTop.current[key] ?? 0) - 16), animated: true});

  async function loadWards() {
    setWards(w => ({...w, status: 'loading', message: ''}));
    try {
      const list = await fetchWards(base);
      setWards({status: 'ready', list, message: ''});
      if (list.length === 1) setWardId(list[0].id);
    } catch (e) {
      setWards({status: 'error', list: [], message: errorText(e, t)});
    }
  }

  /* ---------------------------------------------------------- mobile + OTP */

  async function sendCode() {
    setError('');
    if (waiting) return;
    if (!isValidMobile(mobile)) {
      setError(t('Enter a valid 10-digit mobile number (it starts with 6, 7, 8 or 9).', 'मान्य 10 अंकों का मोबाइल नंबर दर्ज करें (यह 6, 7, 8 या 9 से शुरू होता है)।'));
      return;
    }
    setBusy(true);
    try {
      const result = await sendOtp(base, mobile);
      setSentTo(mobile);
      setOtp('');
      setResendIn(Math.max(1, Math.round(result.retryAfter || DEFAULT_RESEND_SECONDS)));
      setStep(2);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const wait = Math.max(1, Math.round(e.retryAfter || DEFAULT_RESEND_SECONDS));
        setSentTo(mobile);
        setResendIn(wait);
        const minutes = Math.ceil(wait / 60);
        setError(
          wait > 90
            ? t(`Too many OTP requests for this number. Please try again in ${minutes} minutes.`, `इस नंबर के लिए बहुत अधिक OTP अनुरोध हुए हैं। कृपया ${minutes} मिनट बाद पुनः प्रयास करें।`)
            : t(`Please wait ${wait} seconds before requesting another OTP.`, `दूसरा OTP मंगाने से पहले ${wait} सेकंड प्रतीक्षा करें।`),
        );
      } else if (e instanceof ApiError && e.status === 400) {
        setError(t('Enter a valid 10-digit mobile number (it starts with 6, 7, 8 or 9).', 'मान्य 10 अंकों का मोबाइल नंबर दर्ज करें (यह 6, 7, 8 या 9 से शुरू होता है)।'));
      } else {
        setError(errorText(e, t));
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError('');
    if (otp.length !== OTP_LENGTH) {
      setError(t('Enter the 6-digit OTP.', '6 अंकों का OTP दर्ज करें।'));
      return;
    }
    setBusy(true);
    try {
      const result = await verifyOtp(base, mobile, otp);
      if (result.registered) {
        await onAuthenticated(result.token, false);
        return;
      }
      setRegistrationToken(result.token);
      setFieldErrors({});
      setStep(3);
      void loadWards();
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setError(t('That OTP is incorrect or has expired. Check the code, or request a new OTP.', 'यह OTP गलत है या समाप्त हो गया है। कोड जांचें या नया OTP मंगाएं।'));
      else if (e instanceof ApiError && e.status === 429) setError(t('Too many incorrect attempts. Please request a new OTP.', 'कई बार गलत कोड दर्ज हुआ। कृपया नया OTP मंगाएं।'));
      else setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  function backToMobile(message = '') {
    setStep(1);
    setOtp('');
    setRegistrationToken('');
    setPhoto(null);
    setError(message);
  }

  /* ------------------------------------------------------------ registration */

  async function choosePhoto(camera: boolean) {
    setError('');
    setFieldErrors(prev => ({...prev, photo: undefined}));
    setPhotoBusy(true);
    try {
      const picked = await pickPhoto(camera, t, true);
      if (!picked) return;
      const id = await upload({url: base, token: registrationToken}, picked.uri, picked.mimeType);
      setPhoto({id, uri: picked.uri});
    } catch (e) {
      setFieldErrors(prev => ({...prev, photo: errorText(e, t)}));
    } finally {
      setPhotoBusy(false);
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) errors.name = t('Enter your full name (2 to 80 characters).', 'अपना पूरा नाम दर्ज करें (2 से 80 अक्षर)।');
    if (noWards) errors.ward = t('No wards are available yet. Please try again later.', 'अभी कोई वार्ड उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें।');
    else if (!wardId) errors.ward = t('Select your ward.', 'अपना वार्ड चुनें।');
    if (email.trim() && !EMAIL_RE.test(email.trim())) errors.email = t('Enter a valid email address, or leave it empty.', 'मान्य ईमेल दर्ज करें, या खाली छोड़ दें।');
    const cleanAddress = address.trim();
    if (cleanAddress.length < 5 || cleanAddress.length > 300) errors.address = t('Enter your address (5 to 300 characters).', 'अपना पता दर्ज करें (5 से 300 अक्षर)।');
    if (!photo) errors.photo = t('Add your photo.', 'अपनी फोटो जोड़ें।');
    if (!consent) errors.consent = t('Please accept to continue.', 'आगे बढ़ने के लिए सहमति दें।');
    return errors;
  }

  async function submit() {
    setError('');
    const errors = validate();
    setFieldErrors(errors);
    const first = FIELD_ORDER.find(key => errors[key]);
    if (first || !photo) {
      if (first) scrollToField(first);
      return;
    }
    setBusy(true);
    try {
      const result = await registerResident(base, registrationToken, {name: name.trim(), wardId, email: email.trim() || undefined, address: address.trim(), photoId: photo.id, consent: true});
      await onAuthenticated(result.token, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) backToMobile(t('Your verification has expired. Please verify your mobile number again.', 'आपका सत्यापन समाप्त हो गया है। कृपया मोबाइल नंबर फिर से सत्यापित करें।'));
      else if (e instanceof ApiError && e.status === 409) backToMobile(t('This mobile number is already registered. Please log in with an OTP.', 'यह मोबाइल नंबर पहले से पंजीकृत है। कृपया OTP से लॉग इन करें।'));
      else setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- render */

  const features: {icon: IconName; label: string}[] = [
    {icon: 'camera-outline', label: t('Report with a photo', 'फोटो से शिकायत')},
    {icon: 'time-outline', label: t('Track every update', 'हर अपडेट देखें')},
    {icon: 'shield-checkmark-outline', label: t('Confirm the resolution', 'समाधान की पुष्टि')},
  ];

  return (
    <View style={s.root}>
      <TirangaBand />
      <ScrollView ref={scroller} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <Image source={require('../assets/samadhan-logo.png')} accessibilityLabel="SAMADHAN" resizeMode="contain" style={s.topLogo} />
          <LanguageToggle hindi={hindi} onPress={() => setHindi(!hindi)} />
        </View>
        {step > 0 && (
          <IconButton
            icon="arrow-back"
            label={t('Go back', 'वापस जाएं')}
            disabled={busy}
            onPress={() => {
              if (step === 3) backToMobile();
              else {
                setStep((step - 1) as Step);
                setError('');
              }
            }}
            style={s.back}
          />
        )}
        {step < 3 && <BrandingArt imageUrl={brandingImage} height={step > 0 ? 130 : 210} style={s.art} />}
        {!!notice && step < 2 && <Notice tone="info">{notice}</Notice>}

        {step === 0 && (
          <>
            <View style={s.chakra}>
              <Chakra size={26} />
            </View>
            <Text style={s.kicker}>{t('OUR CITY. OUR RESPONSIBILITY.', 'हमारा शहर। हमारी जिम्मेदारी।')}</Text>
            <Text accessibilityRole="header" style={s.hero}>
              {t('Your voice.\nA better neighbourhood.', 'आपकी आवाज़।\nबेहतर अपना शहर।')}
            </Text>
            <Text style={s.copy}>{t('Report a local problem, follow its progress, and help your ward get it resolved.', 'अपने क्षेत्र की समस्या बताएं, प्रगति देखें और समाधान में भागीदार बनें।')}</Text>
            <View style={s.features}>
              {features.map((feature, i) => (
                <View style={s.feature} key={feature.icon}>
                  <IconTile name={feature.icon} size={48} tone={FEATURE_TONES[i]} />
                  <Text style={s.featureLabel}>{feature.label}</Text>
                </View>
              ))}
            </View>
            <Text style={s.choose}>{t('Choose your language', 'अपनी भाषा चुनें')}</Text>
            <View style={s.langRow}>
              {[
                [false, 'English'],
                [true, 'हिन्दी'],
              ].map(([value, label]) => (
                <Pressable
                  key={String(value)}
                  accessibilityRole="radio"
                  accessibilityState={{selected: hindi === value, checked: hindi === value}}
                  onPress={() => setHindi(Boolean(value))}
                  style={[s.lang, hindi === value && s.langSelected]}>
                  <Text style={[s.langText, hindi === value && s.langTextSelected]}>{String(label)}</Text>
                  <SelectionMark kind="radio" selected={hindi === value} size={22} />
                </Pressable>
              ))}
            </View>
            <Button variant="accent" icon="arrow" title={t('Get started', 'शुरू करें')} onPress={() => setStep(1)} />
            <Text style={s.tagline}>जनता की बात, समाधान के साथ</Text>
          </>
        )}

        {step === 1 && (
          <>
            <Text accessibilityRole="header" style={s.hero}>
              {t('Let’s get you connected.', 'आइए, शुरुआत करें।')}
            </Text>
            <Text style={s.copy}>{t('Enter your mobile number. We will send a 6-digit OTP to verify that it is yours.', 'अपना मोबाइल नंबर दर्ज करें। नंबर आपका है, इसकी पुष्टि के लिए हम 6 अंकों का OTP भेजेंगे।')}</Text>
            <Text style={s.label}>{t('Mobile number', 'मोबाइल नंबर')}</Text>
            <View style={[s.phone, insetStyle({focused: phoneFocused, invalid: !!error})]}>
              <View style={s.countryBox}>
                <Flag />
                <Text style={s.country}>+91</Text>
              </View>
              <TextInput
                accessibilityLabel={t('Mobile number', 'मोबाइल नंबर')}
                value={formatMobile(mobile)}
                onChangeText={v => {
                  setMobile(cleanMobile(v));
                  setError('');
                }}
                onFocus={() => setPhoneFocused(true)}
                onBlur={() => setPhoneFocused(false)}
                onSubmitEditing={() => void sendCode()}
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="go"
                placeholder="98765 43210"
                style={s.phoneInput}
              />
            </View>
            {!!error && <Notice tone="error">{error}</Notice>}
            <Button icon="arrow" loading={busy} disabled={busy || waiting} title={waiting ? t(`Send OTP again in ${resendIn} s`, `${resendIn} सेकंड में फिर OTP भेजें`) : t('Send OTP', 'OTP भेजें')} onPress={() => void sendCode()} style={s.action} />
            <Text style={s.tagline}>{t('Your number is never shared with advertisers.', 'आपका नंबर विज्ञापनदाताओं से साझा नहीं किया जाता।')}</Text>
          </>
        )}

        {step === 2 && (
          <>
            <Text accessibilityRole="header" style={s.hero}>
              {t('A small step to verify.', 'नंबर की पुष्टि करें।')}
            </Text>
            <Text style={s.copy}>
              {t(`Enter the 6-digit OTP sent to +91 ${formatMobile(mobile)}.`, `+91 ${formatMobile(mobile)} पर भेजा गया 6 अंकों का OTP दर्ज करें।`)}
            </Text>
            <TextInput
              inset
              invalid={!!error}
              accessibilityLabel={t('6-digit OTP', '6 अंकों का OTP')}
              value={otp}
              onChangeText={v => {
                setOtp(v.replace(/\D/g, '').slice(0, OTP_LENGTH));
                setError('');
              }}
              onSubmitEditing={() => void verifyCode()}
              keyboardType="number-pad"
              inputMode="numeric"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={OTP_LENGTH}
              returnKeyType="go"
              style={s.otp}
              placeholder="– – – – – –"
            />
            {!!error && <Notice tone="error">{error}</Notice>}
            <Button icon="arrow" loading={busy} disabled={busy} title={t('Verify & continue', 'पुष्टि करें और आगे बढ़ें')} onPress={() => void verifyCode()} style={s.action} />
            <View style={s.links}>
              {resendIn > 0 ? (
                <Text accessibilityLiveRegion="polite" style={s.countdown}>
                  {t(`Resend OTP in ${resendIn} s`, `${resendIn} सेकंड में OTP दोबारा भेजें`)}
                </Text>
              ) : (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void sendCode()} style={s.linkButton} feedback="none">
                  <Text style={s.link}>{t('Resend OTP', 'OTP दोबारा भेजें')}</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => backToMobile()} style={s.linkButton} feedback="none">
                <Text style={s.link}>{t('Change mobile number', 'मोबाइल नंबर बदलें')}</Text>
              </Pressable>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <Text accessibilityRole="header" style={s.hero}>
              {t('Complete your registration', 'अपना पंजीकरण पूरा करें')}
            </Text>
            <Text style={s.copy}>{t('Tell us a little about yourself so your ward team can reach you. Fields marked * are required.', 'अपने बारे में थोड़ी जानकारी दें ताकि वार्ड टीम आप तक पहुंच सके। * वाले खाने आवश्यक हैं।')}</Text>
            <View onLayout={e => (formTop.current = e.nativeEvent.layout.y)}>
              <View onLayout={track('name')}>
                <Field
                  label={t('Full name *', 'पूरा नाम *')}
                  value={name}
                  onChangeText={v => {
                    setName(v);
                    setFieldErrors(prev => ({...prev, name: undefined}));
                  }}
                  error={fieldErrors.name}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  maxLength={80}
                />
              </View>
              <View onLayout={track('ward')}>
                <WardPicker
                  label={t('Your ward *', 'आपका वार्ड *')}
                  wards={wards.list}
                  value={wardId}
                  onChange={id => {
                    setWardId(id);
                    setFieldErrors(prev => ({...prev, ward: undefined}));
                  }}
                  hindi={hindi}
                  base={base}
                  loading={wards.status === 'loading'}
                  loadError={wards.status === 'error' ? wards.message : undefined}
                  onRetry={() => void loadWards()}
                  error={fieldErrors.ward}
                />
              </View>
              <View onLayout={track('email')}>
                <Field
                  label={t('Email (optional)', 'ईमेल (वैकल्पिक)')}
                  value={email}
                  onChangeText={v => {
                    setEmail(v);
                    setFieldErrors(prev => ({...prev, email: undefined}));
                  }}
                  error={fieldErrors.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  maxLength={120}
                />
              </View>
              <View onLayout={track('address')}>
                <Field
                  label={t('Address *', 'पता *')}
                  hint={t('House number, street and locality', 'मकान नंबर, सड़क और मोहल्ला')}
                  value={address}
                  onChangeText={v => {
                    setAddress(v);
                    setFieldErrors(prev => ({...prev, address: undefined}));
                  }}
                  error={fieldErrors.address}
                  multiline
                  autoCapitalize="sentences"
                  autoComplete="street-address"
                  textContentType="fullStreetAddress"
                  maxLength={300}
                  inputStyle={s.addressInput}
                />
              </View>
              <View onLayout={track('photo')} style={s.photoBlock}>
                <Text style={s.label}>{t('Your photo *', 'आपकी फोटो *')}</Text>
                <View style={s.photoRow}>
                  <Avatar size={88} name={name.trim()} source={photo ? {uri: photo.uri} : null} decorative={false} />
                  <View style={s.photoActions}>
                    <Button variant="secondary" disabled={photoBusy || busy} loading={photoBusy} icon={<Icon name="camera-outline" size={20} color={colors.navy} />} title={t('Take a photo', 'फोटो लें')} onPress={() => void choosePhoto(true)} style={s.photoButton} />
                    <Button variant="secondary" disabled={photoBusy || busy} icon={<Icon name="images-outline" size={20} color={colors.navy} />} title={photo ? t('Choose another from gallery', 'गैलरी से दूसरी चुनें') : t('Choose from gallery', 'गैलरी से चुनें')} onPress={() => void choosePhoto(false)} style={s.photoButton} />
                  </View>
                </View>
                {fieldErrors.photo ? (
                  <Text accessibilityRole="alert" style={s.fieldError}>
                    {fieldErrors.photo}
                  </Text>
                ) : (
                  <Text style={s.hint}>{photoBusy ? t('Uploading photo…', 'फोटो अपलोड हो रही है…') : t('A clear face photo, up to 5 MB.', 'चेहरा साफ दिखने वाली फोटो, अधिकतम 5 MB।')}</Text>
                )}
              </View>
              <View onLayout={track('consent')}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{checked: consent}}
                  feedback="none"
                  onPress={() => {
                    setConsent(!consent);
                    setFieldErrors(prev => ({...prev, consent: undefined}));
                  }}
                  style={s.consent}>
                  <SelectionMark selected={consent} />
                  <Text style={s.consentText}>
                    {t(
                      'I agree that SAMADHAN may store and use my name, mobile number, address and photo to register me as a resident and to handle my complaints. I also agree to receive notifications about my complaints and local classified ads on this phone. I can turn off classified notifications at any time in my profile.',
                      'मैं सहमत हूं कि SAMADHAN मुझे निवासी के रूप में पंजीकृत करने और मेरी शिकायतों के निपटारे के लिए मेरा नाम, मोबाइल नंबर, पता और फोटो सहेज और उपयोग कर सकता है। मैं इस फ़ोन पर अपनी शिकायतों और स्थानीय विज्ञापनों की सूचनाएं पाने के लिए भी सहमत हूं। मैं विज्ञापन सूचनाएं कभी भी अपनी प्रोफ़ाइल में बंद कर सकता/सकती हूं।',
                    )}
                  </Text>
                </Pressable>
                <LegalLinks hindi={hindi} style={s.legal} />
                {fieldErrors.consent ? (
                  <Text accessibilityRole="alert" style={s.fieldError}>
                    {fieldErrors.consent}
                  </Text>
                ) : null}
              </View>
            </View>
            {!!error && <Notice tone="error">{error}</Notice>}
            {FIELD_ORDER.some(key => fieldErrors[key]) && !error ? <Notice tone="error">{t('Please fix the highlighted fields.', 'कृपया चिह्नित खानों को ठीक करें।')}</Notice> : null}
            <Button variant="accent" icon="arrow" loading={busy} disabled={busy || photoBusy || noWards} title={t('Complete registration', 'पंजीकरण पूरा करें')} onPress={() => void submit()} style={s.action} />
          </>
        )}

        <StepDots count={4} active={step} label={t(`Step ${step + 1} of 4`, `चरण ${step + 1} / 4`)} style={s.steps} />
      </ScrollView>
    </View>
  );
}

/** Small tricolour flag (replaces the flag emoji, which some platforms draw as the letters "IN"). */
function Flag() {
  return (
    <View style={s.flag}>
      {tricolour.map(color => (
        <View key={color} style={{flex: 1, backgroundColor: color}} />
      ))}
      <View style={s.flagWheel} />
    </View>
  );
}

const s = StyleSheet.create({
  root: {flex: 1},
  page: {paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28, flexGrow: 1},
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10},
  back: {marginTop: 16},
  topLogo: {width: 150, height: 46},
  art: {marginTop: 16, marginBottom: 18},
  chakra: {alignSelf: 'center', marginBottom: 18},
  kicker: {fontSize: 12, letterSpacing: 1.5, fontWeight: '600', color: colors.saffronText, textAlign: 'center', marginBottom: 12},
  hero: {...textStyles.display, marginBottom: 14, marginTop: 6},
  copy: {...textStyles.body, marginBottom: 24},
  features: {flexDirection: 'row', paddingVertical: 18, marginBottom: 22, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider},
  feature: {flex: 1, alignItems: 'center', gap: 10, paddingHorizontal: 4},
  featureLabel: {fontSize: 12, lineHeight: 17, textAlign: 'center', color: colors.textSecondary},
  choose: {fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 12},
  langRow: {flexDirection: 'row', gap: 13, marginBottom: 20},
  lang: {...cardSurface(glass(0.92), {radius: 16}), flex: 1, minHeight: 56, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  langSelected: {...cardSurface(glass(0.95, colors.saffronSoft), {radius: 16, border: colors.saffron}), borderBottomColor: colors.saffron},
  langText: {fontSize: typeScale.bodyMd.fontSize, color: colors.ink, fontWeight: '500'},
  langTextSelected: {color: colors.navy, fontWeight: '700'},
  tagline: {textAlign: 'center', fontSize: 12, color: colors.textSecondary, lineHeight: 19, marginTop: 20},
  steps: {marginTop: 28},
  label: {...textStyles.label, marginBottom: 10, marginTop: 4},
  phone: {minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12},
  countryBox: {flexDirection: 'row', alignItems: 'center', gap: 8, borderRightWidth: 1, borderColor: colors.borderStrong, paddingRight: 12},
  country: {fontSize: typeScale.bodyMd.fontSize, color: colors.ink},
  phoneInput: {fontSize: typeScale.titleSm.fontSize, color: colors.ink, flex: 1, paddingVertical: 12, letterSpacing: 1, outlineWidth: 0},
  action: {marginTop: 18},
  otp: {fontSize: typeScale.h2.fontSize, letterSpacing: 12, textAlign: 'center', color: colors.ink, paddingVertical: 16, marginTop: 4, borderRadius: radius.lg},
  links: {alignItems: 'center', marginTop: 8},
  linkButton: {minHeight: 48, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  link: {...textStyles.link, fontSize: 14},
  countdown: {fontSize: 14, lineHeight: 20, color: colors.textSecondary, minHeight: 48, textAlignVertical: 'center', paddingTop: 14},
  addressInput: {minHeight: 96},
  photoBlock: {marginVertical: 10},
  photoRow: {flexDirection: 'row', alignItems: 'center', gap: 16},
  photoActions: {flex: 1},
  photoButton: {marginVertical: 4},
  hint: {fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 8},
  fieldError: {fontSize: 12, lineHeight: 18, color: colors.error, marginTop: 6},
  consent: {flexDirection: 'row', gap: 12, marginTop: 16, alignItems: 'flex-start'},
  consentText: {fontSize: 13, lineHeight: 21, color: colors.textSecondary, flex: 1},
  legal: {marginLeft: 36},
  flag: {width: 24, height: 17, borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderStrong},
  flagWheel: {position: 'absolute', left: 7.5, top: 4, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: colors.navy},
});
