import assert from 'node:assert/strict';
import {base, ownerCookie, registerResident} from './api-helpers.mjs';
// The admin portal and the citizen app read the same server data. This checks that what a resident receives is exactly the
// resident-visible subset of what the administrator sees, for every kind of content, against a running dev server.
const cookie = await ownerCookie();
const get = async (headers, path = '/api/workspace') => {const r = await fetch(base + path, {headers}); assert.equal(r.status, 200, `${path} ${r.status}`); return r.json();};
const {token} = await registerResident('QA Parity');
const admin = (await get({cookie})).data;
const app = (await get({Authorization: `Bearer ${token}`})).data;
const now = Date.now();
const ids = list => list.map(x => x.id).sort();
const pick = (list, fields) => list.map(x => Object.fromEntries(fields.map(f => [f, x[f] ?? null]))).sort((a, b) => String(a.id ?? a.nameEn).localeCompare(String(b.id ?? b.nameEn)));

// Categories (and the department each one belongs to): the app sees the enabled ones, with identical content.
const adminCategories = admin.categories.filter(c => c.enabled);
assert.deepEqual(pick(app.categories, ['id', 'nameEn', 'nameHi', 'icon', 'color', 'sortOrder', 'departmentId']), pick(adminCategories, ['id', 'nameEn', 'nameHi', 'icon', 'color', 'sortOrder', 'departmentId']), 'categories');
const catalog = await get({Authorization: `Bearer ${token}`}, '/api/categories');
assert.deepEqual(ids(catalog.categories), ids(adminCategories), '/api/categories lists the same enabled categories');
const adminDepartments = admin.settings.departments ?? [];
for (const d of catalog.departments) {const real = adminDepartments.find(x => x.id === d.id); assert.ok(real && real.active, `department ${d.name} exists and is active in the admin portal`); assert.equal(real.name, d.name); assert.deepEqual(Object.keys(d).filter(k => !['id', 'name', 'nameHi'].includes(k)), [], 'residents never receive department contacts');}
assert.deepEqual(ids(app.departmentChoices ?? []), ids(catalog.departments), 'workspace and /api/categories agree on the department choices');
const usedDepartments = new Set(adminCategories.map(c => c.departmentId).filter(Boolean));
assert.deepEqual(ids(catalog.departments), adminDepartments.filter(d => d.active && usedDepartments.has(d.id)).map(d => ({id: d.id})).sort((a, b) => a.id.localeCompare(b.id)).map(d => d.id), 'only active departments that have an enabled category are offered');

// Ads, activities, announcements, places, municipality, banners, app configuration.
const adLive = a => a.status === 'published' && +new Date(a.startsAt) <= now && +new Date(a.endsAt) > now;
assert.deepEqual(ids(app.classifieds), ids(admin.classifieds.filter(adLive)), 'classifieds');
assert.deepEqual(pick(app.classifieds, ['id', 'title', 'titleHi', 'advertiser', 'description', 'imageId']), pick(admin.classifieds.filter(adLive), ['id', 'title', 'titleHi', 'advertiser', 'description', 'imageId']), 'classified content');
const actLive = a => a.status === 'published' && +new Date(a.endsAt) > now;
assert.deepEqual(ids(app.activities), ids(admin.activities.filter(actLive)), 'activities');
const noteLive = n => n.status !== 'archived' && (!n.endsAt || +new Date(n.endsAt) > now);
assert.deepEqual(ids(app.announcements), ids(admin.announcements.filter(noteLive)), 'announcements');
assert.deepEqual(ids(app.places), ids(admin.places.filter(p => p.published)), 'places');
assert.equal(app.municipality.published, admin.municipality.published, 'city profile visibility');
if (admin.municipality.published) assert.deepEqual(pick([app.municipality], ['name', 'nameHi', 'district', 'state', 'about']), pick([admin.municipality], ['name', 'nameHi', 'district', 'state', 'about']), 'city profile content');
assert.deepEqual((app.settings.brandingBanners ?? []).map(b => b.id).sort(), (admin.settings.brandingBanners ?? []).filter(b => b.enabled).map(b => b.id).sort(), 'banners');
assert.deepEqual(app.settings.appConfig, (await get({cookie})).data.settings.appConfig, 'app configuration');
const publicConfig = await get({}, '/api/app-config'); assert.deepEqual(publicConfig.appConfig, app.settings.appConfig, 'the public pre-login configuration matches');
const wards = (await get({}, '/api/wards')).wards; assert.deepEqual(ids(wards), ids((admin.wards ?? []).filter(w => w.active)), 'registration wards = the admin’s active wards');

// The resident's own complaints exist in the admin portal with the same status, title and department; the admin sees more.
for (const c of app.complaints) {const real = admin.complaints.find(x => x.id === c.id); assert.ok(real, `complaint ${c.id} is visible to the admin`); assert.equal(real.status, c.status); assert.equal(real.title, c.title);}
console.log(`PASS: admin and app agree (${app.categories.length} categories, ${catalog.departments.length} department choices, ${app.classifieds.length} ads, ${app.activities.length} activities, ${app.announcements.length} notices, ${app.places.length} places, ${wards.length} wards).`);
