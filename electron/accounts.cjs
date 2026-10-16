const crypto = require('node:crypto');
const MAX_BYTES = 1024 * 1024;
const MAX_ACCOUNTS = 500;
const baiduDomain = value => { const d = String(value || '').toLowerCase().replace(/^\./, ''); return d === 'baidu.com' || d.endsWith('.baidu.com'); };
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');
function normalizeCookies(input) {
  if(Buffer.byteLength(typeof input==='string'?input:JSON.stringify(input??null))>80000)throw Error('单个账号 CK 不得超过 80KB');
  if (typeof input === 'string') {
    const raw = input.trim().replace(/^Cookie:\s*/i, '');
    if (/^[\[{]/.test(raw)) { try { input = JSON.parse(raw); } catch { throw Error('Cookie JSON 格式错误'); } }
    else input = raw.split(';').map(part => { const i = part.indexOf('='); return i < 0 ? {} : { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() }; });
  }
  if (input && !Array.isArray(input) && Array.isArray(input.cookies)) input = input.cookies;
  if (!Array.isArray(input) || input.length>300) throw Error('需要 Cookie 字符串或 cookies 数组');
  const identities = new Map(), result = new Map(); let cleaned = 0;
  for (const c of input) {
    if (!c || typeof c !== 'object' || typeof c.name !== 'string' || typeof c.value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name.trim()) || !c.value.trim() || /[\r\n\x00]/.test(c.value) || /^(BrowserId|LocalPort|disableAutoplay)$/i.test(c.name.trim()) || /^(undefined|null)$/i.test(c.name.trim()) || /^(undefined|null)$/i.test(c.value.trim())) { cleaned++; continue; }
    const name = c.name.trim(), value = c.value.trim(), domain = String(c.domain || '.baidu.com').toLowerCase();
    if (!baiduDomain(domain)) throw Error('仅支持百度域名 Cookie');
    if(c.path && (typeof c.path!=='string'||!c.path.startsWith('/')||/[\r\n\x00]/.test(c.path)))throw Error('Cookie 路径无效');
    if (['BDUSS', 'BDUSS_BFESS', 'STOKEN', 'PTOKEN'].includes(name)) {
      if (identities.has(name) && identities.get(name) !== value) throw Error(`混有多个不同登录身份：${name} 存在不同值`);
      identities.set(name, value);
    }
    const item = {name, value, domain, path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/', secure: c.secure !== false, httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : ['BDUSS','BDUSS_BFESS','STOKEN','PTOKEN'].includes(name), session: c.session !== false};
    const expires = c.expires ?? c.expirationDate;
    if(c.session!==true&&expires!=null&&![0,-1].includes(Number(expires))){
      if(!Number.isFinite(Number(expires))||Number(expires)<=Date.now()/1000)throw Error('Cookie 已过期或过期时间无效，请重新导出');
      item.expires=Number(expires);item.session=false;
    }else{item.expires=-1;item.session=true;}
    const sameSite={strict:'Strict',lax:'Lax',none:'None',no_restriction:'None'}[String(c.sameSite||'').toLowerCase()];if(sameSite)item.sameSite=sameSite;
    result.set(`${name}\0${domain}\0${item.path}`, item);
  }
  if (!identities.get('BDUSS')&&!identities.get('BDUSS_BFESS')) throw Error('缺少有效 BDUSS / BDUSS_BFESS');
  return { cookies: [...result.values()], key: fingerprint(identities.get('BDUSS')||identities.get('BDUSS_BFESS')), identities:[...new Set(['BDUSS','BDUSS_BFESS'].map(name=>identities.get(name)).filter(Boolean).map(fingerprint))], cleaned };
}
function parseImport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw Error('每次导入最大 1MB');
  text = text.replace(/^\uFEFF/, '').trim();
  if (!text) throw Error('请输入 CK 或选择文件');
  let entries;
  if (/^[\[{]/.test(text)) {
    let data; try { data = JSON.parse(text); } catch { throw Error('JSON 格式错误'); }
    if (Array.isArray(data) && data.every(x => x && typeof x === 'object' && 'name' in x && 'value' in x)) entries = [{value:data,line:1}];
    else if (Array.isArray(data)) entries = data.map((value,i)=>({value,line:i+1}));
    else if (Array.isArray(data?.accounts)) entries = data.accounts.map((value,i)=>({value,line:i+1}));
    else entries = [{value:data,line:1}];
  } else entries = text.split(/\r?\n/).map((value,i)=>({value,line:i+1})).filter(x=>x.value.trim());
  if (entries.length > MAX_ACCOUNTS) throw Error('每次最多导入 500 个账号');
  return entries.map(({value,line})=>{
    try {
      let note = '', ck = value;
      if (typeof value === 'string' && /^[^;=\r\n]+----/.test(value)) { const match=/^([^;\r\n=]+?)----([^;\r\n]*?)----([\s\S]+)$/.exec(value);if(match){note=match[1].trim();ck=match[3];}else{const at=value.indexOf('----');note=value.slice(0,at).trim();ck=value.slice(at+4);} }
      else if (value && !Array.isArray(value) && typeof value === 'object') { note = typeof value.note === 'string' ? value.note.trim() : ''; ck = value.cookie ?? value.cookies; }
      const parsed = normalizeCookies(ck);
      return {...parsed,line,autoNote:!note,note:note.slice(0,100) || `贴吧账号${String(line).padStart(3,'0')}`};
    } catch (e) { return {line,error:e.message}; }
  });
}
function encrypt(value,key) { const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv); const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]); return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}; }
function decrypt(value,key) { const cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64')); cipher.setAuthTag(Buffer.from(value.tag,'base64')); return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8')); }
function publicAccount(a) { const {secret,key,identities,...safe}=a; return safe; }
class Locks {
  constructor(){this.keys=new Set();}
  async run(keys,fn){if(keys.some(k=>this.keys.has(k)))throw Error('该账号或窗口正在操作，请稍候');keys.forEach(k=>this.keys.add(k));try{return await fn();}finally{keys.forEach(k=>this.keys.delete(k));}}
}
module.exports={MAX_BYTES,MAX_ACCOUNTS,baiduDomain,normalizeCookies,parseImport,encrypt,decrypt,publicAccount,Locks};
