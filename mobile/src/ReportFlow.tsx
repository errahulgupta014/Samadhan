import {Text, Pressable, Button, Field, Glyph, GradientFill, Icon, IconButton, IconTile, Notice, SelectionMark, cardSurface, colors, glass, radius, raised, rgba, textStyles, typeScale} from './Design';
import BackHome from './BackHome';
import React, {useEffect, useMemo, useState} from 'react';
import {View, Image, StyleSheet, Animated, Easing, AccessibilityInfo, ActivityIndicator, Platform} from 'react-native';
import * as Location from 'expo-location';
import {useCategories} from './useCategories';
import {upload, type Connection} from './api';
import {errorText} from './errors';
import {pickPhoto} from './photo';
import {translator, wardTitle, type IconName} from './labels';
import type {PublicWard} from '../shared/community';
import type {IssueCategory} from '../shared/domain';
import Ionicons from '@expo/vector-icons/Ionicons';

const safeIcon = (icon: string): IconName => (icon in Ionicons.glyphMap ? (icon as IconName) : 'ellipsis-horizontal');

/** Key of the last tile, which lists the categories that have no (known) department. */
const OTHER = '__other';
type Group = {key: string; name: string; categories: IssueCategory[]};
type Stage = 'department' | 'category' | 'details' | 'location';

export default function ReportFlow({
  connection,
  ward,
  hindi,
  act,
  onSuccess,
  back,
  home,
  refreshToken = 0,
}: {
  back: () => void;
  home: () => void;
  connection: Connection;
  /** The resident's own ward: complaints are sent to it. */
  ward?: PublicWard | null;
  hindi: boolean;
  act: (b: Record<string, unknown>) => Promise<any>;
  onSuccess: (id: string) => void;
  /** Bumped by the app on pull-to-refresh: the department and category lists are fetched again. */
  refreshToken?: number;
}) {
  const [step, setStep] = useState(0);
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locality, setLocality] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [photos, setPhotos] = useState<{id: string; uri: string}[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const t = translator(hindi);
  const catalog = useCategories(connection, refreshToken);
  const categories = catalog.categories;
  const selectedCategory = categories.find(c => c.id === category);
  // Department tiles: the departments that have enabled categories, then "Other" for categories without a department.
  const groups = useMemo<Group[]>(() => {
    const enabled = catalog.categories.filter(c => c.enabled !== false);
    const known = new Set(catalog.departments.map(d => d.id));
    const list: Group[] = catalog.departments
      .map(d => ({key: d.id, name: hindi && d.nameHi ? d.nameHi : d.name, categories: enabled.filter(c => c.departmentId === d.id)}))
      .filter(g => g.categories.length);
    const rest = enabled.filter(c => !c.departmentId || !known.has(c.departmentId));
    if (rest.length) list.push({key: OTHER, name: hindi ? 'अन्य' : 'Other', categories: rest});
    return list;
  }, [catalog.categories, catalog.departments, hindi]);
  // One department (or only "Other"): the department screen would be pointless, so the flow starts at the categories.
  const skipDepartment = groups.length <= 1;
  const first = skipDepartment ? 1 : 0;
  const group = skipDepartment ? groups[0] : groups.find(g => g.key === department);
  // Steps never point at a selection the latest catalogue no longer has: they fall back to the screen that picks it.
  let current = Math.max(step, first);
  if (current >= 1 && !group) current = first;
  if (current >= 2 && !selectedCategory) current = 1;
  const stages: Stage[] = skipDepartment ? ['category', 'details', 'location'] : ['department', 'category', 'details', 'location'];
  const stage = stages[current - first];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  /** Tapping a department tile moves straight on to its categories; a different department clears a category that does not belong to it. */
  function chooseDepartment(chosen: Group) {
    setError('');
    setDepartment(chosen.key);
    if (category && !chosen.categories.some(c => c.id === category)) setCategory('');
    setStep(1);
  }

  /** Tapping a category tile moves straight on to the details. */
  function chooseCategory(chosen: IssueCategory) {
    setError('');
    setCategory(chosen.id);
    setStep(2);
  }

  /** Details -> location (the only step with a Continue button besides the final submit). */
  function next() {
    setError('');
    if (title.trim().length < 4 || description.trim().length < 10 || !photos.length) {
      setError(t('Add a title, a description of at least 10 characters and one photograph.', 'शीर्षक, कम से कम 10 अक्षरों का विवरण और एक फोटो जोड़ें।'));
      return;
    }
    setStep(current + 1);
  }

  /** Back keeps every selection; from the first screen it leaves the flow. */
  function previous() {
    setError('');
    if (current > first) setStep(current - 1);
    else back();
  }

  async function pick(camera: boolean) {
    await run(async () => {
      if (photos.length >= 5) throw new Error(t('Maximum 5 photographs.', 'अधिकतम 5 फोटो जोड़ी जा सकती हैं।'));
      const picked = await pickPhoto(camera, t);
      if (!picked) return;
      const id = await upload(connection, picked.uri, picked.mimeType);
      setPhotos(p => [...p, {id, uri: picked.uri}]);
    });
  }

  if (success) {
    return (
      <>
        <BackHome back={() => onSuccess(success)} home={home} hindi={hindi} />
        <View style={s.success}>
          <SuccessMark label={t('Complaint submitted', 'शिकायत दर्ज हो गई')} />
          <Text accessibilityRole="header" style={[s.heading, s.centered]}>
            {t('Your voice has\nbeen heard.', 'आपकी शिकायत\nदर्ज हो गई है।')}
          </Text>
          <Text style={[s.copy, s.centered]}>
            {t('Your ward team can now review the issue. Every update will appear in your timeline.', 'वार्ड टीम अब शिकायत देख सकती है। हर अपडेट आपकी टाइमलाइन में दिखेगा।')}
          </Text>
          <View style={s.receipt}>
            <Text style={s.receiptLabel}>{t('YOUR REFERENCE NUMBER', 'आपकी शिकायत संख्या')}</Text>
            <Text selectable style={s.receiptId}>
              {success}
            </Text>
            <View style={s.receiptStatusRow}>
              <Icon name="paper-plane-outline" size={14} color={colors.success} />
              <Text style={s.receiptStatus}>{ward ? t(`Submitted to ${wardTitle(ward, false)}`, `${wardTitle(ward, true)} को भेजी गई`) : t('Submitted to your ward team', 'आपकी वार्ड टीम को भेजी गई')}</Text>
            </View>
          </View>
          <Button style={s.fullWidth} title={t('Track my complaint', 'मेरी शिकायत देखें')} icon="arrow" onPress={() => onSuccess(success)} />
          <Text style={[s.small, s.centered]}>
            {t(
              'Save this reference number to track your complaint. We will notify you whenever its status changes.',
              'शिकायत की स्थिति देखने के लिए यह संख्या सुरक्षित रखें। स्थिति बदलने पर हम आपको सूचित करेंगे।',
            )}
          </Text>
        </View>
      </>
    );
  }

  const unavailable = !catalog.loading && !catalog.error;
  // Before the catalogue arrives (or when it cannot be shown) there are no steps to count yet: only Back, Home and a status.
  if (!groups.length) {
    return (
      <View>
        <BackHome back={back} home={home} hindi={hindi} />
        <View style={s.state}>
          {catalog.loading ? (
            <>
              <ActivityIndicator color={colors.green} />
              <Text style={[s.copy, s.centered, s.noMargin]}>{t('Loading departments…', 'विभाग लोड हो रहे हैं…')}</Text>
            </>
          ) : (
            <>
              <IconTile name={unavailable ? 'construct-outline' : 'cloud-offline-outline'} size={56} tone="navy" />
              {catalog.error ? (
                <Notice tone="error">{catalog.error}</Notice>
              ) : (
                <Text accessibilityRole="header" style={[s.heading, s.centered, s.noMargin]}>
                  {t('Reporting is not available right now. Please try again later.', 'अभी शिकायत दर्ज करना उपलब्ध नहीं है। कृपया बाद में फिर प्रयास करें।')}
                </Text>
              )}
              <Button variant="secondary" icon={<Icon name="refresh" size={20} color={colors.navy} />} style={s.fullWidth} title={t('Refresh', 'रिफ्रेश करें')} onPress={() => void catalog.refresh()} />
            </>
          )}
        </View>
      </View>
    );
  }

  const stageLabels: Record<Stage, string> = {
    department: t('Department', 'विभाग'),
    category: t('Category', 'श्रेणी'),
    details: t('Details', 'विवरण'),
    location: t('Location', 'स्थान'),
  };
  const heading: Record<Stage, string> = {
    department: t('Choose the department', 'विभाग चुनें'),
    category: t('Choose the category', 'श्रेणी चुनें'),
    details: t('A few details\nmake a difference.', 'विवरण और\nफोटो जोड़ें'),
    location: t('Where is the problem?', 'समस्या कहां है?'),
  };
  const subheading: Record<Stage, string> = {
    department: t('Pick the department that looks after this kind of problem.', 'जो विभाग इस तरह की समस्या देखता है, उसे चुनें।'),
    category: t('Choose the category that best describes the issue.', 'समस्या से संबंधित श्रेणी चुनें।'),
    details: t('Help the team understand what needs to be fixed.', 'समस्या की जानकारी से टीम को मदद मिलती है।'),
    location: t('A precise location helps the right team reach the spot.', 'सही स्थान से टीम समस्या तक पहुंच सकती है।'),
  };
  const tileStage = stage === 'department' || stage === 'category';
  const departmentLine = group && group.key !== OTHER ? group.name : '';
  const count = (n: number) => (n === 1 ? t('1 category', '1 श्रेणी') : t(`${n} categories`, `${n} श्रेणियां`));
  return (
    <View>
      <BackHome back={previous} home={home} hindi={hindi} disabled={busy} />
      <Steps labels={stages.map(x => stageLabels[x])} step={current - first} hindi={hindi} />
      <Text accessibilityRole="header" style={s.heading}>
        {heading[stage]}
      </Text>
      <Text style={s.copy}>{subheading[stage]}</Text>

      {tileStage && (
        <>
          <View style={s.catalogBar}>
            <Text style={s.small}>{catalog.loading ? t('Loading…', 'लोड हो रहा है…') : t('Available in your ward', 'आपके वार्ड में उपलब्ध')}</Text>
            <Pressable accessibilityRole="button" disabled={catalog.loading} hitSlop={8} onPress={() => void catalog.refresh()} style={s.textButton}>
              <Icon name="refresh" size={16} color={colors.greenText} />
              <Text style={s.change}>{t('Refresh', 'रिफ्रेश करें')}</Text>
            </Pressable>
          </View>
          {!!catalog.error && <Notice tone="error">{catalog.error}</Notice>}
        </>
      )}

      {stage === 'department' && (
        <View style={s.grid}>
          {groups.map(g => {
            const chosen = department === g.key;
            return (
              <Tile
                key={g.key}
                label={g.name}
                caption={count(g.categories.length)}
                accessibilityLabel={`${g.name}, ${count(g.categories.length)}`}
                selected={chosen}
                onPress={() => chooseDepartment(g)}
                icon={<IconTile name={g.key === OTHER ? 'ellipsis-horizontal' : 'business-outline'} size={44} tone={g.key === OTHER ? 'saffron' : 'navy'} />}
              />
            );
          })}
        </View>
      )}

      {stage === 'category' && group && (
        <View style={s.grid}>
          {group.categories.map(cat => {
            const name = hindi && cat.nameHi ? cat.nameHi : cat.nameEn;
            return <Tile key={cat.id} label={name} accessibilityLabel={name} selected={category === cat.id} onPress={() => chooseCategory(cat)} icon={<IconTile name={safeIcon(cat.icon)} size={44} color={cat.color} />} />;
          })}
        </View>
      )}

      {stage === 'details' && (
        <>
          <View style={s.selectedRow}>
            <IconTile name={safeIcon(selectedCategory?.icon || 'ellipsis-horizontal')} size={36} color={selectedCategory?.color ?? colors.green} />
            <View style={s.flex}>
              <Text style={s.selectedLabel}>{selectedCategory ? (hindi && selectedCategory.nameHi ? selectedCategory.nameHi : selectedCategory.nameEn) : t('Category unavailable', 'श्रेणी उपलब्ध नहीं है')}</Text>
              {!!departmentLine && <Text style={s.small}>{departmentLine}</Text>}
            </View>
            <Pressable onPress={() => setStep(1)} accessibilityRole="button" hitSlop={8} style={s.textButton}>
              <Text style={s.change}>{t('Change', 'बदलें')}</Text>
            </Pressable>
          </View>
          <Field
            label={t('Short title', 'शीर्षक')}
            value={title}
            onChangeText={setTitle}
            placeholder={t('e.g. Streetlight not working near the park', 'जैसे पार्क के पास स्ट्रीट लाइट बंद है')}
            maxLength={200}
            containerStyle={s.fieldGap}
          />
          <Field
            label={t('Describe the issue', 'समस्या का विवरण')}
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder={t('What happened? How is it affecting the area?', 'समस्या क्या है? क्षेत्र पर क्या असर है?')}
            maxLength={2000}
          />
          <View style={s.photoHeader}>
            <Text style={s.label}>{t('Add photographs', 'फोटो जोड़ें')}</Text>
            <Text style={s.small}>{photos.length}/5 · JPG, PNG, WebP</Text>
          </View>
          <View style={s.photoActions}>
            <PhotoAction icon="camera-outline" label={t('Take a photo', 'फोटो लें')} disabled={busy || photos.length === 5} onPress={() => void pick(true)} />
            <PhotoAction icon="images-outline" label={t('Choose from gallery', 'गैलरी से चुनें')} disabled={busy || photos.length === 5} onPress={() => void pick(false)} />
          </View>
          <View style={s.photos}>
            {photos.map((p, i) => (
              <View key={p.id} style={s.thumb}>
                <View style={s.photoFrame}>
                  <Image source={{uri: p.uri}} style={s.photo} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(`Remove photograph ${i + 1}`, `फोटो ${i + 1} हटाएं`)}
                  hitSlop={10}
                  onPress={() => setPhotos(photos.filter(x => x.id !== p.id))}
                  style={s.remove}>
                  <Glyph name="close" size={16} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={s.small}>{busy ? t('Uploading photograph…', 'फोटो अपलोड हो रहा है…') : t('At least 1 photo. Up to 5 MB each.', 'कम से कम 1 फोटो। प्रत्येक अधिकतम 5 MB।')}</Text>
        </>
      )}

      {stage === 'location' && (
        <>
          <Pressable
            style={s.gps}
            disabled={busy}
            accessibilityRole="button"
            onPress={() =>
              void run(async () => {
                const permission = await Location.requestForegroundPermissionsAsync();
                if (permission.status !== 'granted') throw new Error(t('Location access declined. Enter coordinates below.', 'स्थान की अनुमति नहीं मिली। नीचे निर्देशांक दर्ज करें।'));
                const position = await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.Balanced});
                setLat(position.coords.latitude.toFixed(6));
                setLng(position.coords.longitude.toFixed(6));
              })
            }>
            <IconTile name="locate" size={40} tone="green" />
            <Text style={s.gpsText}>{t('Use my current location', 'मेरा वर्तमान स्थान लें')}</Text>
          </Pressable>
          <Text style={s.small}>{t('Used only for this report. No background tracking.', 'केवल इस शिकायत के लिए। पृष्ठभूमि में ट्रैकिंग नहीं।')}</Text>
          <Field
            label={t('Street / locality / landmark', 'सड़क / इलाका / पहचान')}
            value={locality}
            onChangeText={setLocality}
            placeholder={t('e.g. Near primary school, Gandhi Nagar', 'जैसे प्राथमिक विद्यालय के पास, गांधी नगर')}
            maxLength={200}
            containerStyle={s.fieldGap}
          />
          <View style={s.coordinates}>
            <Field label={t('Latitude', 'अक्षांश')} value={lat} onChangeText={setLat} numeric maxLength={200} containerStyle={s.flex} />
            <Field label={t('Longitude', 'देशांतर')} value={lng} onChangeText={setLng} numeric maxLength={200} containerStyle={s.flex} />
          </View>
          {ward ? (
            <View style={s.ward}>
              <IconTile name="location" size={40} tone="navy" />
              <View style={s.flex}>
                <Text style={s.wardTitle}>{[wardTitle(ward, hindi), ward.city].filter(Boolean).join(', ')}</Text>
                <Text style={s.small}>{t('Your complaint will be sent to this ward.', 'आपकी शिकायत इसी वार्ड को भेजी जाएगी।')}</Text>
              </View>
            </View>
          ) : null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked: consent}} style={s.consent} feedback="none" onPress={() => setConsent(!consent)}>
            <SelectionMark selected={consent} />
            <Text style={s.consentText}>
              {t(
                'I consent to the use of these photos and this location for processing my complaint.',
                'मैं अपनी शिकायत की प्रक्रिया के लिए इन फोटो और स्थान के उपयोग की अनुमति देता/देती हूं।',
              )}
            </Text>
          </Pressable>
        </>
      )}

      {!!error && <Notice tone="error">{error}</Notice>}
      {tileStage ? (
        current > first && (
          <View style={s.footer}>
            <View style={s.flex}>
              <Button variant="secondary" title={t('Back', 'वापस')} onPress={previous} />
            </View>
          </View>
        )
      ) : (
        <View style={s.footer}>
          <IconButton icon="arrow-back" size={54} label={t('Previous step', 'पिछला चरण')} disabled={busy} onPress={previous} />
          <View style={s.flex}>
            <Button
              variant={stage === 'location' ? 'accent' : 'primary'}
              icon="arrow"
              loading={busy}
              disabled={busy}
              title={busy ? t('Please wait…', 'कृपया प्रतीक्षा करें…') : stage === 'location' ? t('Submit complaint', 'शिकायत दर्ज करें') : t('Continue', 'आगे बढ़ें')}
              onPress={() => {
                if (stage === 'details') {
                  next();
                  return;
                }
                void run(async () => {
                  if (!lat.trim() || !lng.trim()) throw new Error(t('Capture or enter the coordinates.', 'निर्देशांक लें या दर्ज करें।'));
                  const r = await act({action: 'create', categoryId: category, title, description, locality, lat: Number(lat), lng: Number(lng), media: photos.map(p => p.id), consent});
                  setSuccess(r.referenceNumber ?? r.id);
                });
              }}
            />
          </View>
        </View>
      )}
      <View style={s.privateRow}>
        <Icon name="shield-checkmark-outline" size={14} color={colors.textSecondary} />
        <Text style={s.private}>{t('Visible only to you and the ward team.', 'केवल आपको और वार्ड टीम को दिखाई देगा।')}</Text>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------- pieces */

/** A department or category tile: tapping it chooses it and moves on. The selected tile stays highlighted when the resident comes back. */
function Tile({label, caption, accessibilityLabel, selected, onPress, icon}: {label: string; caption?: string; accessibilityLabel: string; selected: boolean; onPress: () => void; icon: React.ReactNode}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{selected}} onPress={onPress} style={[s.category, selected && s.categorySelected]}>
      {icon}
      <View>
        <Text style={[s.categoryName, selected && s.categoryNameSelected]}>{label}</Text>
        {!!caption && <Text style={s.tileCaption}>{caption}</Text>}
      </View>
      {selected && (
        <View style={s.categoryCheck}>
          <Glyph name="check" size={14} color={colors.white} />
        </View>
      )}
    </Pressable>
  );
}

function PhotoAction({icon, label, disabled, onPress}: {icon: IconName; label: string; disabled: boolean; onPress: () => void}) {
  return (
    <Pressable disabled={disabled} style={[s.camera, disabled && s.dim]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}}>
      <IconTile name={icon} size={44} tone="green" />
      <Text style={s.photoText}>{label}</Text>
    </Pressable>
  );
}

function Steps({labels, step, hindi}: {labels: string[]; step: number; hindi: boolean}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${hindi ? 'चरण' : 'Step'} ${step + 1} / ${labels.length}: ${labels[step]}`}
      accessibilityValue={{min: 1, max: labels.length, now: step + 1}}
      style={s.progress}>
      {labels.map((label, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={[s.connector, i <= step && s.connectorDone]} />}
          <View style={s.progressItem}>
            <StepBadge n={i + 1} state={i < step ? 'done' : i === step ? 'current' : 'todo'} />
            {i === step && <Text style={[s.progressText, s.progressTextActive]}>{label}</Text>}
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function StepBadge({n, state}: {n: number; state: 'done' | 'current' | 'todo'}) {
  const fill = state === 'done' ? colors.green : colors.navy;
  const solid = state !== 'todo';
  return (
    <View style={[s.badge, solid ? raised(fill, {lip: 2, level: 'sm'}) : s.badgeTodo, solid && s.badgeSolid]}>
      {solid ? <GradientFill color={fill} direction="diagonal" absolute /> : null}
      {state === 'done' ? <Glyph name="check" size={15} color={colors.white} /> : <Text style={[s.badgeText, {color: solid ? colors.white : colors.textSecondary}]}>{n}</Text>}
    </View>
  );
}

const native = Platform.OS !== 'web';

/** Animated success mark: a green raised disc springs in, the tick pops, and a soft ring pulses outwards. Opacity-only when reduce motion is on. */
function SuccessMark({label}: {label: string}) {
  const [pop] = useState(() => new Animated.Value(0));
  const [tick] = useState(() => new Animated.Value(0));
  const [ring] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let stopped = false;
    let pulse: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then(reduced => {
        if (stopped) return;
        if (reduced) {
          pop.setValue(1);
          tick.setValue(1);
          return;
        }
        Animated.parallel([
          Animated.spring(pop, {toValue: 1, friction: 5, tension: 90, useNativeDriver: native}),
          Animated.sequence([Animated.delay(200), Animated.timing(tick, {toValue: 1, duration: 280, easing: Easing.out(Easing.back(2)), useNativeDriver: native})]),
        ]).start();
        pulse = Animated.loop(Animated.sequence([Animated.timing(ring, {toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: native}), Animated.delay(400)]));
        pulse.start();
      });
    return () => {
      stopped = true;
      pulse?.stop();
    };
  }, [pop, tick, ring]);
  const ringStyle = {
    opacity: ring.interpolate({inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0]}),
    transform: [{scale: ring.interpolate({inputRange: [0, 1], outputRange: [1, 1.9]})}],
  };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={s.successWrap}>
      <Animated.View style={[s.successRing, ringStyle]} />
      <Animated.View style={[s.successIcon, {transform: [{scale: pop}]}]}>
        <GradientFill color={colors.green} direction="diagonal" absolute />
        <Animated.View style={{opacity: tick, transform: [{scale: tick}]}}>
          <Glyph name="check" size={46} color={colors.white} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: {flex: 1},
  centered: {textAlign: 'center'},
  fullWidth: {alignSelf: 'stretch'},
  dim: {opacity: 0.5},
  fieldGap: {marginTop: 18},
  noMargin: {marginTop: 0, marginBottom: 0},
  state: {alignItems: 'center', gap: 14, paddingVertical: 36},
  tileCaption: {fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 2},
  catalogBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  textButton: {flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 4},
  progress: {flexDirection: 'row', alignItems: 'center', marginVertical: 20},
  progressItem: {flexDirection: 'row', alignItems: 'center', gap: 7},
  connector: {flex: 1, minWidth: 8, height: 4, borderRadius: 2, backgroundColor: colors.border, marginHorizontal: 8},
  connectorDone: {backgroundColor: colors.green},
  badge: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  badgeSolid: {overflow: 'hidden'},
  badgeTodo: {
    backgroundColor: colors.inset,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    boxShadow: [{inset: true, offsetX: 0, offsetY: 2, blurRadius: 3, color: rgba(colors.ink, 0.07)}],
  },
  badgeText: {fontSize: 13, fontWeight: '700'},
  progressText: {fontSize: 12, color: colors.textSecondary},
  progressTextActive: {color: colors.greenText, fontWeight: '700'},
  heading: {...textStyles.h1, letterSpacing: -0.5, marginTop: 8},
  copy: {...textStyles.body, marginTop: 12, marginBottom: 22},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 13},
  category: {...cardSurface(glass(0.9)), width: '47.5%', padding: 16, minHeight: 124, justifyContent: 'space-between'},
  categorySelected: {...cardSurface(glass(0.95, colors.saffronSoft), {border: colors.saffron}), borderBottomColor: colors.saffron},
  categoryName: {fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.ink, marginTop: 14},
  categoryNameSelected: {fontWeight: '700', color: colors.navy},
  categoryCheck: {...raised(colors.green, {lip: 2, level: 'sm'}), position: 'absolute', right: 8, top: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  selectedRow: {...cardSurface(glass(0.92, colors.greenSoft), {radius: radius.md}), padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center'},
  selectedLabel: {fontSize: 13, fontWeight: '600', color: colors.navy, flex: 1},
  change: {fontSize: 13, fontWeight: '600', color: colors.greenText},
  label: {...textStyles.label},
  photoHeader: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, alignItems: 'center'},
  small: {fontSize: 12, lineHeight: 19, color: colors.textSecondary},
  photoActions: {flexDirection: 'row', gap: 13, marginTop: 10},
  camera: {...cardSurface(glass(0.9), {radius: radius.lg}), flex: 1, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', gap: 10},
  photoText: {fontSize: 13, fontWeight: '500', color: colors.navy, textAlign: 'center'},
  photos: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 14},
  thumb: {position: 'relative'},
  photoFrame: {...cardSurface(colors.white, {lip: 3, level: 'sm', radius: radius.md}), padding: 3},
  photo: {width: 92, height: 82, borderRadius: radius.sm},
  remove: {...raised(colors.white, {lip: 2, level: 'sm'}), position: 'absolute', right: -8, top: -8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  gps: {...cardSurface(glass(0.92, colors.greenSoft), {radius: radius.lg, border: colors.green}), flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, marginBottom: 10},
  gpsText: {fontSize: typeScale.bodyMd.fontSize, color: colors.navy, fontWeight: '600', flex: 1},
  coordinates: {flexDirection: 'row', gap: 12},
  ward: {...cardSurface(glass(0.9)), flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 22},
  wardTitle: {fontSize: typeScale.bodyMd.fontSize, fontWeight: '600', color: colors.navy, marginBottom: 3},
  consent: {flexDirection: 'row', gap: 12, marginTop: 22, alignItems: 'flex-start'},
  consentText: {fontSize: 13, lineHeight: 21, color: colors.textSecondary, flex: 1},
  footer: {flexDirection: 'row', gap: 12, marginTop: 26, alignItems: 'center'},
  privateRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18},
  private: {fontSize: 12, color: colors.textSecondary, textAlign: 'center'},
  success: {alignItems: 'center', paddingVertical: 36, gap: 15},
  successWrap: {width: 120, height: 120, alignItems: 'center', justifyContent: 'center'},
  successRing: {position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: colors.green},
  successIcon: {...raised(colors.green, {lip: 5, level: 'lg'}), width: 88, height: 88, borderRadius: 44, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
  receipt: {...cardSurface(glass(0.92, colors.greenSoft), {radius: radius.lg, lip: 4}), padding: 22, width: '100%', alignItems: 'center', marginBottom: 12},
  receiptLabel: {...textStyles.eyebrow},
  receiptId: {fontSize: typeScale.titleSm.fontSize, lineHeight: 24, fontWeight: '700', color: colors.navy, marginVertical: 8, textAlign: 'center'},
  receiptStatusRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  receiptStatus: {fontSize: 12, color: colors.success, fontWeight: '600'},
});
