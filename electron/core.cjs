function endpoint(value) {
  const u=new URL(value);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw Error('仅支持本机 HTTP 地址，如 http://127.0.0.1:54345');
  return u.origin;
}
function apiMessage(value,config,body) {
  if(typeof value!=='string')return '';
  let message=value;
  const secrets=[config.token];
  if(typeof body?.cookie==='string'){
    secrets.push(body.cookie);
    try{for(const item of JSON.parse(body.cookie))if(item.value)secrets.push(item.value);}catch{}
  }
  for(const secret of secrets.filter(x=>typeof x==='string'&&x.length).sort((a,b)=>b.length-a.length))message=message.split(secret).join('[已隐藏]');
  return message.replace(/(BDUSS(?:_BFESS)?|STOKEN|PTOKEN|cookie|token|x-api-key)\s*[:=]\s*[^\s；，]+/gi,'$1=[已隐藏]').replace(/[\r\n\t]/g,' ').slice(0,300);
}
async function request(config,path,body,fetcher=fetch) {
  const base=endpoint(config.address);
  let response;
  try {response=await fetcher(base+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(config.token?{'x-api-key':config.token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});} catch {throw Error('连接中断或超时；操作可能已完成，请先核对比特窗口状态，避免重复创建');}
  if(!response.ok) throw Error(`HTTP ${response.status}；请检查 API 地址及 Local API Token`);
  let result;try{result=await response.json();}catch{throw Error('接口没有返回有效 JSON');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('接口返回的数据格式不兼容');
  if(result.success===false) {const detail=apiMessage(result.msg,config,body);const e=Error(detail?`比特接口拒绝操作：${detail}`:'比特接口拒绝操作；请检查 Token、账号权限、分组及窗口额度'); e.definite=true;throw e;}
  if(result.success!==true)throw Error('接口缺少有效的 success 状态；若正在创建，请到比特浏览器核对窗口');
  return result.data;
}
function payload(row,groupId) {
  return {name:row.name,groupId:groupId||'',platform:'https://tieba.baidu.com',platformIcon:'tieba.baidu.com',url:'https://tieba.baidu.com/',remark:'由贴吧账号迁移助手导入',userName:'',password:'',cookie:JSON.stringify(row.cookies),proxyMethod:2,proxyType:'noproxy',browserFingerPrint:{},clearCookiesBeforeLaunch:false};
}
module.exports={endpoint,request,payload};
