import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL||'http://localhost:5173';
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const get=async()=>{const r=await fetch(base+'/api/workspace',{headers:{cookie}});assert.equal(r.status,200);return r.json();};
const original=await get();const previous=original.data.settings.splashImageId??'';
const save=async id=>{const {version}=await get();return fetch(base+'/api/workspace',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'save-branding',splashImageId:id,version})});};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2sAAAAASUVORK5CYII=','base64');
const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'test-branding.png');const upload=await fetch(base+'/api/media',{method:'POST',headers:{cookie},body:form});assert.equal(upload.status,200);const {id}=await upload.json();
try{
 assert.equal((await save('not-an-uploaded-image')).status,403);
 assert.equal((await save(id)).status,200);
 const branding=await (await fetch(base+'/api/branding')).json();assert.equal(branding.imageUrl,`/api/branding/image?v=${id}`);
 const image=await fetch(base+branding.imageUrl);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 assert.equal((await fetch(base+'/api/media?id='+id)).status,401);
 assert.equal((await fetch(base+'/api/branding/image?v=unrelated-private-photo')).status,404);
 assert.equal((await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save-branding',splashImageId:id})})).status,401);
 assert.equal((await save('')).status,200);assert.equal((await (await fetch(base+'/api/branding')).json()).imageUrl,null);assert.equal((await fetch(base+branding.imageUrl)).status,404);
 console.log('PASS: splash image upload/publish/read-back, pre-login access limited to selected branding, invalid media denied, restore-default and former-image revocation.');
}finally{assert.equal((await save(previous)).status,200);}
