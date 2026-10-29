// 关注同步：让 B 号（小号）的关注列表追上 A 号（主号）。
//
// v2 改造（2026-10-21）：
//   加 --daily N 每日限额 + 进度持久化 + 遇频率限制暂停 30s + 连续 3 次自动停。
//   用法: node follow-sync.mjs --dry --daily 20
//        node follow-sync.mjs --go  --daily 20
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.on('uncaughtException', e => console.error('💥 EX:', e?.message))
process.on('unhandledRejection', e => console.error('💥 UR:', e?.message || e))

const DATA_DIR = path.join(os.homedir(), '.doubao-bot')
const mainCfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'))

let SELF_MID = String(mainCfg.bili?.selfMid || '')
let botSess = '', botJj = '', botBuvid3 = ''
try {
  const accs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'accounts.json'), 'utf8'))
  const bot = (accs.accounts || []).find(a => a.role === 'bot') || (accs.accounts || []).find(a => String(a.mid) === SELF_MID)
  if (bot) {
    botSess = decodeURIComponent(bot.sessdata || '')
    botJj = bot.bili_jct || bot.biliJct || ''
    botBuvid3 = bot.buvid3 || ''
    if (bot.mid) SELF_MID = String(bot.mid)
  }
} catch {}
if (!botSess) {
  const cred = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'credentials.json'), 'utf8'))
  botSess = decodeURIComponent(cred.sessdata || '')
  botJj = cred.bili_jct || cred.biliJct || ''
  botBuvid3 = cred.buvid3 || ''
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const ck = 'SESSDATA=' + botSess + '; bili_jct=' + botJj + '; buvid3=' + botBuvid3
const HC = { 'user-agent': UA, referer: 'https://space.bilibili.com/', cookie: ck }
const HP = { ...HC, 'content-type': 'application/x-www-form-urlencoded' }

const OWNER_MID = String(mainCfg.bili?.ownerMid || '')
const DRY = process.argv.includes('--dry')
const GO = process.argv.includes('--go')

// ── 参数解析（含 --daily） ──
const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i] ?? true)
}
const DAILY = Math.max(0, Number(args.get('daily') || 0))  // 0 = 不限

const FOLLOW_FILE = path.resolve(process.cwd(), 'owner-followings.json')
if (!fs.existsSync(FOLLOW_FILE)) { console.error('没找到 owner-followings.json'); process.exit(1) }
if (!DRY && !GO) { console.error('用 --dry 先验，或 --go 真关注'); process.exit(2) }

// ── 进度持久化 ──
const STATE_FILE = path.join(DATA_DIR, 'follow-sync-state.json')
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} } }
function writeState(o) { fs.writeFileSync(STATE_FILE, JSON.stringify(o, null, 2) + '\n') }
function todayStr() { return new Date().toLocaleDateString('sv-SE') }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchWithTimeout(url, opts = {}, timeout = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    clearTimeout(t)
    return res
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

async function main() {
  console.log('=== 登录态 ===')
  const navR = await fetchWithTimeout('https://api.bilibili.com/x/web-interface/nav', { headers: HC })
  const navJ = await navR.json()
  console.log('  B号:', navJ.data?.uname, '(mid', navJ.data?.mid, ') 硬币:', navJ.data?.money)

  // ── Step 1: 读主号关注 ──
  console.log('\n=== Step 1: 读A的完整关注列表 ===')
  const raw = JSON.parse(fs.readFileSync(FOLLOW_FILE, 'utf8'))
  const all = raw.filter(u => String(u.mid) !== SELF_MID)
  console.log('  owner-followings.json:', raw.length, '个, 过滤掉自己后:', all.length, '个')

  // ── Step 2: 拉小号已有关注（扫所有页直到空） ──
  console.log('\n=== Step 2: 拉B号已有关注 ===')
  const mineSet = new Set()
  for (let p = 1; p <= 20; p++) {
    const rMine = await fetchWithTimeout(`https://api.bilibili.com/x/relation/followings?vmid=${SELF_MID}&pn=${p}&ps=50&order=desc`, { headers: HC })
    const mineJ = await rMine.json()
    const list = mineJ.data?.list || []
    if (!list.length) break
    list.forEach(u => mineSet.add(String(u.mid)))
    if (list.length < 50) break
    await sleep(300)
  }
  console.log('  B号已关注:', mineSet.size, '个')

  const prev = readState()
  const SKIP_CODES = new Set([22001, 22003, 22007, 22011, 22013, 137017])
  const permSkip = new Set()
  for (const r of (prev.results || [])) {
    if (SKIP_CODES.has(r.code)) permSkip.add(String(r.mid))
  }
  if (permSkip.size) console.log('  ⚠️ 历史永久跳过:', permSkip.size, '个（22011上限/22007隐私/137017异常等）')

  const toFollow = all.filter(u => !mineSet.has(String(u.mid)) && !permSkip.has(String(u.mid)))
  console.log('\n=== Step 3: 待关注 ===', toFollow.length, '个')

  if (!toFollow.length) {
    console.log('  ✅ B号已经全部关注了！')
    writeState({
      syncedAt: new Date().toISOString(),
      ownerScanned: all.length,
      bHad: mineSet.size,
      stillNeed: 0,
      covered: all.length,
      totalToFollow: 0,
      bAdded: 0, bDup: 0, bSkipped: 0, bFailed: 0, bFreqBlocked: 0,
      lastRunDate: todayStr(),
      lastIndex: 0,
      doneToday: (prev.doneToday || 0),
      results: [...(prev.results || [])].slice(-2000),
    })
    return
  }

  // ── Step 4: 每日限额检查 ──
  const today = todayStr()
  let startIndex = 0
  if (DAILY > 0) {
    if (prev.lastRunDate === today) {
      const already = prev.doneToday || 0
      if (already >= DAILY) {
        console.log(`\n⏸️ 今日配额已用完（${already}/${DAILY}），明天再来`)
        const state = {
          syncedAt: new Date().toISOString(),
          ownerScanned: all.length,
          bHad: mineSet.size,
          stillNeed: toFollow.length,
          covered: all.length - toFollow.length,
          totalToFollow: toFollow.length,
          bAdded: 0, bDup: 0, bSkipped: 0, bFailed: 0, bFreqBlocked: 0,
          lastRunDate: prev.lastRunDate || today,
          lastIndex: prev.lastIndex || 0,
          doneToday: prev.doneToday || already,
          results: [...(prev.results || [])].slice(-2000),
        }
        writeState(state)
        return
      }
      startIndex = prev.lastIndex || 0
      console.log(`\n📅 今天已跑 ${already}/${DAILY}，从索引 ${startIndex} 继续`)
    } else {
      console.log(`\n📅 新的一天（${today}），从索引 0 开始，今日限额 ${DAILY}`)
    }
  }

  const slice = toFollow.slice(startIndex)
  const limit = DAILY > 0 ? Math.min(DAILY, slice.length) : slice.length
  console.log(`  本次处理: 索引 ${startIndex} → ${startIndex + limit - 1}（共 ${limit} 个）`)

  // ── Step 5: 执行关注 ──
  console.log('\n=== Step 4: 执行关注（模式:', DRY ? '🔒 DRY' : '🔥 真实', '）===')
  console.log('  每个间隔 800-1200ms, 遇风控暂停 30s, 连续 3 次频率限制提前结束')

  const codeMap = {
    0:'✅', 22001:'⏭️自己', 22002:'⏭️已关',
    22003:'⏭️黑名单', 22007:'⏭️隐私', 22011:'⏭️上限', 22013:'⏭️注销',
    22014:'⛔频率限', 22015:'⛔频率限', 137017:'⏭️账号异常',
    '-101':'❌cookie', '-111':'❌csrf', '-400':'❌参数错误'
  }

  let ok = 0, dup = 0, fail = 0, skip = 0, freqBlocked = 0
  let freqLimitStreak = 0
  const results = []
  let earlyBreak = false

  for (let i = 0; i < limit; i++) {
    const absIndex = startIndex + i
    const u = toFollow[absIndex]
    const body = 'fid=' + u.mid + '&act=1&re_src=11&event=1&csrf=' + botJj
    let j
    if (DRY) {
      j = { code: 0 }
    } else {
      try {
        const r = await fetchWithTimeout('https://api.bilibili.com/x/relation/modify', { method: 'POST', headers: HP, body })
        j = await r.json()
      } catch (e) {
        j = { code: -999, message: e.message }
      }
    }
    const code = j.code
    const label = codeMap[code] || (code === 0 ? '✅' : '❌code=' + code)

    if ((i + 1) % 5 === 0 || i === 0 || i === limit - 1) {
      console.log('  [' + (i + 1) + '/' + limit + ' #abs:' + absIndex + '] ' + String(u.uname).slice(0, 18).padEnd(20) + ' ' + label + (DRY ? ' (DRY)' : ''))
    }

    const isFreq = code === 22014 || code === 22015

    if (code === 0) { ok++; freqLimitStreak = 0 }
    else if (code === 22002) { dup++; freqLimitStreak = 0 }
    else if (code === 22001 || code === 22003 || code === 22007 || code === 22013 || code === 22011 || code === 137017) { skip++; freqLimitStreak = 0 }
    else if (isFreq) {
      freqBlocked++
      freqLimitStreak++
      console.log('  ⛔ 频率限制（连续 ' + freqLimitStreak + ' 次），暂停 60s...')
      await sleep(60000)
      if (freqLimitStreak >= 5) {
        console.log('  🛑 连续 5 次频率限制，提前结束（频率限制不计入进度，下次继续重试）')
        earlyBreak = true
        break
      }
    } else { fail++; freqLimitStreak = 0 }

    results.push({ mid: u.mid, uname: u.uname, code, label })
    if (!DRY) await sleep(1500 + Math.random() * 1000)
  }

  const newLastIndex = startIndex + ok + dup + skip + fail
  const processedThisRun = ok + dup + skip

  console.log('\n=== 汇总 ===')
  console.log('✅成功:', ok, '  ⏭️已关:', dup, '  跳过:', skip, '  ❌失败:', fail, '  ⛔频率限:', freqBlocked + (earlyBreak ? '(提前停)' : ''))
  console.log('  进度:', newLastIndex, '/', toFollow.length, '（' + Math.round(newLastIndex / toFollow.length * 100) + '%）')
  if (freqBlocked > 0) console.log('  ℹ️ 频率限制的 ' + freqBlocked + ' 人不计入进度，下次运行继续重试')

  // ── Step 5.5: 重拉 B 号真实关注数（不信接口返回，信 B 站 API） ──
  let realFollowing = mineSet.size
  try {
    const statR = await fetchWithTimeout(`https://api.bilibili.com/x/relation/stat?vmid=${SELF_MID}`, { headers: HC })
    const statJ = await statR.json()
    if (statJ?.code === 0 && statJ.data?.following) {
      realFollowing = statJ.data.following
      console.log(`  📊 B 站真实关注数: ${realFollowing}（脚本记录: ${mineSet.size + ok}，差异: ${realFollowing - mineSet.size - ok}）`)
    }
  } catch (e) {
    console.log('  ⚠️ 重拉真实关注数失败:', e.message)
  }
  const realCovered = all.filter(u => mineSet.has(String(u.mid))).length + Math.max(0, realFollowing - mineSet.size)

  // ── Step 6: 保存状态 ──
  const state = {
    syncedAt: new Date().toISOString(),
    ownerScanned: all.length,
    bHad: realFollowing,
    stillNeed: Math.max(0, all.length - realCovered),
    covered: realCovered,
    totalToFollow: Math.max(0, all.length - realCovered),
    bAdded: ok,
    bDup: dup,
    bSkipped: skip,
    bFailed: fail,
    bFreqBlocked: freqBlocked,
    lastRunDate: today,
    lastIndex: newLastIndex,
    doneToday: (prev.lastRunDate === today ? (prev.doneToday || 0) : 0) + processedThisRun,
    results: [...(prev.results || []), ...results].slice(-2000),
  }
  writeState(state)
  console.log('\n💾 状态已保存（lastIndex=' + newLastIndex + ' doneToday=' + state.doneToday + '）')

  if (newLastIndex < toFollow.length) {
    const remaining = toFollow.length - newLastIndex
    if (DAILY > 0) {
      const moreDays = Math.ceil(remaining / DAILY)
      console.log('📆 预计还需 ' + moreDays + ' 天补完剩余 ' + remaining + ' 个')
    } else {
      console.log('📆 剩余 ' + remaining + ' 个待关注')
    }
  }

  if (fail > 0 && freqLimitStreak === 0) process.exit(1)
}

main()