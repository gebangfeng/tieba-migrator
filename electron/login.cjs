// Read-only detection adapted from 百度贴吧发贴/tieba-accounts.js.
function readLoginState() {
  const visible = element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  const title = document.title || ''
  const text = document.body ? document.body.innerText : ''
  const challenge = Array.from(document.querySelectorAll('iframe, [class*="captcha"], [id*="captcha"], [class*="verify-dialog"]')).some(element => visible(element) && /captcha|verify|验证/i.test(`${element.id} ${element.className} ${element.getAttribute('src') || ''}`))
  if (/安全验证|访问验证|身份验证/.test(title) || challenge || /拖动.{0,15}(滑块|验证)|请完成.{0,10}验证|请拖动滑块/.test(text)) return { loginStatus: 'verification', nickname: '', userId: '' }
  // The new Tieba client uses a Vue/Pinia user store rather than PageData.
  // Read only explicit login and identity fields, never its session token.
  const accountBar = document.querySelector('.user-or-login')
  try {
    const component = accountBar && (accountBar.__vue__ || (accountBar.__vueParentComponent && accountBar.__vueParentComponent.proxy))
    const state = component && component.$pinia && component.$pinia.state && component.$pinia.state.value
    const store = state && state.userStore
    if (store && (store.isLogin === true || store.isLogin === 1)) {
      const identity = store.user || {}
      const nickname = String(identity.name || identity.user_name || identity.name_show || '').trim()
      const userId = String(identity.user_id || '')
      return { loginStatus: 'logged_in', nickname, userId }
    }
  } catch (_) {}
  if (accountBar && visible(accountBar) && /^(登录|登陆)$/.test(accountBar.textContent.trim())) return { loginStatus: 'login_required', nickname: '', userId: '' }
  const user = window.PageData && window.PageData.user
  if (user && (user.is_login === true || Number(user.is_login) === 1)) {
    const nickname = String(user.user_name_show || user.name_show || user.user_name || user.name || '').trim()
    return { loginStatus: 'logged_in', nickname, userId: String(user.user_id || user.user_id_str || '') }
  }
  const profile = Array.from(document.querySelectorAll('#com_userbar .u_username, #com_userbar .user_name, .u_username')).find(visible)
  if (profile && profile.textContent.trim()) return { loginStatus: 'logged_in', nickname: profile.textContent.trim(), userId: '' }
  const login = Array.from(document.querySelectorAll('#com_userbar a, .u_login, a[href*="passport.baidu.com"]')).find(element => visible(element) && /^(登录|登陆)$/.test(element.textContent.trim()))
  if (login || /^(登录|登陆)/.test(title) || (user && (user.is_login === false || user.is_login === 0 || user.is_login === '0'))) return { loginStatus: 'login_required', nickname: '', userId: '' }
  return { loginStatus: 'check_failed', nickname: '', userId: '' }
}

async function inspectCookie(cookies, request = fetch, onIdentity = () => {}) {
  const cookie = cookies.filter(item => ['baidu.com', 'tieba.baidu.com'].includes(String(item.domain || '').replace(/^\./, '').toLowerCase()) && (!item.expires || item.expires < 0 || item.expires > Date.now() / 1000)).map(item => `${item.name}=${item.value}`).join('; ')
  try {
    const response = await request('https://tieba.baidu.com/mo/q/sync', {
      headers: { Cookie: cookie, Referer: 'https://tieba.baidu.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000), redirect: 'error'
    })
    if (!response.ok) return 'check_failed'
    const body = await response.text()
    if (/安全验证|访问验证|请完成.{0,10}验证|请拖动滑块/.test(body)) return 'verification'
    const data = JSON.parse(body)
    if (Number(data.no) === 110000 && data.error === 'user not login') return 'invalid'
    // The mobile sync endpoint returns the current user ID directly in data.
    const currentUserId = data.data && data.data.user_id
    if (Number(data.no) === 0 && /^(?!0+$)[0-9]+$/.test(String(currentUserId || ''))) { onIdentity({ userId: String(currentUserId) }); return 'valid' }
    const user = data.data && data.data.user
    if (Number(data.no) === 0 && user && ![false, 0, '0'].includes(user.is_login) && (String(user.user_id || user.id || '0') !== '0' || user.name || user.user_name)) { onIdentity({ ...(user.user_id || user.id ? { userId: String(user.user_id || user.id) } : {}) }); return 'valid' }
    return 'check_failed'
  } catch (_) { return 'check_failed' }
}


const labels={logged_in:'已登录',login_required:'未登录或已失效',verification:'需要人工验证，请在页面完成后重新检查',check_failed:'未识别到明确登录标记，请人工核对'};
async function inspectPage(page){
 let result;
 for(let i=0;i<5;i++){
  result=await page.evaluate(readLoginState);
  if(['logged_in','verification'].includes(result.loginStatus)||i===4)break;
  await page.waitForTimeout(500);
 }
 if(result.loginStatus==='verification')await page.bringToFront();
 return {status:result.loginStatus,nickname:result.nickname||'',accountId:result.userId||'',message:labels[result.loginStatus]};
}
module.exports={readLoginState,inspectCookie,inspectPage};
