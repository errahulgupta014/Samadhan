// Adds only explicitly labeled fictional sample content to the local preview.
import assert from 'node:assert/strict';
const base='http://localhost:5173';
const signIn=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=signIn.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
assert.ok(cookie,'Start the local server with development sign-in enabled.');
const read=await fetch(base+'/api/workspace',{headers:{cookie}});assert.equal(read.status,200);
const {version}=await read.json();
const response=await fetch(base+'/api/workspace',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'add-demo-content',version})});
const result=await response.json();assert.equal(response.status,200,result.error);
console.log(`Sample content ready: ${result.adsAdded} ads and ${result.placesAdded} places added. Existing content preserved.`);
