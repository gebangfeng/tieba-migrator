const {test}=require('node:test');const assert=require('node:assert/strict');const {endpoint,request,payload}=require('../electron/core.cjs');
test('only permits loopback root and refuses credentials and redirects',()=>{assert.equal(endpoint('http://127.0.0.1:54345'),'http://127.0.0.1:54345');for(const u of ['https://example.com','http://localhost.evil.com','http://x@localhost','http://localhost/a'])assert.throws(()=>endpoint(u));});
test('API token is sent in header; create cookie is JSON string',async()=>{let opts;const r={name:'账号',cookies:[{name:'BDUSS',value:'abc'}]};const d=await request({address:'http://localhost:1',token:'secret'},'/browser/update',payload(r,''),async(u,o)=>{opts=o;return {ok:true,json:async()=>({success:true,data:{id:'id1'}})};});assert.equal(d.id,'id1');assert.equal(opts.headers['x-api-key'],'secret');assert.equal(opts.redirect,'error');assert.equal(typeof JSON.parse(opts.body).cookie,'string');});
test('API rejection is safely retryable; transport failure is uncertain',async()=>{await assert.rejects(request({address:'http://localhost'},'/browser/update',{},async()=>({ok:true,json:async()=>({success:false,msg:'BDUSS=SECRET'})})),e=>e.definite&&!e.message.includes('SECRET'));await assert.rejects(request({address:'http://localhost'},'/browser/update',{},async()=>{throw Error('SECRET')}),e=>!e.definite&&!e.message.includes('SECRET'));});

test('malformed JSON values never expose an internal exception',async()=>{for(const data of [null,[],42,'unexpected'])await assert.rejects(request({address:'http://localhost'},'/browser/update',{},async()=>({ok:true,json:async()=>data})),e=>!e.definite&&e.message==='接口返回的数据格式不兼容');});

test('business errors show the reason while masking submitted credentials',async()=>{
 const row={name:'账号',cookies:[{name:'BDUSS',value:'private-cookie'},{name:'STOKEN',value:'private-stoken'}]};
 await assert.rejects(request({address:'http://localhost',token:'private-token'},'/browser/update',payload(row,''),async()=>({ok:true,json:async()=>({success:false,msg:'分组不存在 private-cookie private-stoken private-token'})})),e=>e.definite&&e.message.includes('分组不存在')&&!/private-/.test(e.message));
});
test('missing success status is uncertain rather than retryable',async()=>{
 await assert.rejects(request({address:'http://localhost'},'/browser/update',{},async()=>({ok:true,json:async()=>({msg:'unexpected'})})),e=>!e.definite&&e.message.includes('success'));
});
