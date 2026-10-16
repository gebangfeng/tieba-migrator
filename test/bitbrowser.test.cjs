const {test}=require('node:test');const assert=require('node:assert/strict');const {BitBrowser}=require('../electron/bitbrowser.cjs');const {readLoginState,inspectCookie}=require('../electron/login.cjs');
function setup({status=1,invalidOld=false,alive=false,wrongCookie=false,redirectFailures=0,navigationError=false}={}){
 const events=[],other={name:'session',value:'unrelated',domain:'.example.com',path:'/'},oldBaidu={name:'BDUSS',value:'old',domain:'.baidu.com',path:'/'};const fresh={name:'BDUSS',value:'fresh',domain:'.baidu.com',path:'/',httpOnly:true,secure:true,expires:-1};let runtime=[fresh,other],setBody;
 const oldPage={url:()=> 'https://tieba.baidu.com/p/1',goto:async(url)=>{events.push('blank-old');assert.equal(url,'about:blank');}};
 let navigations=0;const newPage={goto:async()=>{events.push('navigate-check');navigations++;if(navigations<=redirectFailures)throw Error('page.goto: net::ERR_TOO_MANY_REDIRECTS');if(navigationError)throw Error('page.goto: net::ERR_CONNECTION_RESET');},evaluate:async()=>({loginStatus:'logged_in',nickname:'测试',userId:'123'}),waitForTimeout:async()=>{}};
 const context={pages:()=>[oldPage],cookies:async()=>{events.push('read-runtime');return runtime;},newPage:async()=>newPage,clearCookies:async filter=>{events.push('clear-baidu');assert(filter.domain.test('.tieba.baidu.com'));assert(!filter.domain.test('.example.com'));runtime=runtime.filter(c=>!filter.domain.test(c.domain));},addCookies:async cookies=>{events.push('set-runtime');runtime.push(...cookies);},newCDPSession:async()=>({send:async()=>{},detach:async()=>{}})};
 const send=async(_config,path,body)=>{events.push(path);if(path==='/browser/detail')return {id:'w',status,cookie:invalidOld?'bad':JSON.stringify([oldBaidu,other])};if(path==='/browser/open')return {ws:'ws://127.0.0.1:5555/devtools/browser/id'};if(path==='/browser/pids/alive')return alive?{w:42}:{};if(path==='/browser/update/partial'){setBody=body;if(wrongCookie)throw Error('模拟写入失败');return {};}};
 let attachCount=0;const bit=new BitBrowser({address:'http://localhost:54345'},{send,connectCDP:async()=>{attachCount++;return {contexts:()=>[{...context,cookies:async()=>{if(status===1&&attachCount===1){events.push('snapshot-live');return [oldBaidu,other,{name:'live-only',value:'new-session',domain:'.other.com',path:'/'}];}return context.cookies();}}],close:async()=>events.push('disconnect')};}});
 return {bit,events,fresh,get body(){return setBody;}};
}
test('running-window snapshot, close confirmation, profile update and runtime replacement occur in order',async()=>{
 const f=setup();const result=await f.bit.write('w',[f.fresh]);assert.equal(result.status,'logged_in');assert.equal(result.imported,true);const e=f.events;assert(e.indexOf('snapshot-live')<e.indexOf('/browser/close'));assert(e.indexOf('/browser/pids/alive')<e.indexOf('/browser/update/partial'));assert(e.indexOf('blank-old')<e.indexOf('clear-baidu'));assert(e.indexOf('set-runtime')<e.indexOf('navigate-check'));
 const cookies=JSON.parse(f.body.cookie);assert(cookies.some(c=>c.domain==='.example.com'));assert(cookies.some(c=>c.name==='live-only'));assert.equal(cookies.filter(c=>c.name==='BDUSS').length,1);assert.equal(cookies.find(c=>c.name==='BDUSS').value,'fresh');assert.equal(f.body.syncTabs,false);
});
test('closed window is verified before write and malformed old cookie never gets overwritten',async()=>{
 const f=setup({status:0});await f.bit.write('w',[f.fresh]);assert(!f.events.includes('/browser/close'));assert(f.events.indexOf('/browser/pids/alive')<f.events.indexOf('/browser/update/partial'));
 const broken=setup({invalidOld:true});await assert.rejects(broken.bit.write('w',[broken.fresh]),/无法解析/);assert(!broken.events.includes('/browser/update/partial'));
 const alive=setup({status:0,alive:true});await assert.rejects(alive.bit.write('w',[alive.fresh]),/已关闭/);assert(!alive.events.includes('/browser/update/partial'));
});
test('untrusted remote CDP endpoints are rejected',async()=>{const bit=new BitBrowser({address:'http://localhost'},{send:async()=>({ws:'ws://evil.com/devtools/browser/id'}),connectCDP:async()=>{throw Error('must not connect');}});await assert.rejects(bit.attach('w'),/本机/);});
test('CK check interprets explicit mobile identity and never treats a cookie as login evidence',async()=>{
 let identity;const cookies=[{name:'BDUSS',value:'a',domain:'.baidu.com'}];assert.equal(await inspectCookie(cookies,async()=>({ok:true,text:async()=>'{"no":0,"data":{"user_id":"123"}}'}),value=>identity=value),'valid');assert.equal(identity.userId,'123');
 assert.equal(await inspectCookie(cookies,async()=>({ok:true,text:async()=>'{"no":110000,"error":"user not login"}'})),'invalid');
 assert.equal(await inspectCookie(cookies,async()=>({ok:true,text:async()=>'<title>安全验证</title>'})),'verification');
 assert.equal(await inspectCookie(cookies,async()=>({ok:true,text:async()=>'{"no":0,"data":{}}'})),'check_failed');
});
test('explicit login marker works even when nickname is absent',()=>{
 const old={document:global.document,window:global.window};try{global.document={title:'贴吧',body:{innerText:''},querySelectorAll:()=>[],querySelector:()=>null};global.window={PageData:{user:{is_login:1}}};assert.equal(readLoginState().loginStatus,'logged_in');global.window.PageData.user={is_login:0};assert.equal(readLoginState().loginStatus,'login_required');}finally{global.document=old.document;global.window=old.window;}
});

test('import redirect recovery restarts the same window once without rewriting CK',async()=>{
 const f=setup({status:0,redirectFailures:1});const result=await f.bit.write('w',[f.fresh]);assert.equal(result.status,'logged_in');assert.equal(result.imported,true);assert.equal(result.recovered,true);
 assert.equal(f.events.filter(e=>e==='/browser/close').length,1);assert.equal(f.events.filter(e=>e==='/browser/update/partial').length,1);assert.equal(f.events.filter(e=>e==='set-runtime').length,1);assert.equal(f.events.filter(e=>e==='navigate-check').length,2);
 const firstNavigation=f.events.indexOf('navigate-check'),closed=f.events.indexOf('/browser/close');assert(firstNavigation<closed);assert.equal(f.events[firstNavigation-2],'disconnect');assert.equal(f.events[firstNavigation+1],'disconnect');assert(f.events.indexOf('/browser/pids/alive',closed)<f.events.lastIndexOf('navigate-check'));
});
test('repeated redirects stop after one restart while retaining imported status',async()=>{
 const f=setup({status:0,redirectFailures:10});const result=await f.bit.write('w',[f.fresh]);assert.equal(result.status,'check_failed');assert.equal(result.imported,true);assert.match(result.message,/已自动重启同一窗口一次/);assert.equal(f.events.filter(e=>e==='/browser/close').length,1);assert.equal(f.events.filter(e=>e==='navigate-check').length,2);assert.equal(f.events.filter(e=>e==='/browser/update/partial').length,1);
});
test('manual window login check uses the same finite redirect recovery',async()=>{
 const f=setup({status:0,redirectFailures:1});const result=await f.bit.check('w');assert.equal(result.status,'logged_in');assert.equal(result.recovered,true);assert.equal(f.events.filter(e=>e==='/browser/close').length,1);assert(!f.events.includes('/browser/update/partial'));
});
test('ordinary network failures never restart or reimport a window',async()=>{
 const f=setup({status:0,navigationError:true});const result=await f.bit.write('w',[f.fresh]);assert.equal(result.status,'check_failed');assert.equal(result.imported,true);assert(!f.events.includes('/browser/close'));assert.equal(f.events.filter(e=>e==='navigate-check').length,1);
});
