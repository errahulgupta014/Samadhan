import assert from 'node:assert/strict';
import {base, png, ownerCookie, registerResident, ensureWard} from './api-helpers.mjs';
/**
 * API test for the product rule "only a Super Admin may delete records", against a running dev server (default http://localhost:5173) in TEST OTP MODE.
 *
 * The Super Admin is the local owner identity (ownerCookie). A throwaway administrator with a Content Editor-like Custom role (announcements, classifieds, activities, city, settings
 * and residents management, but NOT admins.manage) is created through POST /api/admin-auth as Admin / Admin (override with TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD) and signs in with its own cookie.
 * Proved: that administrator can save every kind of content, but gets 403 "Only a Super Admin can delete records." from delete-announcement, delete-classified, delete-activity, delete-place,
 * delete-ward and delete-resident, from a save-banners that removes a banner or restores the supplied ones, and from a save-departments that removes a department (and from delete-user);
 * nothing is removed by those refusals; the Super Admin can delete the very same records. Every QA record and the QA administrator are removed again, the banner and department lists are restored.
 */
const ADMIN_USER = process.env.TEST_ADMIN_USERNAME || 'Admin', ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin';
const DENIED = 'Only a Super Admin can delete records.', STRONG = 'Qa-Sturdy-Pass-91';
const PERMISSIONS = ['announcements.manage', 'classifieds.manage', 'activities.manage', 'city.manage', 'settings.manage', 'residents.manage'];
const nonce = Date.now().toString(36), DAY = 86400000;
const portal = {'x-samadhan-portal': '1'};
const cookieOf = res => res.headers.getSetCookie().map(v => v.split(';')[0]).find(v => v.startsWith('samadhan_admin=')) ?? null;

/** POST /api/admin-auth. */
async function auth(body, cookie) {
 const res = await fetch(base + '/api/admin-auth', {method: 'POST', headers: {'Content-Type': 'application/json', ...(cookie ? {cookie} : {})}, body: JSON.stringify(body)});
 let json = {}; try {json = await res.json();} catch {}
 return {status: res.status, json, cookie: cookieOf(res)};
}
/** One workspace request as the person holding `cookie` (a POST reads the current version first). Returns {status, json}. */
async function ws(cookie, body) {
 const headers = {cookie, ...(cookie.startsWith('samadhan_admin=') ? portal : {}), 'Content-Type': 'application/json'}; // an administrator account signs in like the portal does; the owner cookie is the local platform identity
 const version = body ? (await (await fetch(base + '/api/workspace', {headers})).json()).version : undefined;
 const res = await fetch(base + '/api/workspace', {method: body ? 'POST' : 'GET', headers, ...(body ? {body: JSON.stringify({...body, version})} : {})});
 let json = {}; try {json = await res.json();} catch {}
 return {status: res.status, json};
}
const refused = (r, label) => {assert.equal(r.status, 403, `${label}: ${JSON.stringify(r.json)}`); assert.equal(r.json.error, DENIED, label);};
const ok = (r, label) => {assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.json)}`); return r;};

const superCookie = await ownerCookie();
const admin = await auth({action: 'login', username: ADMIN_USER, password: ADMIN_PASSWORD});
assert.equal(admin.status, 200, `Admin sign-in failed (${admin.status}). If the Admin password was changed, set TEST_ADMIN_PASSWORD.`);
const made = {userId: null, announcement: null, classified: null, activity: null, place: null, ward: null, resident: null};
let originalBanners, originalDepartments;

try {
 // ---------------------------------------------------------------- the throwaway limited administrator
 const username = `qa-nodelete-${nonce}`;
 const created = await auth({action: 'create-user', username, name: 'QA No Delete', email: '', password: STRONG, role: 'Custom', permissions: PERMISSIONS, mustChangePassword: false}, admin.cookie);
 assert.equal(created.status, 200, JSON.stringify(created.json)); made.userId = created.json.user.id;
 assert.deepEqual([...created.json.user.permissions].sort(), [...PERMISSIONS].sort()); assert.equal(created.json.user.permissions.includes('admins.manage'), false);
 const login = await auth({action: 'login', username, password: STRONG});
 assert.equal(login.status, 200, JSON.stringify(login.json)); assert.ok(login.cookie); assert.ok(!login.json.user.mustChangePassword, 'the QA user is not forced to change the password');
 const limited = login.cookie;

 const superView = ok(await ws(superCookie), 'super admin workspace'); assert.equal(superView.json.data.viewer.role, 'Super Admin');
 const limitedView = ok(await ws(limited), 'limited workspace'); assert.equal(limitedView.json.data.viewer.role, 'Custom'); assert.deepEqual([...limitedView.json.data.viewer.permissions].sort(), [...PERMISSIONS].sort());
 originalBanners = superView.json.data.settings.brandingBanners; originalDepartments = superView.json.data.settings.departments;

 // ---------------------------------------------------------------- QA records created by the Super Admin
 const form = new FormData(); form.append('file', new Blob([png], {type: 'image/png'}), 'qa-delete.png');
 const upload = await fetch(base + '/api/media', {method: 'POST', headers: {cookie: superCookie}, body: form}); assert.equal(upload.status, 200); const image = (await upload.json()).id;
 const notice = {title: `QA delete notice ${nonce}`, titleHi: '', body: 'Synthetic notice used to check who may delete records.', bodyHi: '', priority: 'Service notice', endsAt: '', status: 'published'};
 made.announcement = ok(await ws(superCookie, {action: 'save-announcement', announcement: notice}), 'save-announcement').json.id;
 made.classified = ok(await ws(superCookie, {action: 'save-classified', classified: {title: `QA delete ad ${nonce}`, titleHi: '', description: 'Synthetic advertisement used to check who may delete records.', descriptionHi: '', advertiser: 'QA only', advertiserHi: '', contactPhone: '', url: '', imageId: '', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString()}}), 'save-classified').json.id;
 made.activity = ok(await ws(superCookie, {action: 'save-activity', activity: {title: `QA delete activity ${nonce}`, titleHi: '', description: 'Synthetic programme used to check who may delete records.', descriptionHi: '', organizer: 'QA only', organizerHi: '', venue: 'QA ground', venueHi: '', startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString(), imageId: '', contactPhone: '', url: ''}}), 'save-activity').json.id;
 made.place = ok(await ws(superCookie, {action: 'save-place', place: {name: `QA delete place ${nonce}`, nameHi: '', description: 'Synthetic place used to check who may delete records.', descriptionHi: '', address: 'QA road, Jaipur', addressHi: '', hours: '', hoursHi: '', imageId: '', mapUrl: '', sourceUrl: '', published: false, sortOrder: 99}}), 'save-place').json.id;
 made.ward = ok(await ws(superCookie, {action: 'save-ward', ward: {number: 'D' + nonce.slice(-5).toUpperCase(), name: `QA delete ward ${nonce}`, nameHi: '', city: 'QA City', memberName: '', memberNameHi: '', active: true}}), 'save-ward').json.wardId;
 await registerResident('QA SA Delete', (await ensureWard()).id);
 made.resident = (await ws(superCookie)).json.data.residents.find(r => r.name.startsWith('QA SA Delete'))?.id; assert.ok(made.resident, 'the QA resident is listed for administrators');
 const banners = [{id: 'qa-del-1-' + nonce, title: 'QA delete banner one', imageId: image, enabled: true}, {id: 'qa-del-2-' + nonce, title: 'QA delete banner two', imageId: image, enabled: false}];
 ok(await ws(superCookie, {action: 'save-banners', banners}), 'the Super Admin saves two banners');
 ok(await ws(superCookie, {action: 'save-departments', departments: [...originalDepartments, {name: `QA delete dept ${nonce}`, contactName: 'QA Contact', contactPhone: '98765 00098', active: true}]}), 'the Super Admin adds a department');
 const departments = () => ws(superCookie).then(r => r.json.data.settings.departments);
 const qaDepartment = (await departments()).find(d => d.name === `QA delete dept ${nonce}`); assert.ok(qaDepartment && qaDepartment.id);

 /** Everything made above is still there (a refusal removes nothing). */
 const untouched = async label => {
  const d = (await ws(superCookie)).json.data;
  assert.ok(d.announcements.some(a => a.id === made.announcement), label + ': notice');
  assert.ok(d.classifieds.some(a => a.id === made.classified), label + ': ad');
  assert.ok(d.activities.some(a => a.id === made.activity), label + ': activity');
  assert.ok(d.places.some(p => p.id === made.place), label + ': place');
  assert.ok(d.wards.some(w => w.id === made.ward), label + ': ward');
  assert.ok(d.residents.some(r => r.id === made.resident), label + ': app user');
  assert.ok(d.settings.brandingBanners.some(b => b.id === banners[0].id) && d.settings.brandingBanners.some(b => b.id === banners[1].id), label + ': banners');
  assert.ok(d.settings.departments.some(x => x.id === qaDepartment.id), label + ': department');
 };

 // ---------------------------------------------------------------- the limited administrator: saving works, deleting never does
 ok(await ws(limited, {action: 'save-announcement', announcement: {...notice, id: made.announcement, title: notice.title + ' (edited)'}}), 'the limited administrator may edit content');
 ok(await ws(limited, {action: 'save-banners', banners: banners.map(b => ({...b, enabled: !b.enabled}))}), 'switching banners on and off is not a deletion');
 const three = [...banners, {id: 'qa-del-3-' + nonce, title: 'QA delete banner three', imageId: image, enabled: false}];
 ok(await ws(limited, {action: 'save-banners', banners: three}), 'adding a banner is not a deletion');
 refused(await ws(limited, {action: 'save-banners', banners}), 'save-banners that removes a banner');
 refused(await ws(limited, {action: 'save-banners', restoreDefault: true}), 'save-banners restoreDefault (removes the custom banners)');
 refused(await ws(limited, {action: 'save-banners', banners: []}), 'save-banners with an empty list');
 // Swapping one banner for a different one keeps the list the same length but still removes a banner.
 refused(await ws(limited, {action: 'save-banners', banners: [three[0], three[1], {...three[2], id: 'qa-del-swap-' + nonce}]}), 'save-banners that swaps a banner for another (same length)');
 assert.equal((await ws(superCookie)).json.data.settings.brandingBanners.length, 3, 'all three banners are still published');
 ok(await ws(superCookie, {action: 'save-banners', banners}), 'the Super Admin may remove the third banner');
 assert.equal((await ws(superCookie)).json.data.settings.brandingBanners.length, 2);

 const withQa = await departments();
 ok(await ws(limited, {action: 'save-departments', departments: withQa.map(d => d.id === qaDepartment.id ? {...d, contactName: 'QA Contact Edited'} : d)}), 'editing a department is not a deletion');
 refused(await ws(limited, {action: 'save-departments', departments: withQa.filter(d => d.id !== qaDepartment.id)}), 'save-departments that removes a department');
 assert.ok((await departments()).some(d => d.id === qaDepartment.id && d.contactName === 'QA Contact Edited'), 'the department is still there');

 for (const [action, id] of [['delete-announcement', made.announcement], ['delete-classified', made.classified], ['delete-activity', made.activity], ['delete-place', made.place], ['delete-ward', made.ward], ['delete-resident', made.resident]]) {
  refused(await ws(limited, {action, id}), action);
  refused(await ws(limited, {action}), action + ' without an id');
 }
 assert.equal((await auth({action: 'delete-user', id: made.userId}, login.cookie)).status, 403, 'delete-user needs admins.manage');
 await untouched('after every refusal');

 // ---------------------------------------------------------------- the Super Admin deletes the same records
 for (const [action, id, field] of [['delete-announcement', made.announcement, 'announcement'], ['delete-classified', made.classified, 'classified'], ['delete-activity', made.activity, 'activity'], ['delete-place', made.place, 'place'], ['delete-ward', made.ward, 'ward'], ['delete-resident', made.resident, 'resident']]) {
  const r = ok(await ws(superCookie, {action, id}), 'super admin ' + action); assert.equal(r.json.deleted, true, action + ' reports deleted'); made[field] = null;
 }
 const after = (await ws(superCookie)).json.data;
 assert.ok(!after.announcements.some(a => a.title.startsWith(`QA delete notice ${nonce}`)) && !after.classifieds.some(a => a.title.includes(nonce)) && !after.activities.some(a => a.title.includes(nonce)) && !after.places.some(p => p.name.includes(nonce)) && !after.wards.some(w => w.name.includes(nonce)) && !after.residents.some(r => r.name.startsWith('QA SA Delete')), 'the Super Admin removed them all');
 ok(await ws(superCookie, {action: 'save-departments', departments: originalDepartments}), 'the Super Admin may remove a department');
 assert.ok(!(await departments()).some(d => d.id === qaDepartment.id));
 ok(await ws(superCookie, {action: 'save-banners', ...(originalBanners ? {banners: originalBanners} : {restoreDefault: true})}), 'the Super Admin may restore the supplied banners'); originalBanners = 'restored';
 console.log('PASS: a Custom administrator with announcements, classifieds, activities, city, settings and residents access can save content but gets 403 "Only a Super Admin can delete records." from delete-announcement, delete-classified, delete-activity, delete-place, delete-ward, delete-resident, a banner-removing or banner-restoring save-banners and a department-removing save-departments; nothing was removed; the Super Admin deleted the same records. QA data removed.');
} finally {
 // Whatever happened above, leave nothing behind: the Super Admin removes leftovers, restores the banner and department lists, then the QA administrator is deleted.
 try {
  const data = (await ws(superCookie)).json.data;
  for (const [action, id] of [['delete-announcement', made.announcement], ['delete-classified', made.classified], ['delete-activity', made.activity], ['delete-place', made.place], ['delete-ward', made.ward], ['delete-resident', made.resident]]) if (id) await ws(superCookie, {action, id});
  for (const r of data.residents ?? []) if (r.name.startsWith('QA SA Delete')) await ws(superCookie, {action: 'delete-resident', id: r.id});
  if (originalDepartments) await ws(superCookie, {action: 'save-departments', departments: originalDepartments});
  if (originalBanners && originalBanners !== 'restored') await ws(superCookie, {action: 'save-banners', banners: originalBanners});
  else if (originalBanners === undefined && data.settings.brandingBanners?.some(b => String(b.id).startsWith('qa-del-'))) await ws(superCookie, {action: 'save-banners', restoreDefault: true});
 } catch (e) {console.error('QA data cleanup failed:', e.message);}
 if (made.userId) await auth({action: 'delete-user', id: made.userId}, admin.cookie);
 await auth({action: 'logout'}, admin.cookie);
}
