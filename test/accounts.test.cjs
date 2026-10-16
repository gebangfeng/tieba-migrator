const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {normalizeCookies,parseImport,encrypt,decrypt,Locks}=require('../electron/accounts.cjs');
const {Store}=require('../electron/store.cjs');
const {AccountService}=require('../electron/service.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tieba-vault-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const security={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};const store=new Store(dir,security);store.init();return {store,dir,security};}
test('imports all supported forms, preserves separators in cookie values and discards middle fields',()=>{
 const formats=['BDUSS=a==; STOKEN=b;','[{"name":"BDUSS","value":"a=="}]','{"cookies":[{"name":"BDUSS","value":"a=="}]}','备注----不保存----BDUSS=a==; X=has----separators','备注----BDUSS=a==;'];
 for(const text of formats){const [row]=parseImport(text);assert.equal(row.error,undefined,text);assert.equal(row.cookies[0].value,'a==');}
 const [row]=parseImport(formats[3]);assert.equal(row.note,'备注');assert.equal(row.cookies.find(c=>c.name==='X').value,'has----separators');assert(!JSON.stringify(row).includes('不保存'));
 assert.equal(parseImport('BDUSS=a----b')[0].cookies[0].value,'a----b');
 for(const text of ['[{"note":"甲","cookie":"BDUSS=a"}]','{"accounts":[{"note":"甲","cookie":[{"name":"BDUSS","value":"a"}]}]}'])assert.equal(parseImport(text)[0].note,'甲');
});
test('cleans empty names, undefined/null metadata and preserves encoding',()=>{
 const p=normalizeCookies('Cookie: =undefined; undefined; null; null=x; X=null; Y=undefined; BrowserId=1; BDUSS=a%2Bb==');
 assert.equal(p.cookies.length,1);assert.equal(p.cookies[0].value,'a%2Bb==');assert.equal(p.cleaned,7);
});
test('rejects conflicting login identities, foreign domains and expired cookies',()=>{
 for(const name of ['BDUSS','BDUSS_BFESS','STOKEN','PTOKEN'])assert.throws(()=>normalizeCookies(`BDUSS=base;${name}=a;${name}=b`),/不同登录身份/);
 assert.throws(()=>normalizeCookies([{name:'BDUSS',value:'a',domain:'evilbaidu.com'}]),/百度域名/);
 assert.throws(()=>normalizeCookies([{name:'BDUSS',value:'a',expires:1,session:false}]),/过期/);
 assert.equal(normalizeCookies('BDUSS_BFESS=bfess').identities.length,1);
});
test('line numbers include blank lines, failures are isolated, import limits enforced',()=>{
 const rows=parseImport('BDUSS=a\n\ninvalid\nBDUSS=b');assert.deepEqual(rows.map(r=>r.line),[1,3,4]);assert(rows[1].error);assert(!rows[2].error);
 assert.throws(()=>parseImport(Array(502).fill('BDUSS=a').join('\n')),/500/);
 assert.throws(()=>parseImport('a'.repeat(1024*1024+1)),/1MB/);
});
test('AES GCM roundtrip and tamper rejection',()=>{const key=crypto.randomBytes(32),sealed=encrypt([{name:'BDUSS',value:'SECRET'}],key);assert(!JSON.stringify(sealed).includes('SECRET'));assert.equal(decrypt(sealed,key)[0].value,'SECRET');const broken={...sealed,tag:crypto.randomBytes(16).toString('base64')};assert.throws(()=>decrypt(broken,key));});
test('store skips overlapping identities, excludes CK from public lists, persists encrypted and reloads',t=>{
 const {store,dir,security}=fixture(t);const results=store.import('BDUSS=secret-one;BDUSS_BFESS=secret-two\nBDUSS_BFESS=secret-two\nX=no\nBDUSS=secret-three');assert.deepEqual(results.map(r=>r.status),['success','duplicate','failed','success']);
 const disk=fs.readFileSync(path.join(dir,'accounts.json'),'utf8');for(const secret of ['secret-one','secret-two','secret-three']){assert(!disk.includes(secret));assert(!JSON.stringify(store.list()).includes(secret));}
 assert(!('secret' in store.list()[0]));assert(!('identities' in store.list()[0]));const again=new Store(dir,security);again.init();assert.equal(again.accounts.length,2);assert.equal(again.cookies(again.accounts[0])[0].value,'secret-one');
});
test('failed disk write rolls back metadata and updates reset all validation evidence',t=>{
 const {store}=fixture(t);store.import('BDUSS=a');const a=store.accounts[0];a.ckAccountId='123';a.cookieCheckedAt='old';a.loginStatus='logged_in';store.update(a.id,'BDUSS=b');assert.equal(a.ckStatus,'saved');assert.equal(a.ckAccountId,'');assert.equal(a.loginStatus,'unknown');
 const save=store.save;store.save=()=>{throw Error('disk full');};assert.throws(()=>store.transaction(()=>{store.accounts[0].note='changed';}));assert.notEqual(store.accounts[0].note,'changed');store.save=save;
});
test('missing encryption key never overwrites existing vault',t=>{const {store,dir,security}=fixture(t);store.import('BDUSS=a');fs.unlinkSync(path.join(dir,'vault.key'));assert.throws(()=>new Store(dir,security).init(),/密钥丢失/);});
test('locks reject overlapping operations and release after failures',async()=>{const locks=new Locks();let release;const first=locks.run(['account:a','window:w'],()=>new Promise(r=>release=r));await assert.rejects(locks.run(['window:w'],async()=>{}),/正在操作/);release();await first;await assert.rejects(locks.run(['window:w'],async()=>{throw Error('bad');}));await locks.run(['window:w'],async()=>{});});
test('saving and binding never writes cookies; a failed import reuses the created window',async t=>{
 const {store}=fixture(t);let creates=0,writes=0;const bit={create:async()=>{creates++;return {id:'w1'};},write:async()=>{writes++;throw Error('模拟写入失败');},call:async()=>({id:'w1',name:'窗口'}),list:async()=>[]};const service=new AccountService(store,{bitFactory:()=>bit});service.connected=true;
 service.import('BDUSS=secret');const id=store.accounts[0].id;assert.equal(creates,0);assert.equal(writes,0);await service.action(id,'create');assert.equal(writes,0);assert.equal(store.get(id).windowId,'w1');
 for(let i=0;i<2;i++)await assert.rejects(service.action(id,'write',{confirmReplace:true}),/写入失败/);assert.equal(creates,1);assert.equal(writes,2);assert.equal(store.get(id).windowId,'w1');
});
test('uncertain create prevents duplicate creation, explicit rejection permits retry',async t=>{
 const {store}=fixture(t);store.import('BDUSS=a');const id=store.accounts[0].id;const service=new AccountService(store,{bitFactory:()=>({create:async()=>{throw Error('连接超时');}})});service.connected=true;await assert.rejects(service.action(id,'create'),/超时/);assert.equal(store.get(id).createUncertain,true);await assert.rejects(service.action(id,'create'),/结果待核对/);
 store.get(id).createUncertain=false;service.bitFactory=()=>({create:async()=>{throw Object.assign(Error('额度不足'),{definite:true});}});await assert.rejects(service.action(id,'create'),/额度不足/);assert.equal(store.get(id).createUncertain,false);
 store.get(id).createUncertain=true;service.bitFactory=()=>({create:async()=>({id:'confirmed-window'})});await service.action(id,'create',{confirmNoWindow:true});assert.equal(store.get(id).windowId,'confirmed-window');
});
test('single-window ownership, operation exclusion and removal preserving window',async t=>{
 const {store}=fixture(t);store.import('BDUSS=a\nBDUSS=b');const [a,b]=store.accounts;let calls=0,release;const bit={call:async()=>{calls++;return {id:'w',name:'window'};},check:async()=>new Promise(r=>release=r)};const service=new AccountService(store,{bitFactory:()=>bit});service.connected=true;await service.action(a.id,'bind',{windowId:'w'});await assert.rejects(service.action(b.id,'bind',{windowId:'w'}),/已绑定/);
 const checking=service.action(a.id,'check');await assert.rejects(service.action(a.id,'update',{text:'BDUSS=c'}),/正在操作/);release({status:'logged_in',accountId:'123'});await checking;assert.equal(a.loginStatus,'logged_in');const before=calls;await service.action(a.id,'remove',{confirm:true});assert.equal(calls,before);assert.equal(store.accounts.length,1);
});
test('CK valid, window login and saved status are independent; secrets never appear in errors',async t=>{
 const {store}=fixture(t);store.import('BDUSS=private-secret');const a=store.accounts[0];const service=new AccountService(store,{cookieCheck:async(_c,_r,onIdentity)=>{onIdentity({userId:'123'});return 'valid';}});await service.action(a.id,'checkCookie');assert.equal(a.ckStatus,'valid');assert.equal(a.loginStatus,'unknown');assert.equal(service.state().accounts[0].ckStatus,'valid');assert(!service.cleanError(Error('private-secret')).includes('private-secret'));
 service.applyLogin(a,{status:'logged_in',accountId:'456'});assert.equal(a.loginStatus,'check_failed');assert.match(a.error,/不一致/);
});

test('automatic notes continue across imports and reloads, explicit notes are preserved',t=>{
 const {store,dir,security}=fixture(t);store.import('BDUSS=a');store.import('BDUSS=b');store.import('BDUSS=b\nBDUSS=c');assert.deepEqual(store.list().map(a=>a.note),['贴吧账号001','贴吧账号002','贴吧账号003']);
 const again=new Store(dir,security);again.init();again.import('BDUSS=d');again.import('[{"note":"我的备注","cookie":"BDUSS=e"}]');assert.equal(again.list()[3].note,'贴吧账号004');assert.equal(again.list()[4].note,'我的备注');
});
