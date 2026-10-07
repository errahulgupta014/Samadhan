// Adds a few SAMPLE records so the app does not look empty while it is being reviewed: city guide + places, classified ads, activities,
// and complaints for ONE existing resident. It talks to a RUNNING LOCAL server through the normal API (owner cookie for admin actions,
// the resident's own session for complaints), so every business rule still applies. Nothing here is seeded automatically.
//
//   node scripts/seed-sample-data.mjs <10-digit mobile of a registered resident>
//   (env: TEST_BASE_URL default http://localhost:5173, TEST_OTP default 123456 — the local test OTP mode)
//
// Also sets the sample app configuration (tabs, tiles, support, maintenance off) and two ward updates with Hindi text. The app configuration is overwritten on every run;
// pass --keep-config to leave an existing configuration alone.
//
// Safe to re-run: ads, activities, places, ward updates and the city guide are skipped when they already exist; complaints are added only when the resident
// has fewer than three. To remove the samples later: archive the ads / unpublish the places in the admin portal.
import {base, TEST_OTP, ownerCookie} from '../tests/api-helpers.mjs';
import zlib from 'node:zlib';

const mobile = (process.argv[2] ?? '').replace(/\D/g, '').slice(-10);
if (!/^[6-9]\d{9}$/.test(mobile)) {
  console.error('Usage: node scripts/seed-sample-data.mjs <10-digit mobile of a registered resident>');
  process.exit(1);
}

/* ------------------------------------------------------------------ tiny PNG generator (no dependencies) */
function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** Soft sky-to-ground gradient with a simple skyline silhouette; `seed` varies the buildings. */
function scene(top, bottom, ink, seed) {
  const W = 640, H = 400;
  const heights = Array.from({length: 16}, (_, i) => 70 + ((i * 53 + seed * 37) % 110));
  return png(W, H, (x, y) => {
    const base = mix(top, bottom, y / H);
    const col = Math.floor(x / 40);
    const bh = heights[col % heights.length];
    return y > H - bh && x % 40 > 4 ? mix(base, ink, 0.55) : base;
  });
}

/* ------------------------------------------------------------------ API helpers */
const json = async res => {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = {raw: text}; }
  if (!res.ok) throw new Error(`${res.status} ${body.error ?? text.slice(0, 160)}`);
  return body;
};
const cookie = await ownerCookie();
const auth = (body, token) => fetch(base + '/api/resident-auth', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)}).then(json);
async function upload(buffer, name, headers) {
  const form = new FormData();
  form.append('file', new Blob([buffer], {type: 'image/png'}), name);
  return (await fetch(base + '/api/media', {method: 'POST', headers, body: form}).then(json)).id;
}
let version, data;
async function api(body, token) {
  const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers: {...(token ? {Authorization: `Bearer ${token}`} : {cookie}), 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify({...body, version})} : {})});
  const j = await json(res);
  if (j.version) { version = j.version; data = j.data; }
  return j;
}

/* ------------------------------------------------------------------ city guide + places (admin) */
await api();
if (!data.municipality?.published) {
  await api({action: 'save-municipality', municipality: {
    name: 'Jaipur', nameHi: 'जयपुर', district: 'Jaipur', state: 'Rajasthan', published: true,
    about: 'Jaipur is the capital of Rajasthan and one of India’s best-known heritage cities. Its busy bazaars, forts and palaces draw visitors from across the world, and its planned streets still follow the layout set out almost three centuries ago.',
    aboutHi: 'जयपुर राजस्थान की राजधानी और भारत के सबसे प्रसिद्ध विरासत शहरों में से एक है। यहाँ के बाज़ार, किले और महल दुनिया भर से पर्यटकों को आकर्षित करते हैं, और लगभग तीन सदी पहले तय किया गया इसका नियोजित ढाँचा आज भी दिखाई देता है।',
    history: 'Jaipur was founded in 1727 by Maharaja Sawai Jai Singh II of Amer. The city was planned on a grid of broad streets and rectangular blocks, with the work guided by the architect Vidyadhar Bhattacharya. The old city is often called the Pink City because its buildings were painted pink in 1876 for the visit of the Prince of Wales. In 2019 the Walled City of Jaipur was inscribed as a UNESCO World Heritage Site.',
    historyHi: 'जयपुर की स्थापना 1727 में आमेर के महाराजा सवाई जयसिंह द्वितीय ने की थी। शहर को चौड़ी सड़कों और आयताकार खंडों के नियोजित जाल के रूप में बसाया गया, जिसमें वास्तुकार विद्याधर भट्टाचार्य का मार्गदर्शन रहा। 1876 में प्रिंस ऑफ वेल्स के आगमन पर पुराने शहर की इमारतों को गुलाबी रंग से रंगा गया, इसलिए इसे गुलाबी नगर कहा जाता है। 2019 में जयपुर के परकोटा शहर को यूनेस्को विश्व धरोहर स्थल का दर्जा मिला।',
    sourceUrl: 'https://en.wikipedia.org/wiki/Jaipur',
  }});
  console.log('city guide published');
}
const places = [
  {name: 'Hawa Mahal', nameHi: 'हवा महल', address: 'Hawa Mahal Road, Badi Choupad, Jaipur 302002', mapUrl: 'https://www.google.com/maps/search/?api=1&query=Hawa+Mahal+Jaipur', sourceUrl: 'https://en.wikipedia.org/wiki/Hawa_Mahal', colors: [[250, 207, 170], [226, 120, 96], [80, 40, 40]],
    description: 'The “Palace of Winds” was built in 1799 by Maharaja Sawai Pratap Singh. Its pink sandstone front has 953 small windows (jharokhas) that let royal women watch street life unseen and keep the building cool.',
    descriptionHi: '“हवाओं का महल” 1799 में महाराजा सवाई प्रताप सिंह ने बनवाया था। गुलाबी बलुआ पत्थर के इसके मुखौटे में 953 छोटी खिड़कियाँ (झरोखे) हैं, जिनसे राजपरिवार की महिलाएँ बिना दिखे गली का नज़ारा देखती थीं और इमारत ठंडी रहती थी।'},
  {name: 'Amber Fort', nameHi: 'आमेर किला', address: 'Devisinghpura, Amer, Jaipur 302001', mapUrl: 'https://www.google.com/maps/search/?api=1&query=Amber+Fort+Jaipur', sourceUrl: 'https://en.wikipedia.org/wiki/Amer_Fort', colors: [[255, 224, 178], [230, 150, 70], [70, 45, 30]],
    description: 'A hill fort above Maota Lake, begun in 1592 by Raja Man Singh I. Its courtyards, mirrored halls and gateways are part of the “Hill Forts of Rajasthan”, inscribed as a UNESCO World Heritage Site in 2013.',
    descriptionHi: 'माओटा झील के ऊपर पहाड़ी पर बना किला, जिसकी नींव 1592 में राजा मान सिंह प्रथम ने रखी। इसके आँगन, शीशमहल और द्वार “राजस्थान के पहाड़ी किले” का हिस्सा हैं, जिन्हें 2013 में यूनेस्को विश्व धरोहर का दर्जा मिला।'},
  {name: 'City Palace', nameHi: 'सिटी पैलेस', address: 'Tripolia Gate, Jaleb Chowk, Gangori Bazaar, Jaipur 302002', mapUrl: 'https://www.google.com/maps/search/?api=1&query=City+Palace+Jaipur', sourceUrl: 'https://en.wikipedia.org/wiki/City_Palace,_Jaipur', colors: [[206, 226, 240], [90, 150, 190], [30, 55, 80]],
    description: 'The royal residence in the heart of the old city, built soon after Jaipur was founded. Parts of the palace remain home to the royal family, while the rest is a museum of textiles, weapons and manuscripts.',
    descriptionHi: 'पुराने शहर के बीच स्थित शाही निवास, जो जयपुर की स्थापना के कुछ समय बाद बना। महल का एक हिस्सा आज भी राजपरिवार का निवास है, जबकि बाकी हिस्से में वस्त्रों, हथियारों और पांडुलिपियों का संग्रहालय है।'},
  {name: 'Jantar Mantar', nameHi: 'जंतर मंतर', address: 'Gangori Bazaar, Jaipur 302002', mapUrl: 'https://www.google.com/maps/search/?api=1&query=Jantar+Mantar+Jaipur', sourceUrl: 'https://en.wikipedia.org/wiki/Jantar_Mantar,_Jaipur', colors: [[221, 236, 214], [120, 170, 120], [35, 70, 45]],
    description: 'An observatory of large stone instruments built by Maharaja Sawai Jai Singh II in the early 1700s to track time and the movement of the sun, moon and stars. It was inscribed as a UNESCO World Heritage Site in 2010.',
    descriptionHi: 'महाराजा सवाई जयसिंह द्वितीय द्वारा 1700 के दशक की शुरुआत में बनवाई गई विशाल पत्थर के यंत्रों वाली वेधशाला, जिससे समय और सूर्य, चंद्रमा व तारों की गति मापी जाती थी। इसे 2010 में यूनेस्को विश्व धरोहर का दर्जा मिला।'},
  {name: 'Jal Mahal', nameHi: 'जल महल', address: 'Man Sagar Lake, Amer Road, Jaipur 302002', mapUrl: 'https://www.google.com/maps/search/?api=1&query=Jal+Mahal+Jaipur', sourceUrl: 'https://en.wikipedia.org/wiki/Jal_Mahal', colors: [[214, 232, 246], [96, 160, 196], [28, 60, 84]],
    description: 'An 18th-century palace that seems to float in the middle of Man Sagar Lake. The lake-side walkway is a favourite evening spot for families, with a view of the Aravalli hills.',
    descriptionHi: 'अठारहवीं सदी का महल जो मान सागर झील के बीच तैरता हुआ-सा दिखता है। झील किनारे का रास्ता परिवारों की शाम की पसंदीदा जगह है, जहाँ से अरावली की पहाड़ियाँ दिखती हैं।'},
];
const havePlaces = new Set((data.places ?? []).map(p => p.name));
for (const [i, p] of places.entries()) {
  if (havePlaces.has(p.name)) continue;
  const [top, bottom, ink] = p.colors;
  const imageId = await upload(scene(top, bottom, ink, i + 1), `place-${i + 1}.png`, {cookie});
  await api({action: 'save-place', place: {name: p.name, nameHi: p.nameHi, description: p.description, descriptionHi: p.descriptionHi, address: p.address, hours: '', imageId, mapUrl: p.mapUrl, sourceUrl: p.sourceUrl, published: true, sortOrder: i}});
  console.log('place added:', p.name);
}

/* ------------------------------------------------------------------ classified ads (admin) */
const now = Date.now();
const ads = [
  {title: 'Fresh festival sweets, home delivered', titleHi: 'त्योहार की ताज़ा मिठाइयाँ, घर तक डिलीवरी', advertiser: 'Gulab Sweets & Snacks (sample)', colors: [[255, 226, 190], [240, 150, 80], [90, 45, 20]],
    description: 'Order boxes of freshly made mithai and namkeen for Diwali and weddings. Free home delivery inside the ward on orders above ₹500. This is a sample listing.',
    descriptionHi: 'दीवाली और शादियों के लिए ताज़ी मिठाई और नमकीन के डिब्बे ऑर्डर करें। ₹500 से अधिक के ऑर्डर पर वार्ड में निःशुल्क होम डिलीवरी। यह एक नमूना विज्ञापन है।'},
  {title: 'Spoken English & computer basics — new batch', titleHi: 'स्पोकन इंग्लिश और कंप्यूटर बेसिक्स — नया बैच', advertiser: 'Pink City Learning Hub (sample)', colors: [[214, 230, 250], [100, 140, 210], [30, 45, 90]],
    description: 'Evening classes for students and homemakers: spoken English, typing and basic computer skills. Small groups, certificate on completion. This is a sample listing.',
    descriptionHi: 'विद्यार्थियों और गृहिणियों के लिए शाम की कक्षाएँ: स्पोकन इंग्लिश, टाइपिंग और कंप्यूटर की बुनियादी जानकारी। छोटे समूह, पूरा होने पर प्रमाणपत्र। यह एक नमूना विज्ञापन है।'},
  {title: 'Plants for balconies and small gardens', titleHi: 'बालकनी और छोटे बगीचों के लिए पौधे', advertiser: 'Green Roots Nursery (sample)', colors: [[220, 240, 214], [110, 175, 110], [30, 75, 40]],
    description: 'Tulsi, money plant, herbs and flowering plants with pots and organic compost. Advice on keeping plants healthy through the Jaipur summer. This is a sample listing.',
    descriptionHi: 'तुलसी, मनी प्लांट, जड़ी-बूटियाँ और फूलों के पौधे, गमलों और जैविक खाद के साथ। जयपुर की गर्मी में पौधों को स्वस्थ रखने की सलाह। यह एक नमूना विज्ञापन है।'},
  {title: 'Sunday morning community cycle ride', titleHi: 'रविवार सुबह सामुदायिक साइकिल राइड', advertiser: 'Jaipur Cycle Club (sample)', colors: [[255, 236, 200], [236, 176, 90], [80, 55, 25]],
    description: 'A relaxed 10 km group ride every Sunday at 6:30 AM. All ages welcome; helmets recommended. Meet at the ward park gate. This is a sample listing.',
    descriptionHi: 'हर रविवार सुबह 6:30 बजे 10 किमी की आरामदायक ग्रुप राइड। सभी उम्र के लोग आमंत्रित; हेलमेट पहनना बेहतर। वार्ड पार्क के गेट पर मिलें। यह एक नमूना विज्ञापन है।'},
];
const haveAds = new Set((data.classifieds ?? []).map(a => a.title));
for (const [i, ad] of ads.entries()) {
  if (haveAds.has(ad.title)) continue;
  const [top, bottom, ink] = ad.colors;
  const imageId = await upload(scene(top, bottom, ink, i + 11), `ad-${i + 1}.png`, {cookie});
  const saved = await api({action: 'save-classified', classified: {title: ad.title, titleHi: ad.titleHi, description: ad.description, descriptionHi: ad.descriptionHi, advertiser: ad.advertiser, contactPhone: '', imageId, url: '', startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 90 * 86400000).toISOString()}});
  await api({action: 'publish-classified', id: saved.id, status: 'published'});
  console.log('ad published:', ad.title);
}

/* ------------------------------------------------------------------ activities: campaigns and programmes (admin) */
// Published, upcoming and ongoing (endsAt in the future). Idempotent by title; publishing creates the resident notification once.
const DAY = 86400000;
const activities = [
  {title: 'Swachh Nagar cleanliness drive', titleHi: 'स्वच्छ नगर सफाई अभियान', organizer: 'Nagar Parishad, Jaipur (sample)', organizerHi: 'नगर परिषद, जयपुर (नमूना)', venue: 'Ward park gate and main market lane', venueHi: 'वार्ड पार्क गेट और मुख्य बाज़ार की गली',
    startsAt: now + 2 * DAY, endsAt: now + 2 * DAY + 5 * 3600000, colors: [[220, 240, 214], [110, 175, 110], [30, 75, 40]],
    description: 'A ward-wide cleanliness drive: residents, shopkeepers and sanitation workers clean lanes, clear drains and sort waste together. Gloves and bags are provided. Bring a broom if you can. This is a sample listing.',
    descriptionHi: 'वार्ड-व्यापी सफाई अभियान: निवासी, दुकानदार और सफाई कर्मचारी मिलकर गलियाँ साफ़ करेंगे, नालियाँ खोलेंगे और कचरे को अलग करेंगे। दस्ताने और थैले उपलब्ध हैं। हो सके तो अपनी झाड़ू लाएँ। यह एक नमूना सूचना है।'},
  {title: 'Free health check-up and vaccination camp', titleHi: 'निःशुल्क स्वास्थ्य जाँच एवं टीकाकरण शिविर', organizer: 'Panchayat Samiti, Amer (sample)', organizerHi: 'पंचायत समिति, आमेर (नमूना)', venue: 'Community health centre, Amer', venueHi: 'सामुदायिक स्वास्थ्य केंद्र, आमेर',
    startsAt: now + 5 * DAY, endsAt: now + 5 * DAY + 7 * 3600000, colors: [[214, 230, 250], [100, 140, 210], [30, 45, 90]],
    description: 'Free blood pressure and sugar checks, eye screening and routine childhood vaccination, with doctors from the block health office. Carry your Aadhaar card and any vaccination card. This is a sample listing.',
    descriptionHi: 'ब्लॉक स्वास्थ्य कार्यालय के डॉक्टरों द्वारा निःशुल्क रक्तचाप और शुगर जाँच, आँखों की जाँच और बच्चों का नियमित टीकाकरण। अपना आधार कार्ड और टीकाकरण कार्ड साथ लाएँ। यह एक नमूना सूचना है।'},
  {title: 'Tree plantation drive — one sapling per home', titleHi: 'वृक्षारोपण अभियान — हर घर एक पौधा', organizer: 'Nagar Parishad, Jaipur (sample)', organizerHi: 'नगर परिषद, जयपुर (नमूना)', venue: 'Ward park and roadside plots', venueHi: 'वार्ड पार्क और सड़क किनारे की जगहें',
    startsAt: now + 9 * DAY, endsAt: now + 9 * DAY + 4 * 3600000, colors: [[226, 240, 206], [128, 184, 96], [34, 78, 36]],
    description: 'Every household is invited to plant and adopt a sapling. Neem, peepal and gulmohar saplings are given free at the venue, and volunteers will help with planting and tree guards. This is a sample listing.',
    descriptionHi: 'हर परिवार को एक पौधा लगाने और उसे अपनाने के लिए आमंत्रित किया जाता है। नीम, पीपल और गुलमोहर के पौधे स्थल पर निःशुल्क दिए जाएँगे, और स्वयंसेवक रोपण व ट्री-गार्ड में मदद करेंगे। यह एक नमूना सूचना है।'},
];
const haveActivities = new Set((data.activities ?? []).map(a => a.title));
for (const [i, a] of activities.entries()) {
  if (haveActivities.has(a.title)) continue;
  const [top, bottom, ink] = a.colors;
  const imageId = await upload(scene(top, bottom, ink, i + 41), `activity-${i + 1}.png`, {cookie});
  const saved = await api({action: 'save-activity', activity: {title: a.title, titleHi: a.titleHi, description: a.description, descriptionHi: a.descriptionHi, organizer: a.organizer, organizerHi: a.organizerHi, venue: a.venue, venueHi: a.venueHi, startsAt: new Date(a.startsAt).toISOString(), endsAt: new Date(a.endsAt).toISOString(), imageId, contactPhone: '', url: ''}});
  await api({action: 'publish-activity', id: saved.id, status: 'published'});
  console.log('activity published:', a.title);
}

/* ------------------------------------------------------------------ app configuration (admin) */
// Sample configuration for the local workspace: every tab and Home tile on, no maintenance, no minimum version. The support phone, email, hours and the terms / privacy links
// stay EMPTY on purpose: they are published to every resident phone, so they must come from the product owner in the portal (App settings), never from sample data.
if (process.argv.includes('--keep-config') && data.settings.appConfig) console.log('app configuration left as it is (--keep-config)');
else {
  await api({action: 'save-app-config', appConfig: {
    orgLabel: {en: 'Panchayat Samiti and Nagar Parishad', hi: 'पंचायत समिति और नगर परिषद'},
    support: {phone: '', email: '', hoursEn: '', hoursHi: ''},
    termsUrl: '', privacyUrl: '',
    tabs: {classifieds: true, activities: true, city: true},
    tiles: {classifieds: true, activities: true, city: true, notices: true},
    maintenance: {enabled: false, messageEn: '', messageHi: ''},
    minAppVersion: '',
  }});
  console.log('app configuration set');
}

/* ------------------------------------------------------------------ ward updates (admin) */
// Two sample notices with Hindi text: one Important (ends in a week) and one Service notice (no end date). Idempotent by title.
const notices = [
  {title: 'Water supply paused on Sunday morning (sample)', titleHi: 'रविवार सुबह जलापूर्ति बंद रहेगी (नमूना)', priority: 'Important', endsAt: new Date(now + 7 * DAY).toISOString(),
    body: 'Because of pipeline maintenance, water supply in the ward will be paused on Sunday from 6 AM to 10 AM. Please store enough water in advance. This is a sample notice.',
    bodyHi: 'पाइपलाइन के रखरखाव के कारण वार्ड में रविवार को सुबह 6 से 10 बजे तक जलापूर्ति बंद रहेगी। कृपया पहले से पर्याप्त पानी भरकर रखें। यह एक नमूना सूचना है।'},
  {title: 'Ward office timings and help desk (sample)', titleHi: 'वार्ड कार्यालय का समय और हेल्प डेस्क (नमूना)', priority: 'Service notice',
    body: 'The ward office is open Monday to Saturday, 10 AM to 5 PM. You can report an issue in this app and follow its progress under My complaints. This is a sample notice.',
    bodyHi: 'वार्ड कार्यालय सोमवार से शनिवार, सुबह 10 से शाम 5 बजे तक खुला रहता है। आप इस ऐप में समस्या दर्ज कर सकते हैं और "मेरी शिकायतें" में उसकी प्रगति देख सकते हैं। यह एक नमूना सूचना है।'},
];
const haveNotices = new Set((data.announcements ?? []).map(a => a.title));
for (const n of notices) {
  if (haveNotices.has(n.title)) continue;
  await api({action: 'save-announcement', announcement: {title: n.title, titleHi: n.titleHi, body: n.body, bodyHi: n.bodyHi, priority: n.priority, ...(n.endsAt ? {endsAt: n.endsAt} : {}), status: 'published'}});
  console.log('ward update published:', n.title);
}

/* ------------------------------------------------------------------ complaints for the resident */
await auth({action: 'send-otp', mobile});
const login = await auth({action: 'verify-otp', mobile, code: TEST_OTP});
if (!login.registered) { console.error('That mobile number is not registered yet. Register it in the app first, then re-run.'); process.exit(1); }
const token = login.token;
await api(undefined, token);
const mine = () => data.complaints.length;
if (mine() >= 3) {
  console.log(`resident already has ${mine()} complaints; leaving complaints alone`);
} else {
  const specs = [
    {category: 'Road & Footpath', title: 'Deep pothole on the main lane', description: 'A deep pothole near the corner has been growing since the last rain and two-wheelers swerve around it. Please repair the road surface.', locality: 'Gandhi Nagar, near the corner shop', lat: 26.9129, lng: 75.7871, colors: [[205, 205, 200], [120, 120, 118], [40, 40, 40]], stage: 'Submitted'},
    {category: 'Garbage & Cleaning', title: 'Garbage not collected for three days', description: 'The community bin at the end of the lane is overflowing and the smell is spreading. Collection has not happened for three days.', locality: 'Shastri Nagar, lane 4', lat: 26.9145, lng: 75.7892, colors: [[226, 220, 196], [150, 140, 100], [50, 45, 30]], stage: 'Acknowledged'},
    {category: 'Streetlight & Electrical', title: 'Streetlight not working near the park', description: 'The streetlight at the park gate has been off for a week, which makes the road unsafe for walkers after dark.', locality: 'Near the ward park gate', lat: 26.9118, lng: 75.7856, colors: [[40, 50, 80], [20, 28, 52], [10, 12, 24]], stage: 'In Progress'},
    {category: 'Water', title: 'Low water pressure in the morning', description: 'Water pressure drops sharply between 6 and 8 AM, and the upper floors get almost nothing. Please check the supply line.', locality: 'Lane 7, opposite the temple', lat: 26.9136, lng: 75.7903, colors: [[196, 224, 240], [96, 152, 196], [24, 56, 84]], stage: 'Resolution Proposed'},
    {category: 'Drainage & Sewer', title: 'Blocked drain after the rain', description: 'The drain beside the school wall is blocked and dirty water stands on the road. This has now been cleaned and flows freely.', locality: 'School road, Shastri Nagar', lat: 26.9152, lng: 75.7881, colors: [[190, 210, 200], [90, 130, 120], [24, 50, 44]], stage: 'Closed'},
  ];
  for (const [i, spec] of specs.entries()) {
    const [top, bottom, ink] = spec.colors;
    const photo = await upload(scene(top, bottom, ink, i + 21), `complaint-${i + 1}.png`, {Authorization: `Bearer ${token}`});
    const created = await api({action: 'create', view: 'resident', category: spec.category, title: spec.title, description: spec.description, locality: spec.locality, lat: spec.lat, lng: spec.lng, media: [photo], consent: true}, token);
    const id = created.id;
    const steps = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'Resolution Proposed', 'Closed'];
    const target = steps.indexOf(spec.stage);
    const team = {'Road & Footpath': 'Roads & Infrastructure', 'Garbage & Cleaning': 'Sanitation Team', 'Streetlight & Electrical': 'Electrical Team', Water: 'Water & Drainage', 'Drainage & Sewer': 'Water & Drainage'}[spec.category];
    const notes = {Acknowledged: 'We have received your complaint and registered it with the ward office.', Assigned: `Assigned to the ${team}.`, 'In Progress': 'Work has started at the location.', 'Resolution Proposed': 'Work completed. Please confirm if the issue is resolved.'};
    for (let s = 1; s <= Math.min(target, 4); s++) {
      if (steps[s] === 'Assigned') await api({action: 'edit', id, assignee: team});
      if (steps[s] === 'Resolution Proposed') {
        const after = await upload(scene(top.map(v => Math.min(255, v + 25)), bottom.map(v => Math.min(255, v + 25)), ink, i + 31), `after-${i + 1}.png`, {cookie});
        await api({action: 'edit', id, afterMedia: [after]});
      }
      await api({action: 'transition', id, status: steps[s], note: notes[steps[s]]});
    }
    if (spec.stage === 'Closed') {
      // Reaching Resolution Proposed already issued the closure code; in local test OTP mode it is the fixed test code.
      await api({action: 'verify-closure', id, code: TEST_OTP}, token);
    }
    console.log('complaint added:', spec.title, '→', spec.stage);
  }
}
console.log('Sample data ready.');
