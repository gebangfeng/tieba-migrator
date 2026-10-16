const {request,endpoint,payload}=require('./core.cjs');
const {baiduDomain}=require('./accounts.cjs');
const {inspectPage}=require('./login.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class BitBrowser {
  constructor(config,{send=request,connectCDP}={}){this.config=config;this.send=send;this.connectCDP=connectCDP||((url)=>require('playwright-core').chromium.connectOverCDP(url,{timeout:15000,noDefaults:true}));}
  call(path,body={}){return this.send(this.config,path,body);}
  async list(path='/browser/list'){
    const result=[];
    for(let page=0;page<1000;page++){
      const data=await this.call(path,{page,pageSize:100});const list=Array.isArray(data)?data:data?.list;
      if(!Array.isArray(list))throw Error('列表返回格式不兼容');
      result.push(...list);if(list.length<100||Number.isFinite(data?.total)&&result.length>=data.total)return result;
    }
    throw Error('窗口列表过大，请减少窗口数量后重试');
  }
  async create(note,groupId){const body=payload({name:note,cookies:[]},groupId);body.url='about:blank';body.syncTabs=false;body.syncCookies=true;body.workbench='disable';return this.call('/browser/update',body);}
  async close(id){
    await this.call('/browser/close',{id});
    for(let attempt=0;attempt<20;attempt++){
      const pids=await this.call('/browser/pids/alive',{ids:[id]});
      if(!pids||typeof pids!=='object'||Array.isArray(pids))throw Error('无法确认窗口是否关闭，已取消写入');
      if(!pids[id])return;
      await pause(500);
    }
    throw Error('窗口仍在运行，已取消写入，请手动关闭后重试');
  }
  async attach(id){
    const data=await this.call('/browser/open',{id});
    const ws=data?.ws;
    if(typeof ws!=='string')throw Error('窗口已打开，但缺少调试连接地址');
    const url=new URL(ws);endpoint(`http://${url.host}`);if(url.protocol!=='ws:')throw Error('仅允许本机窗口调试连接');
    return this.connectCDP(ws);
  }
  async open(id){return this.withRedirectRecovery(id,()=>this.openOnce(id));}
  async openOnce(id){
    const browser=await this.attach(id);
    try{
      const context=browser.contexts()[0];if(!context)throw Error('窗口已打开，但上下文不可用');
      const existing=context.pages().find(page=>{try{return baiduDomain(new URL(page.url()).hostname);}catch{return false;}});
      if(existing){await existing.bringToFront();return;}
      const page=await context.newPage();await page.goto('https://tieba.baidu.com/',{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();
    }finally{await browser.close();}
  }
  async withRedirectRecovery(id,work){
    try{return await work();}
    catch(error){
      if(!/ERR_TOO_MANY_REDIRECTS/i.test(String(error?.message)))throw error;
      // Same recovery as the reference account module: restart the same window
      // once. Do not rewrite cookies or create another browser window.
      await this.close(id);
      try{const result=await work();return result?{...result,recovered:true}:result;}
      catch(retryError){
        if(!/ERR_TOO_MANY_REDIRECTS/i.test(String(retryError?.message)))throw retryError;
        throw Object.assign(Error('贴吧连续重定向；已自动重启同一窗口一次仍未恢复，请更新 CK 后重新导入'),{code:'TIEBA_REDIRECT_LOOP'});
      }
    }
  }
  async check(id){return this.withRedirectRecovery(id,()=>this.checkOnce(id));}
  async checkOnce(id){
    const browser=await this.attach(id);
    try{const context=browser.contexts()[0];if(!context)throw Error('窗口上下文不可用');const page=await context.newPage();await page.goto('https://tieba.baidu.com/',{waitUntil:'domcontentloaded',timeout:30000});return await inspectPage(page);}
    finally{await browser.close();} // For a CDP attachment, disconnect; leave the actual browser open.
  }
  async write(id,cookies){
    let detail=await this.call('/browser/detail',{id});
    if(!detail||detail.id!==id)throw Error('无法读取窗口详情，未修改 Cookie');
    let old=detail.cookie;
    if(typeof old==='string'){try{old=old.trim()?JSON.parse(old):[];}catch{throw Error('已有窗口 Cookie 无法解析，已取消写入以保留其他网站数据');}}
    if(old==null)throw Error('窗口详情缺少 Cookie，无法安全保留其他网站数据');
    if(!Array.isArray(old)||old.some(c=>!c||typeof c.domain!=='string'))throw Error('已有窗口 Cookie 格式异常，已取消写入');
    if(![0,1].includes(Number(detail.status)))throw Error('无法确认窗口状态，已取消写入');
    if(Number(detail.status)===1){const running=await this.attach(id);try{const context=running.contexts()[0];if(!context)throw Error('无法读取运行窗口');old=await context.cookies();}finally{await running.close();}await this.close(id);}
    else {const alive=await this.call('/browser/pids/alive',{ids:[id]});if(!alive||typeof alive!=='object'||Array.isArray(alive)||alive[id])throw Error('无法确认窗口已关闭，已取消写入');}
    const merged=[...old.filter(c=>!baiduDomain(c.domain)),...cookies];
    await this.call('/browser/update/partial',{ids:[id],browserFingerPrint:{},cookie:JSON.stringify(merged),clearCookiesBeforeLaunch:false,syncCookies:true,syncTabs:false,url:'about:blank'});
    const browser=await this.attach(id);
    try{
      const context=browser.contexts()[0];if(!context)throw Error('窗口上下文不可用');
      // Close old Baidu pages before opening the target page; other websites remain untouched.
      for(const page of context.pages()){let isBaidu=false;try{isBaidu=baiduDomain(new URL(page.url()).hostname);}catch{}if(isBaidu)await page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:10000});}
      const expected=cookies.filter(c=>['BDUSS','BDUSS_BFESS'].includes(c.name));
      let loaded=false;
      for(let attempt=0;attempt<40;attempt++){
        const actual=await context.cookies();
        loaded=expected.every(c=>actual.some(a=>a.name===c.name&&a.value===c.value&&a.domain.replace(/^\./,'')===c.domain.replace(/^\./,'')&&a.path===c.path));
        if(loaded)break;
        await pause(250);
      }
      if(!loaded)throw Error('窗口未正确载入新 CK，请重新导入；绑定已保留');
      // Remove only Baidu runtime cookies; unrelated sites keep their sessions.
      await context.clearCookies({domain:/^\.?([a-z0-9-]+\.)*baidu\.com$/i});
      await context.addCookies(cookies.map(({session,...c})=>c));
      const after=await context.cookies();if(!expected.every(c=>after.some(a=>a.name===c.name&&a.value===c.value&&a.domain.replace(/^\./,'')===c.domain.replace(/^\./,'')&&a.path===c.path)))throw Error('运行时 CK 校验失败，请重新导入');
      const page=await context.newPage();
      const cdp=await context.newCDPSession(page);
      try{await cdp.send('Storage.clearDataForOrigin',{origin:'https://tieba.baidu.com',storageTypes:'local_storage,indexeddb,service_workers,cache_storage'});}finally{await cdp.detach();}
    }finally{await browser.close();}
    // Finish cookie import before checking. Restart recovery must only reopen
    // this window; reimporting here would bring the same old session back.
    try{return {...await this.check(id),imported:true};}
    catch(error){return {status:'check_failed',message:error.code==='TIEBA_REDIRECT_LOOP'?error.message:'CK 已导入，登录检查失败，请检查窗口及网络后重新检查',imported:true};}
  }
}
module.exports={BitBrowser};
