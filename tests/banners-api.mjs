import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://localhost:5173';
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const get=async(resident=false)=>{const r=await fetch(base+'/api/workspace'+(resident?'?view=resident':''),{headers:{cookie}});assert.equal(r.status,200);return r.json();};
const original=await get();
// Obtain a real local resident credential through the API, never use the owner cookie for resident-media checks.
const pair=await fetch(base+'/api/workspace',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'pair-mobile'})});assert.equal(pair.status,200);const {token}=await pair.json();
const residentHeaders={Authorization:`Bearer ${token}`};
const resident=await (await fetch(base+'/api/workspace',{headers:residentHeaders})).json();assert.equal(resident.data.viewer.role,'Resident');assert.equal(resident.data.profile.id,'demo-resident');
const save=async body=>{const {version}=await get();return fetch(base+'/api/workspace',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'save-banners',...body,version})});};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2sAAAAASUVORK5CYII=','base64');
const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'test-banner.png');const upload=await fetch(base+'/api/media',{method:'POST',headers:{cookie},body:form});assert.equal(upload.status,200);const {id}=await upload.json();
try{
 const banners=[{id:'test-banner-1',title:'Test first banner',imageId:id,enabled:true},{id:'test-banner-2',title:'Test hidden banner',imageId:id,enabled:false}];
 assert.equal((await save({banners:[{...banners[0],imageId:'not-uploaded'}]})).status,403);
 assert.equal((await save({banners,view:'resident'})).status,403);
 assert.equal((await save({banners})).status,200);
 assert.deepEqual((await get()).data.settings.brandingBanners,banners);
 assert.deepEqual((await get(true)).data.settings.brandingBanners,[banners[0]]);
 assert.equal((await fetch(base+'/api/media?id='+id)).status,401);
 // Optional caption and https-only call-to-action link: validated server side, trimmed, and forwarded to residents only while enabled.
 const withCta=[{...banners[0],caption:'Meet your candidate',linkUrl:'https://example.org/campaign'},banners[1]];
 for(const linkUrl of ['http://example.org','javascript:alert(1)','https://user:pw@example.org','not a url','https:example.org','https:/example.org','https:///example.org','https://example.org/hello\u00a0world','https://example.org/hello\tworld','https://example.org\\path'])assert.equal((await save({banners:[{...banners[0],linkUrl}]})).status,400,'rejects '+linkUrl);
 assert.equal((await save({banners:[{...banners[0],caption:'x'.repeat(141)}]})).status,400);
 assert.equal((await save({banners:withCta})).status,200);
 assert.deepEqual((await get(true)).data.settings.brandingBanners,[withCta[0]]);
 // A published banner image may be cached briefly by the client and revalidated with its ETag; access is still checked first.
 const media=await fetch(base+'/api/media?id='+id,{headers:{cookie}});assert.equal(media.status,200);
 assert.equal(media.headers.get('cache-control'),'private, max-age=0, must-revalidate');const etag=media.headers.get('etag');assert.ok(etag);
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:{cookie,'If-None-Match':etag}})).status,304);
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:residentHeaders})).status,200);
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:{...residentHeaders,'If-None-Match':etag}})).status,304);
 assert.equal((await save({banners:withCta.map(b=>({...b,enabled:false}))})).status,200);
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:residentHeaders})).status,404,'hidden owner upload must be denied even though uploader and resident both equal demo-resident');
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:{...residentHeaders,'If-None-Match':etag}})).status,404,'authorization precedes conditional cache handling');
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:{cookie}})).status,200,'settings admin retains preview access');
 assert.equal((await save({banners:[]})).status,200);
 assert.equal((await fetch(base+'/api/media?id='+id,{headers:{cookie}})).headers.get('cache-control'),'private, no-store');
 assert.deepEqual((await get(true)).data.settings.brandingBanners,[]);
 assert.equal((await save({restoreDefault:true})).status,200);
 assert.equal((await get()).data.settings.brandingBanners,undefined);
 console.log('PASS: banner upload, durable read-back, publication, resident permission denial, hidden filtering, empty slider and restore default.');
}finally{assert.equal((await save(original.data.settings.brandingBanners?{banners:original.data.settings.brandingBanners}:{restoreDefault:true})).status,200);await fetch(base+'/api/logout',{method:'POST',headers:residentHeaders});}
