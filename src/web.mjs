import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getTasks, setTasks, getState, markDone, markFail, startScheduler, startFollowWatcher, stopFollowWatcher, getFollowStatus, getNextRun, runTask, switchToAccount, restoreDefaultAccount, getActiveAccount, cleanupAll, spawnFollowSync, getSyncStatus } from './scheduler.mjs'
import { PATHS } from './config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))



function doubaoHttps(payload, apiKey, endpointId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: endpointId || '', max_tokens: 2000, ...payload })
    const req = https.request({
      hostname: 'ark.cn-beijing.volces.com',
      path: '/api/v3/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      family: 4,
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(j)
        } catch (e) {
          reject(new Error('JSON parse: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('timeout 10s')) })
    req.write(body)
    req.end()
  })
}

const DATA_DIR = PATHS.dataDir
const REAL_USER_HOMEDIR = PATHS.realHome

function spawnEnv() {
  const env = { ...process.env }
  if (process.env.USERPROFILE !== REAL_USER_HOMEDIR) {
    env.USERPROFILE = REAL_USER_HOMEDIR
    env.HOME = REAL_USER_HOMEDIR
  }
  return env
}

function findFile(candidates) {
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch {}
  }
  return null
}

function toBeijingDate(isoStr) {
  try {
    const d = new Date(isoStr)
    const utcDay = new Date(d.getTime() + 8 * 3600 * 1000)
    return utcDay.toISOString().slice(0, 10)
  } catch { return '' }
}
function toBeijingTime(isoStr) {
  try {
    const d = new Date(isoStr)
    const bjMs = d.getTime() + 8 * 3600 * 1000
    const utcDay = new Date(bjMs)
    const MM = String(utcDay.getUTCMonth() + 1).padStart(2, '0')
    const DD = String(utcDay.getUTCDate()).padStart(2, '0')
    const hh = String(utcDay.getUTCHours()).padStart(2, '0')
    const mm = String(utcDay.getUTCMinutes()).padStart(2, '0')
    const ss = String(utcDay.getUTCSeconds()).padStart(2, '0')
    return `${MM}-${DD} ${hh}:${mm}:${ss}`
  } catch { return '' }
}
function toBeijingHM(isoStr) {
  try {
    const d = new Date(isoStr)
    const bjMs = d.getTime() + 8 * 3600 * 1000
    const utcDay = new Date(bjMs)
    const hh = String(utcDay.getUTCHours()).padStart(2, '0')
    const mm = String(utcDay.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch { return '' }
}

function groupWhaleLog(logs) {
  const grouped = {}
  for (const e of logs) {
    const atStr = String(e.at || '')
    const d = toBeijingDate(atStr) || atStr.slice(0, 10)
    if (!d) continue
    if (!grouped[d]) grouped[d] = []
    let kind = e.kind || ''
    let note = e.note || ''
    let target = e.target || ''
    if (kind && kind.length > 30 && !note) { note = kind; kind = 'thought' }
    if (!note && kind.length > 5) { note = kind; kind = 'event' }
    if (!note) continue
    grouped[d].push({
      kind, target, note,
      time: toBeijingHM(e.at) || String(e.at || '').slice(11, 16),
    })
  }
  return grouped
}
function toBeijingFull(isoStr) {
  try {
    const d = new Date(isoStr)
    const utcDay = new Date(d.getTime() + 8 * 3600 * 1000)
    return utcDay.toISOString().replace('T', ' ').slice(0, 19)
  } catch { return '' }
}

function readWhaleLog() {
  const p = PATHS.whaleLogFile
  if (!p || !fs.existsSync(p)) return []
  try {
    const raw = fs.readFileSync(p, 'utf8').trim()
    if (!raw) return []
    const all = raw.split('\n').map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    const seen = new Map()
    const deduped = []
    for (const e of all) {
      const key = (e.kind || '') + '|' + (e.note || '') + '|' + (e.target || '')
      const atMs = new Date(e.at || 0).getTime()
      if (seen.has(key) && atMs - seen.get(key) < 60000) continue
      seen.set(key, atMs)
      deduped.push(e)
    }
    return deduped
  } catch { return [] }
}

function computeCurrentStatus(agent, whaleLogs) {
  const now = Date.now()
  let lastAt = 0
  let lastActivity = ''
  let running = false
  let detail = ''

  if (whaleLogs && whaleLogs.length) {
    const last = whaleLogs[whaleLogs.length - 1]
    if (last.at) lastAt = new Date(last.at).getTime()
    if (last.kind === 'tool_call' || last.kind === 'action') {
      lastActivity = (last.note || last.tool || last.target || 'tool').slice(0, 40)
      if (last.success === false) detail = '⚠️ 上次调用失败'
    } else if (last.kind === 'thought' || last.kind === 'event') {
      lastActivity = (last.event || last.note || '思考中').slice(0, 40)
    } else {
      lastActivity = (last.note || last.kind || '').slice(0, 40)
    }
  }

  if (agent) {
    const agentStart = agent.startAt ? new Date(agent.startAt).getTime() : 0
    const agentEnd = agent.endAt ? new Date(agent.endAt).getTime() : 0
    if (agent.status === 'running' || (agent.startAt && !agent.endAt)) {
      running = true
      if (agentStart > lastAt) lastAt = agentStart
      lastActivity = 'AI agent 运行中 · 第 ' + (agent.rounds || '?') + ' 轮'
      detail = (agent.promptFile || '').split(/[\\/]/).pop() || '自动任务'
    } else if (agent.status === 'done') {
      if (agentEnd > lastAt) lastAt = agentEnd
    }
  }

  const secAgo = lastAt ? Math.floor((now - lastAt) / 1000) : 0
  let ageStr = ''
  if (secAgo < 60) ageStr = secAgo + 's ago'
  else if (secAgo < 3600) ageStr = Math.floor(secAgo / 60) + 'min ago'
  else ageStr = Math.floor(secAgo / 3600) + 'h ago'

  return {
    status: running ? 'running' : 'idle',
    activity: lastActivity || '无记录',
    detail: detail + (ageStr ? ' · ' + ageStr : ''),
    lastAt: lastAt ? new Date(lastAt).toISOString() : null,
  }
}


const PORT = process.env.PORT || 7890
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0'

function readToolLog() {
  const p = path.join(DATA_DIR, 'tool-log.jsonl')
  if (!fs.existsSync(p)) return []
  try {
    return fs.readFileSync(p, 'utf8').trim().split('\n').map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function bjDate(iso) {
  try {
    // 统一输出 YYYY-MM-DD：toLocaleDateString('zh-CN') 会返回 2026/10/22，
    // 与历史快照的 2026-10-22 不一致，导致同一天出现两条、日增量算重
    const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
    return d.toISOString().slice(0, 10)
  } catch { return '' }
}

function saveStatsSnapshot(snapshot) {
  try {
    const dir = PATHS.dataDir
    const f = path.join(dir, 'stats-history.json')
    let data = []
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    const today = bjDate(new Date().toISOString())
    const existing = data.findIndex(x => x.date === today)
    const prevIdx = existing >= 0 ? existing - 1 : data.length - 1
    const prev = prevIdx >= 0 ? data[prevIdx] : null
    const merged = snapshot
    if (prev) {
      for (const side of ['self', 'owner']) {
        if (!merged[side] || !prev[side]) continue
        const pv = prev[side]
        const nv = merged[side]
        for (const k of ['following', 'follower', 'likes']) {
          if ((!nv[k] || nv[k] === 0) && pv[k]) nv[k] = pv[k]
        }
      }
    }
    const entry = { date: today, ts: Date.now(), ...merged }
    if (existing >= 0) {
      data[existing] = entry
    } else {
      data.push(entry)
    }
    fs.writeFileSync(f, JSON.stringify(data.slice(-60), null, 2))
  } catch {}
}

function summarizeTools(tools) {
  const out = { videos: [], ups: [], comments: [], follows: 0, unfollows: 0, dms: [] }
  const seenBv = new Set()
  const seenUp = new Set()
  for (const e of tools) {
    const t = e.tool || e.name || ''
    const a = e.args || {}
    if (t === 'debrief' || t === 'search') {
      const bv = a.bv || a.bvid || ''
      if (bv && !seenBv.has(bv)) {
        seenBv.add(bv)
        const title = a.title || (typeof a === 'string' ? '' : '')
        out.videos.push({ bv, title: String(title).slice(0, 60) })
      }
    }
    if (t === 'feed') {
      const list = a.list || a.items || []
      for (const item of (Array.isArray(list) ? list : [])) {
        const bv = item.bvid || item.bv || ''
        const up = item.author || item.up_name || item.up || ''
        if (bv && !seenBv.has(bv)) {
          seenBv.add(bv)
          out.videos.push({ bv, title: String(item.title || '').slice(0, 60), up: String(up).slice(0, 30) })
        }
        if (up && !seenUp.has(up)) { seenUp.add(up); out.ups.push(String(up).slice(0, 30)) }
      }
    }
    if (t === 'comment') {
      out.comments.push({ bv: a.bv || a.bvid || '', text: String(a.text || '').slice(0, 80), go: a.go === true })
    }
    if (t === 'follow') out.follows++
    if (t === 'unfollow') out.unfollows++
    if (t === 'dm') out.dms.push({ to: a.to || a.mid || '', text: String(a.text || '').slice(0, 80) })
  }
  return out
}

function summarizeWhale(events) {
  const out = { videos: [], ups: [], comments: [], follows: 0, unfollows: 0, dms: [], thoughts: [] }
  const seenBv = new Set()
  const seenUp = new Set()
  for (const e of events) {
    const kind = e.kind || ''
    if (kind === 'tool_call' || kind === 'action') {
      const tool = e.tool || ''
      const note = e.note || ''
      const target = e.target || ''
      if ((tool === 'archive' || tool === 'danmu' || tool === 'like' || tool === 'fav' || tool === 'share') && target) {
        if (!seenBv.has(target)) {
          seenBv.add(target)
          out.videos.push({ bv: target, title: note.slice(0, 60), up: '' })
        }
      }
      if (tool === 'like' && note.includes('UP主')) {
        const m = note.match(/UP主[:：]\s*(\S+)/)
        if (m && !seenUp.has(m[1])) { seenUp.add(m[1]); out.ups.push(m[1]) }
      }
    } else if (kind === 'comment') {
      const target = e.target || ''
      const note = e.note || ''
      out.comments.push({
        bv: target,
        text: note.slice(0, 80),
        go: e.success !== false,
      })
    } else if (kind === 'thought') {
      out.thoughts.push({
        event: e.event || '',
        note: String(e.note || '').slice(0, 120),
      })
    } else if (kind === 'follow') {
      if (e.action === 'follow') out.follows++
      else if (e.action === 'unfollow') out.unfollows++
    }
  }
  return out
}

function buildDiaryPrompt(cfg, s) {
  const owner = cfg.bili?.ownerName || '主人'
  const lines = [
    `今天我作为 ${owner} 的B站分身，活动记录摘要如下，请帮我写一篇日记总结。`,
    '',
  ]
  if (s.videos.length) {
    lines.push(`**看过的视频（${s.videos.length}条）：**`)
    for (const v of s.videos) lines.push(`  - ${v.bv} ${v.title || ''}${v.up ? ' UP主:' + v.up : ''}`)
    lines.push('')
  }
  if (s.comments.length) {
    lines.push(`**评论（${s.comments.length}条）：**`)
    for (const c of s.comments) lines.push(`  - ${c.bv} "${c.text}" ${c.go ? '(已真发)' : '(dry-run)'}`)
    lines.push('')
  }
  if (s.dms.length) {
    lines.push(`**私信（${s.dms.length}条）：**`)
    for (const d of s.dms) lines.push(`  - 给 ${d.to}: "${d.text}"`)
    lines.push('')
  }
  if (s.follows || s.unfollows) {
    lines.push(`**关注变化：** +${s.follows} -${s.unfollows}`)
    lines.push('')
  }
  if (s.ups.length) {
    lines.push(`**刷到的UP主：** ${s.ups.slice(0, 10).join('、')}`)
    lines.push('')
  }
  if (s.thoughts && s.thoughts.length) {
    lines.push(`**系统事件（${s.thoughts.length}条）：**`)
    for (const t of s.thoughts.slice(-10)) lines.push(`  - [${t.event || 'event'}] ${t.note || ''}`)
    lines.push('')
  }
  lines.push('请生成一篇日记总结，包含：')
  lines.push('1. kind=summary（必须，放在最前）：一两句话总结今天整体干了啥、心情怎么样')
  lines.push('2. kind=thought：今天印象最深的视频/内容 + 你的真实感受（像人写的，几百字）')
  lines.push('3. kind=comment：实际发出的每条评论，target填BV号，note填你发了什么')
  lines.push('4. kind=feeling：碎碎念/心情')
  lines.push('')
  lines.push('格式：每条一行 JSON，字段 {kind, note, target(可选)}。不要 markdown，直接输出 JSONL。')
  return lines.join('\n')
}

let _agentChild = null
function abortAgentRun() {
  if (_agentChild) {
    try { _agentChild.kill('SIGTERM') } catch {}
    _agentChild = null
  }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'agent-state.json'), 'utf8'))
    if (st.status === 'running') {
      st.status = 'aborted'
      st.endAt = new Date().toISOString()
      st.reason = 'user_abort'
      fs.writeFileSync(path.join(DATA_DIR, 'agent-state.json'), JSON.stringify(st, null, 2))
    }
  } catch {}
}

function readData(name) {
  const p = path.join(DATA_DIR, name)
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function writeData(name, content) {
  const p = path.join(DATA_DIR, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
}

function getJson(name) {
  const raw = readData(name)
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function setJson(name, obj) {
  writeData(name, JSON.stringify(obj, null, 2) + '\n')
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

function sendHtml(res, html) {
  send(res, 200, html, 'text/html')
}

function sendStatic(res, relPath, contentType) {
  const absPath = path.join(path.resolve(__dirname, '..'), relPath)
  try {
    const data = fs.readFileSync(absPath)
    res.writeHead(200, {
      'Content-Type': contentType + '; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    })
    res.end(data)
  } catch {
    send(res, 404, JSON.stringify({ error: 'not found' }))
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

async function api(req, res, pathname) {
  if (req.method === 'OPTIONS') return send(res, 200, 'ok')

  if (pathname === '/' && req.method === 'GET') {
    return sendStatic(res, 'public/index.html', 'text/html')
  }
  if (pathname === '/main.css' && req.method === 'GET') {
    return sendStatic(res, 'public/main.css', 'text/css')
  }
  if (pathname === '/styles.css' && req.method === 'GET') {
    return sendStatic(res, 'public/main.css', 'text/css')
  }
  const appJsMatch = pathname.match(/^\/app(\.[a-z]+)*\.js$/)
  if (appJsMatch && req.method === 'GET') {
    return sendStatic(res, 'public' + pathname, 'application/javascript')
  }
  if (pathname === '/iconfont.css' && req.method === 'GET') return sendStatic(res, 'font/iconfont.css', 'text/css')
  if (pathname === '/iconfont.woff2' && req.method === 'GET') return sendStatic(res, 'font/iconfont.woff2', 'font/woff2')
  if (pathname === '/iconfont.woff' && req.method === 'GET') return sendStatic(res, 'font/iconfont.woff', 'font/woff')
  if (pathname === '/iconfont.ttf' && req.method === 'GET') return sendStatic(res, 'font/iconfont.ttf', 'font/ttf')
  if (pathname === '/doubao.svg' && req.method === 'GET') return sendStatic(res, 'font/doubao.svg', 'image/svg+xml')
  if (pathname === '/doubao.png' && req.method === 'GET') return sendStatic(res, 'font/doubao.png', 'image/png')
  const mascotMatch = pathname.match(/^\/mascot\/([A-Za-z0-9_-]+\.png)$/)
  if (mascotMatch && req.method === 'GET') return sendStatic(res, 'public/mascot/' + mascotMatch[1], 'image/png')
  const LOGO_ALIAS = {
    'doubao.png': '豆包.png',
    'qwen.png': '通义千问.png',
    'hunyuan.png': '腾讯混元.png',
    'xiaomi.png': '小米.png',
    'wxyy.png': '文心一言.png',
    'gpt.png': 'GPT.png',
    'claude.png': 'claude.png',
    'gemini.png': 'gemini.png',
    'kimi.png': 'kimi.png',
    'deepseek.png': 'deepseek.png',
    'meta.png': 'meta.png',
    'mistral.png': 'Mistral.png',
    'minimax.png': 'MiniMax.png',
    'grok.png': 'Grok.png',
    'rwkv.png': 'RWKV.png'
  }
  const logoMatch = pathname.match(/^\/logo\/(.+\.(png|svg|jpg|jpeg))$/i)
  if (logoMatch && req.method === 'GET') {
    var raw = decodeURIComponent(logoMatch[1])
    var mapped = LOGO_ALIAS[raw.toLowerCase()] || raw
    return sendStatic(res, 'logo/' + mapped, 'image/png')
  }
  if (pathname === '/api/face' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x').searchParams.get('url')
    if (!url) return send(res, 400, JSON.stringify({ error: 'missing url' }))
    try {
      const up = new URL(url)
      if (!/hdslb\.com$/.test(up.hostname)) return send(res, 403, JSON.stringify({ error: 'forbidden host' }))
      const proxyRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/' } })
      if (!proxyRes.ok) return send(res, proxyRes.status, JSON.stringify({ error: 'upstream ' + proxyRes.status }))
      const buf = Buffer.from(await proxyRes.arrayBuffer())
      const ct = proxyRes.headers.get('content-type') || 'image/jpeg'
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' })
      res.end(buf)
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: e.message }))
    }
    return
  }
  if (pathname === '/config' && req.method === 'GET') {
    const cfg = getJson('config.json')
    const creds = getJson('credentials.json')
    const ac = getActiveAccountCreds()
    const publicCreds = {
      hasDoubaoKey: !!creds.doubaoApiKey,
      doubaoKeyMasked: creds.doubaoApiKey ? creds.doubaoApiKey.slice(0, 8) + '...' : '',
      endpointId: creds.doubaoEndpointId || '',
      biliCookieSet: !!(ac.sess && ac.jct),
      biliAccountId: ac.accountId,
    }
    return send(res, 200, JSON.stringify({ ...cfg, _creds: publicCreds }))
  }
  if (pathname === '/config' && req.method === 'POST') {
    const body = await parseBody(req)
    const cfg = getJson('config.json')
    if (body.preferences) cfg.preferences = body.preferences
    if (body.budget) cfg.budget = body.budget
    if (body.bili?.ownerMid) cfg.bili.ownerMid = body.bili.ownerMid
    if (body.bili?.ownerName) cfg.bili.ownerName = body.bili.ownerName
    if (body.bili?.sessionCookie) cfg.bili.sessionCookie = body.bili.sessionCookie
    if (body.persona) cfg.persona = body.persona
    if (body.diary) cfg.diary = body.diary
    setJson('config.json', cfg)
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (pathname === '/creds' && req.method === 'POST') {
    const body = await parseBody(req)
    const creds = getJson('credentials.json')
    let syncToAccounts = false
    const patch = {}
    if (body.doubaoApiKey) creds.doubaoApiKey = body.doubaoApiKey
    if (body.doubaoEndpointId) creds.doubaoEndpointId = body.doubaoEndpointId
    if (body.biliCookie) {
      const cookie = body.biliCookie
      const ns = extractCookie(cookie, 'SESSDATA')
      const nj = extractCookie(cookie, 'bili_jct')
      const nb = extractCookie(cookie, 'buvid3')
      const nb4 = extractCookie(cookie, 'buvid4')
      const nls = extractCookie(cookie, 'b_lsid')
      const nfp = extractCookie(cookie, 'buvid_fp')
      if (ns) { creds.sessdata = ns; patch.sessdata = ns; syncToAccounts = true }
      if (nj) { creds.bili_jct = nj; creds.biliJct = nj; patch.bili_jct = nj; syncToAccounts = true }
      if (nb) { creds.buvid3 = nb; patch.buvid3 = nb; syncToAccounts = true }
      if (nb4) { creds.buvid4 = nb4; patch.buvid4 = nb4; syncToAccounts = true }
      if (nls) { creds.b_lsid = nls; patch.b_lsid = nls; syncToAccounts = true }
      if (nfp) { creds.buvid_fp = nfp; patch.buvid_fp = nfp; syncToAccounts = true }
    }
    setJson('credentials.json', creds)
    if (syncToAccounts) {
      try {
        const a = getJson('accounts.json')
        const activeId = a.activeId || a.defaultId
        if (activeId) {
          const idx = (a.accounts || []).findIndex(x => x.id === activeId)
          if (idx >= 0) {
            a.accounts[idx] = { ...a.accounts[idx], ...patch }
            fs.writeFileSync(path.join(PATHS.dataDir, 'accounts.json'), JSON.stringify(a, null, 2) + '\n')
          }
        }
      } catch {}
    }
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (pathname === '/follow-config' && req.method === 'POST') {
    const body = await parseBody(req)
    const cfg = {
      enabled: !!body.enabled,
      interval: Math.max(180, Number(body.interval) || 300),
      onlyWhitelist: !!body.onlyWhitelist,
      noComment: !!body.noComment,
      whitelist: (body.whitelist || '').split(/[,，\s]+/).filter(Boolean),
      blacklist: (body.blacklist || '').split(/[,，\s]+/).filter(Boolean),
      templates: (body.templates || '').split('\n').map(s => s.trim()).filter(Boolean),
    }
    setJson('follow-config.json', cfg)
    try { stopFollowWatcher() } catch {}
    if (cfg.enabled) startFollowWatcher()
    return send(res, 200, JSON.stringify({ ok: true, cfg }))
  }
  if (pathname === '/follow-test' && req.method === 'GET') {
    const H = biliReqHeaders()
    if (!H) return send(res, 400, JSON.stringify({ error: '凭据缺失' }))
    try {
      const r = await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1&timezone_offset=-480&platform=web', { headers: H })
      const j = await r.json()
      if (j?.code !== 0) return send(res, 200, JSON.stringify({ error: `code=${j?.code} ${j?.message || ''}` }))
      const items = (j?.data?.items || []).slice(0, 15)
      const out = []
      for (const it of items) {
        const a = it?.modules?.module_author
        const ar = it?.modules?.module_dynamic?.major?.archive
        if (!ar?.bvid) continue
        out.push({
          bvid: ar.bvid,
          title: String(ar.title || '').slice(0, 50),
          up: a?.name || '?',
          mid: a?.mid || 0,
          pub: (a?.pub_ts || 0) ? new Date(a.pub_ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '?',
        })
      }
      return send(res, 200, JSON.stringify({ count: out.length, items: out }))
    } catch (e) {
      return send(res, 200, JSON.stringify({ error: String(e.message) }))
    }
  }
  if (pathname === '/diary' && req.method === 'GET') {
    const grouped = groupWhaleLog(readWhaleLog())
    const diary = Object.entries(grouped).map(([date, events]) => {
      const summaryEvt = events.find(e => e.kind === 'summary')
      const summary = summaryEvt ? summaryEvt.note : `今天共 ${events.length} 条记录`
      const body = events.filter(e => e.kind !== 'summary').slice().reverse()
      return { date, summary, events: body }
    })
    return send(res, 200, JSON.stringify(diary))
  }
  if (pathname === '/api/version' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ version: VERSION }))
  }
  if (pathname === '/api/dashboard' && req.method === 'GET') {
    const cfg = getJson('config.json')
    const creds = getJson('credentials.json')
    const ac = getActiveAccountCreds()
    const activeAccountId = ac.accountId
    const tokens = getJson('tokens.json')
    const tokenHistory = tokens.history || []
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    const todayRec = tokenHistory.find(h => h.date === todayStr)
    const todayTokens = todayRec ? (todayRec.total || 0) : 0
    const budget = cfg.budget?.dailyTokens || 50000
    const diaryMap = groupWhaleLog(readWhaleLog())
    const diaryDates = Object.keys(diaryMap).sort().reverse()
    const latestDate = diaryDates[0] || null
    const latestDiary = latestDate ? {
      date: latestDate,
      summary: (diaryMap[latestDate].find(e => e.kind === 'summary')?.note) || `今天共 ${diaryMap[latestDate].length} 条记录`,
      events: diaryMap[latestDate].filter(e => e.kind !== 'summary').slice(-2),
    } : null
    const agentState = getJson('agent-state.json')
    const agentStatus = agentState.status || 'idle'
    const fwCfg = getJson('follow-config.json')
    return send(res, 200, JSON.stringify({
      todayTokens, budget, latestDiary,
      agentStatus,
      creds: {
        doubaoApiKey: !!creds.doubaoApiKey,
        sessdata: !!(ac.sess && ac.jct),
        biliAccountId: activeAccountId,
      },
      bili: cfg.bili || {},
      noComment: !!fwCfg.noComment,
    }))
  }
  if (pathname === '/api/fw-config' && req.method === 'GET') {
    const fwCfg = getJson('follow-config.json')
    const fwRunning = getFollowStatus()
    return send(res, 200, JSON.stringify({
      enabled: fwCfg.enabled === true,
      interval: fwCfg.interval || 300,
      onlyWhitelist: fwCfg.onlyWhitelist === true,
      noComment: fwCfg.noComment === true,
      whitelist: fwCfg.whitelist || [],
      blacklist: fwCfg.blacklist || [],
      templates: fwCfg.templates || [],
      running: fwRunning?.running === true,
    }))
  }
  if (pathname === '/api/tasks' && req.method === 'GET') {
    const all = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(PATHS.dataDir, 'tasks.json'), 'utf8')) } catch { return [] }
    })()
    const state = getState()
    const today = new Date().toLocaleDateString('sv-SE')
    const enriched = all.map(t => {
      const st = state[t.id || t.name]
      const dowNames = ['周日','周一','周二','周三','周四','周五','周六']
      const dayRaw = t.day
      const days = Array.isArray(dayRaw) ? dayRaw.map(d => dowNames[d] || d).join('/') : (typeof dayRaw==='number' ? dowNames[dayRaw] : '每天')
      const timeStr = t.time || '11:00'
      const lead = t.leadMin || 0
      const triggerH = parseInt(timeStr.split(':')[0] || '11') - Math.floor(lead / 60)
      const triggerM = parseInt(timeStr.split(':')[1] || '0') - (lead % 60)
      const nextRun = t.enabled === false ? null : `${days} ${String(Math.max(0,triggerH)).padStart(2,'0')}:${String(Math.max(0,triggerM)).padStart(2,'0')}`
      const done = st?.date === today
      return {
        ...t,
        days,
        nextRun,
        todayDone: done,
        todayStatus: done ? (st.status || 'done') : 'pending',
        lastRun: st?.date ? `${st.date} ${st.time||''} ${st.status==='fail'?'❌':'✅'}` : null,
      }
    })
    return send(res, 200, JSON.stringify(enriched))
  }
  if (pathname === '/api/tasks' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const all = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(PATHS.dataDir, 'tasks.json'), 'utf8')) } catch { return [] }
    })()
    if (body.action === 'add') {
      const newTask = {
        id: body.task.id || ('task-' + Date.now()),
        name: body.task.name,
        targetUrl: body.task.targetUrl || '',
        day: body.task.day,
        time: body.task.time,
        leadMin: body.task.leadMin || 15,
        template: body.task.template || '',
        ownerRef: body.task.ownerRef || '',
        enabled: body.task.enabled !== false,
        description: body.task.description || '',
        accountId: body.task.accountId || undefined,
        recoveryAccountId: body.task.recoveryAccountId || undefined,
        stages: Array.isArray(body.task.stages) && body.task.stages.length > 0 ? body.task.stages : undefined,
        type: body.task.type,
        script: body.task.script,
        args: body.task.args,
      }
      const existingIdx = all.findIndex(t => t.id === newTask.id)
      if (existingIdx >= 0) all[existingIdx] = newTask
      else all.push(newTask)
    } else if (body.action === 'delete') {
      const id = body.id
      const filtered = all.filter(t => t.id !== id)
      const s = getState(); delete s[id]; fs.writeFileSync(path.join(PATHS.dataDir, 'scheduler-state.json'), JSON.stringify(s, null, 2) + '\n')
      setTasks(filtered)
      return send(res, 200, JSON.stringify({ ok: true }))
    } else if (body.action === 'toggle') {
      const id = body.id
      const t = all.find(x => x.id === id)
      if (t) { t.enabled = !t.enabled; setTasks(all) }
      return send(res, 200, JSON.stringify({ ok: true, enabled: t?.enabled }))
    }
    setTasks(all)
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (pathname === '/tokens' && req.method === 'GET') {
    return send(res, 200, readData('tokens.json') || '{}')
  }
  if (pathname === '/debug' && req.method === 'GET') {
    const paths = [
      PATHS.credFile,
      PATHS.configFile,
      PATHS.biliAiCredFile,
      PATHS.whaleLogFile,
      PATHS.atProcessedFile,
    ]
    const info = paths.map(p => ({
      path: p,
      exists: fs.existsSync(p),
      size: fs.existsSync(p) ? fs.statSync(p).size : 0,
    }))
    return send(res, 200, JSON.stringify({
      home: PATHS.realHome,
      cwd: process.cwd(),
      dataDir: PATHS.dataDir,
      paths: info,
    }, null, 2))
  }
  if (pathname === '/run' && req.method === 'POST') {
    return runDaily(req, res)
  }
  if (pathname === '/tools/search' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams.get('q')
    if (!q) return send(res, 400, JSON.stringify({ error: 'q required' }))
    return runTool(res, ['search', q])
  }
  if (pathname === '/tools/video' && req.method === 'GET') {
    const bvid = new URL(req.url, 'http://x').searchParams.get('bvid')
    if (!bvid) return send(res, 400, JSON.stringify({ error: 'bvid required' }))
    return runTool(res, ['video', bvid])
  }
  if (pathname === '/tools/whois' && req.method === 'GET') {
    const mid = new URL(req.url, 'http://x').searchParams.get('mid')
    if (!mid) return send(res, 400, JSON.stringify({ error: 'mid required' }))
    return runTool(res, ['whois', mid])
  }
  if (pathname === '/tools/feed' && req.method === 'GET') {
    return runTool(res, ['feed'])
  }

  if (pathname === '/api/bili/self' && req.method === 'GET') {
    return biliSelf(res)
  }
  if (pathname === '/api/bili/followings' && req.method === 'GET') {
    const url = new URL('http://x' + req.url)
    const pn = Number(url.searchParams.get('pn')) || 1
    const ps = Math.min(50, Number(url.searchParams.get('ps')) || 20)
    return biliFollowings(res, pn, ps)
  }
  if (pathname === '/api/bili/up' && req.method === 'GET') {
    const url = new URL('http://x' + req.url)
    const mid = Number(url.searchParams.get('mid'))
    if (!mid) return send(res, 400, JSON.stringify({ error: 'mid required' }))
    return biliUpInfo(res, mid)
  }
  if (pathname === '/api/bili/follow' && req.method === 'POST') {
    const body = await parseBody(req)
    const mid = Number(body.mid)
    if (!mid) return send(res, 400, JSON.stringify({ error: 'mid required' }))
    return biliModifyRelation(res, mid, 1)
  }
  if (pathname === '/api/test-creds' && req.method === 'POST') {
    const creds = getJson('credentials.json')
    const results = {}
    if (creds.doubaoApiKey) {
      try {
        const j = await doubaoHttps({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }, creds.doubaoApiKey, creds.doubaoEndpointId)
        results.doubao = { ok: !!j?.choices, message: j?.choices ? 'API key有效' : (j?.error?.message || JSON.stringify(j).slice(0, 80)) }
      } catch (e) {
        results.doubao = { ok: false, message: String(e.message) }
      }
    } else {
      results.doubao = { ok: false, message: '未配置 API Key' }
    }
    try {
      const h = biliReqHeaders()
      if (!h) {
        results.bili = { ok: false, message: 'Cookie缺失SESSDATA或bili_jct' }
      } else {
        const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: h })
        const j = await r.json()
        if (j?.code === 0) results.bili = { ok: true, message: 'UID ' + j.data.mid + ' ' + j.data.uname }
        else results.bili = { ok: false, message: 'code=' + j?.code + ' ' + (j?.message || '') }
      }
    } catch (e) {
      results.bili = { ok: false, message: String(e.message) }
    }
    return send(res, 200, JSON.stringify(results))
  }

  if (pathname === '/api/accounts' && req.method === 'GET') {
    return (async () => {
      const aFile = path.join(PATHS.dataDir, 'accounts.json')
      let data = { accounts: [], defaultId: null, activeId: null }
      try { data = JSON.parse(fs.readFileSync(aFile, 'utf8')) } catch {}
      const list = []
      for (const acc of data.accounts || []) {
        const masked = { ...acc }
        if (masked.sessdata) masked.sessdata = String(masked.sessdata).slice(0, 10) + '...'
        if (masked.bili_jct) masked.bili_jct = String(masked.bili_jct).slice(0, 6) + '...'
        let status = null
        try {
          const tmpH = { cookie: `SESSDATA=${acc.sessdata || ''}; bili_jct=${acc.bili_jct || ''}`, 'user-agent': 'Mozilla/5.0' }
          const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: tmpH })
          const j = await r.json()
          status = { ok: j?.code === 0, uname: j?.data?.uname || '', mid: j?.data?.mid, face: j?.data?.face || '', code: j?.code }
        } catch (e) { status = { ok: false, error: String(e.message) } }
        list.push({ ...masked, status })
      }
      return send(res, 200, JSON.stringify({ accounts: list, defaultId: data.defaultId, activeId: data.activeId }))
    })()
  }
  if (pathname === '/api/accounts' && req.method === 'POST') {
    const body = await parseBody(req)
    const aFile = path.join(PATHS.dataDir, 'accounts.json')
    let data = { accounts: [], defaultId: null, activeId: null }
    try { data = JSON.parse(fs.readFileSync(aFile, 'utf8')) } catch {}

    if (body.action === 'add' || body.action === 'update') {
      const acc = body.account
      if (!acc || !acc.id) return send(res, 400, JSON.stringify({ ok: false, error: 'account.id required' }))
      const idx = data.accounts.findIndex(x => x.id === acc.id)
      if (idx >= 0) data.accounts[idx] = { ...data.accounts[idx], ...acc }
      else data.accounts.push({ ...acc, _createdAt: new Date().toISOString() })
      if (!data.activeId) data.activeId = acc.id
    } else if (body.action === 'delete') {
      data.accounts = data.accounts.filter(x => x.id !== body.id)
      if (data.defaultId === body.id) data.defaultId = data.accounts.find(x => x.role === 'bot')?.id || data.accounts[0]?.id || null
      if (data.activeId === body.id) data.activeId = data.defaultId
    } else if (body.action === 'set-default') {
      if (!data.accounts.find(x => x.id === body.id)) return send(res, 400, JSON.stringify({ ok: false, error: 'account not found' }))
      data.defaultId = body.id
    }
    try { fs.writeFileSync(aFile, JSON.stringify(data, null, 2) + '\n') } catch (e) { return send(res, 500, JSON.stringify({ ok: false, error: e.message })) }

    const activeId = data.activeId || data.defaultId
    if (activeId) {
      const acc = data.accounts.find(x => x.id === activeId)
      if (acc) {
        applyAccountToCreds(acc)
      }
    }
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (pathname === '/api/accounts/switch' && req.method === 'POST') {
    const body = await parseBody(req)
    const id = body.id
    const ok = switchToAccount(id)
    return send(res, 200, JSON.stringify({ ok, activeId: getActiveAccount() }))
  }
  if (pathname === '/api/accounts/restore' && req.method === 'POST') {
    const ok = restoreDefaultAccount()
    return send(res, 200, JSON.stringify({ ok, activeId: getActiveAccount() }))
  }

  if (pathname === '/api/daily-checkin' && req.method === 'GET') {
    return (async () => {
      const h = biliReqHeaders()
      if (!h) return send(res, 200, JSON.stringify({ ok: false, error: 'Cookie缺失，请在"账户"标签页更新B站 Cookie' }))
      let level = null, reward = null, err = null, warn = null
      try {
        const r1 = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: h })
        const j1 = await r1.json()
        if (j1?.code === 0) {
          level = j1.data?.level_info
        } else if (j1?.code === -101) {
          err = 'Cookie已失效（code=-101），请重新登录B站获取新Cookie'
        } else {
          warn = (warn ? warn + '; ' : '') + 'nav code=' + j1?.code
        }
      } catch (e) { err = String(e.message) }
      try {
        const r2 = await fetch('https://api.bilibili.com/x/member/web/exp/reward', { headers: h })
        const j2 = await r2.json()
        if (j2?.code === 0) {
          reward = j2.data
        } else if (j2?.code === -101) {
          if (!err) err = 'Cookie已失效（code=-101），请重新登录B站获取新Cookie'
        } else {
          warn = (warn ? warn + '; ' : '') + 'reward code=' + j2?.code + ' ' + (j2?.message || '')
        }
      } catch (e) { err = (err ? err + '; ' : '') + String(e.message) }

      const tasks = []
      const expMap = { login: 10, watch: 5, coins: 5, share: 10 }
      const labels = { login: '每日登录', watch: '观看视频', coins: '投币', share: '分享视频' }

      if (reward && typeof reward === 'object') {
        for (const k of ['login', 'watch', 'coins', 'share']) {
          const v = reward[k]
          if (typeof v === 'boolean') {
            tasks.push({ key: k, label: labels[k], exp: expMap[k], done: v })
          } else if (typeof v === 'number') {
            tasks.push({ key: k, label: labels[k], exp: expMap[k], done: v >= (k === 'coins' ? 5 : 1), progress: v })
          }
        }
        if (tasks.length === 0 && Array.isArray(reward.tasks)) {
          for (const t of reward.tasks) {
            if (t && t.name && typeof t.done === 'boolean') {
              tasks.push({ key: t.name, label: t.title || t.name, exp: t.exp || 0, done: t.done, progress: t.progress })
            }
          }
        }
      }

      const totalExp = tasks.reduce((s, t) => s + (t.done ? t.exp : 0), 0)

      return send(res, 200, JSON.stringify({
        ok: !err,
        level,
        tasks,
        totalExp,
        allDone: tasks.length > 0 && tasks.every(t => t.done),
        error: err,
        warning: warn,
        rewardRaw: reward,
      }))
    })()
  }

  if (pathname === '/api/follow/status' && req.method === 'GET') {
    const st = getFollowStatus()
    let cfg = {}
    try { cfg = JSON.parse(fs.readFileSync(path.join(PATHS.dataDir, 'follow-config.json'), 'utf8')) } catch {}
    return send(res, 200, JSON.stringify({
      running: st.running,
      pid: st.pid,
      enabled: cfg.enabled !== false,
      interval: cfg.interval || 300,
      noComment: !!cfg.noComment,
      onlyWhitelist: !!cfg.onlyWhitelist,
    }))
  }

  if (pathname === '/api/follow/toggle' && req.method === 'POST') {
    const body = await parseBody(req)
    const action = body.action
    try {
      if (action === 'start') startFollowWatcher()
      else if (action === 'stop') stopFollowWatcher()
    } catch (e) { return send(res, 500, JSON.stringify({ ok: false, error: String(e.message) })) }
    return send(res, 200, JSON.stringify({ ok: true }))
  }

  if (pathname === '/api/task/run' && req.method === 'POST') {
    const body = await parseBody(req)
    const id = body.id
    const tasks = getTasks()
    const task = tasks.find(t => t.id === id)
    if (!task) return send(res, 404, JSON.stringify({ ok: false, error: '任务不存在' }))
    send(res, 200, JSON.stringify({ ok: true, message: '任务已启动', id: task.id, name: task.name }))
    runTask(task).catch(e => console.error('[task/run] error:', e?.message))
    return
  }

  if (pathname === '/api/follow/sync-status' && req.method === 'GET') {
    const stateFile = path.join(PATHS.dataDir, 'follow-sync-state.json')
    const ownerPlan = path.join(process.cwd(), 'owner-followings.json')
    const configFile = path.join(PATHS.dataDir, 'config.json')
    let state = {}
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}
    let ownerTotal = state.ownerScanned || 0
    let selfMid = ''
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      selfMid = String(cfg.bili?.selfMid || '')
    } catch {}
    try {
      const ownerList = JSON.parse(fs.readFileSync(ownerPlan, 'utf8'))
      ownerTotal = ownerList.filter(u => String(u.mid) !== selfMid).length
    } catch {}
    const todayStr = new Date().toLocaleDateString('sv-SE')
    const isTodayRun = state.lastRunDate === todayStr
    const results = state.results || []
    const recentFailures = isTodayRun
      ? results.filter(r => {
          const c = r.code
          return c !== 0 && c !== 22002 && c !== 22001 && c !== 22003 && c !== 22007 && c !== 22013
        }).slice(-5).reverse()
      : []
    const recentSuccess = isTodayRun
      ? results.filter(r => r.code === 0 || r.code === 22002).slice(-5).reverse()
      : []
    let freqBlocked = 0, permFail = 0
    if (isTodayRun) {
      freqBlocked = state.bFreqBlocked || 0
      permFail = state.bFailed || 0
    }
    const done = state.covered || 0
    const remaining = state.stillNeed || 0
    const pct = ownerTotal > 0 ? Math.min(100, Math.round(done / ownerTotal * 100)) : 0
    const doneTodayVal = isTodayRun ? (state.doneToday || 0) : 0
    return send(res, 200, JSON.stringify({
      total: ownerTotal, done, failed: freqBlocked, permFail, freqBlocked, remaining, pct,
      ownerScanned: state.ownerScanned || ownerTotal,
      bHad: state.bHad || 0,
      lastRunDate: state.lastRunDate || null,
      lastIndex: state.lastIndex || 0,
      doneToday: doneTodayVal,
      recentFailures,
      recentSuccess,
    }))
  }

  if (pathname === '/api/follow/sync-run' && req.method === 'POST') {
    const url = new URL(req.url, 'http://x')
    const daily = Math.max(1, Math.min(100, Number(url.searchParams.get('daily') || 20)))
    const ok = spawnFollowSync(daily)
    if (!ok) return send(res, 409, JSON.stringify({ ok: false, message: '已有同步进程在运行' }))
    return send(res, 200, JSON.stringify({ ok: true, daily }))
  }

  if (pathname === '/api/follow/sync-running' && req.method === 'GET') {
    return send(res, 200, JSON.stringify(getSyncStatus()))
  }

  if (pathname === '/api/abort' && req.method === 'POST') {
    try {
      abortAgentRun()
    } catch (e) {}
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (pathname === '/api/trajectory' && req.method === 'GET') {
    let runs = []
    let tools = []
    let agentStatus = null
    const bj = (iso) => toBeijingTime(iso)
    const nowMs = Date.now()
    const threeDays = 3 * 24 * 3600 * 1000
    const recent = (iso) => {
      try { return (nowMs - new Date(iso).getTime()) < threeDays } catch { return true }
    }
    try {
      const agent = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'agent-state.json'), 'utf8'))
      agentStatus = agent
      if (agent && recent(agent.startAt || agent.endAt)) {
        if (agent.status === 'running') runs.push({ event: 'start', time: bj(agent.startAt), _raw: agent.startAt })
        else if (agent.status === 'done') {
          runs.push({ event: 'start', time: bj(agent.startAt), _raw: agent.startAt })
          runs.push({ event: 'done', time: bj(agent.endAt), _raw: agent.endAt, usage: agent.tokens || {} })
        } else if (agent.status === 'aborted') {
          runs.push({ event: 'start', time: bj(agent.startAt), _raw: agent.startAt })
          runs.push({ event: 'aborted', time: bj(agent.endAt || agent.startAt), _raw: agent.endAt || agent.startAt, reason: agent.reason })
        } else if (agent.status === 'forced') {
          runs.push({ event: 'forced', time: bj(agent.endAt || agent.startAt), _raw: agent.endAt || agent.startAt, reason: agent.reason })
        } else {
          runs.push({ event: agent.status, time: bj(agent.startAt), _raw: agent.startAt })
        }
      }
    } catch {}
    const whaleLogs = readWhaleLog()
    for (const e of whaleLogs) {
      if (!e.at || !recent(e.at)) continue
      const _link = e.target ? `https://www.bilibili.com/video/${e.target}` : null
      if (e.kind === 'tool_call' || e.kind === 'action' || e.kind === 'comment') {
        tools.push({
          time: bj(e.at),
          _raw: e.at,
          status: e.success ? 'ok' : (e.success === false ? 'fail' : 'ok'),
          label: e.note || e.tool || e.target || '',
          resultSize: e.note ? String(e.note).length : 0,
          durationMs: e.durationMs || 0,
          tool: e.tool,
          target: e.target,
          link: _link,
        })
      } else {
        runs.push({ event: e.kind || 'event', time: bj(e.at), _raw: e.at, content: String(e.event || e.note || e.summary || '').slice(0, 80), target: e.target, link: _link })
      }
    }
    runs = runs.sort((a, b) => new Date(a._raw || a.time) - new Date(b._raw || b.time))
    tools = tools.sort((a, b) => new Date(a._raw || a.time) - new Date(b._raw || b.time))

    const currentStatus = computeCurrentStatus(agentStatus, whaleLogs)
    if (currentStatus.lastAt) currentStatus.lastAt = bj(currentStatus.lastAt)

    for (const r of runs) delete r._raw
    for (const t of tools) delete t._raw

    const fw = getFollowStatus()
    let whaleFileMtime = null
    try {
      if (fs.existsSync(PATHS.whaleLogFile)) {
        whaleFileMtime = bj(fs.statSync(PATHS.whaleLogFile).mtime.toISOString())
      }
    } catch {}

    return send(res, 200, JSON.stringify({
      runs, tools, currentStatus,
      followRunning: fw?.running === true,
      followPid: fw?.pid || null,
      followLastCheck: fw?.lastCheck ? bj(fw.lastCheck) : null,
      whaleMtime: whaleFileMtime,
    }))
  }
  if (pathname === '/api/daily-report' && req.method === 'GET') {
    const whaleLogs = readWhaleLog()
    const today = bjDate(new Date().toISOString())
    const todayLogs = whaleLogs.filter(e => bjDate(e.at) === today)
    let archives = 0, danmus = 0, comments = 0, likes = 0, favs = 0, shares = 0
    const actions = []
    for (const e of todayLogs) {
      if (e.kind === 'tool_call' || e.kind === 'action') {
        if (e.tool === 'archive') archives++
        if (e.tool === 'danmu') danmus++
        if (e.tool === 'like') likes++
        if (e.tool === 'fav') favs++
        if (e.tool === 'share') shares++
        if (e.target) actions.push({
          t: e.at,
          tool: e.tool,
          target: e.target,
          link: /^cv\d+$/.test(e.target) ? `https://www.bilibili.com/read/${e.target}/` : `https://www.bilibili.com/video/${e.target}`,
          note: e.note || '',
          success: e.success !== false,
        })
      } else if (e.kind === 'comment') {
        comments++
        if (e.target) actions.push({ t: e.at, tool: 'comment', target: e.target, link: `https://www.bilibili.com/video/${e.target}`, note: e.note || e.text || '', success: e.success !== false, fakeSuccess: !!e.fakeSuccess, verifiedState: e.verifiedState ?? null })      }
    }
    return send(res, 200, JSON.stringify({
      date: today,
      archives, danmus, comments, likes, favs, shares,
      interactions: archives + danmus + comments,
      totalLogs: todayLogs.length,
      actions: actions.slice(-80).reverse(),
    }))
  }
  if (pathname === '/api/like-log' && req.method === 'GET') {
    // 点赞明细：专栏点赞（tool:'like'）+ 视频三连（tool:'archive'，含点赞）
    const days = Math.min(30, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 7))
    const since = Date.now() - days * 86400000
    const isArticle = (t) => /^cv\d+$/.test(t || '')
    const items = readWhaleLog().filter(e => {
      if (e.kind !== 'tool_call' && e.kind !== 'action') return false
      if (e.tool !== 'like' && e.tool !== 'archive') return false
      return new Date(e.at || 0).getTime() >= since
    }).map(e => {
      const article = isArticle(e.target)
      return {
        t: e.at,
        type: article ? 'article' : 'video',
        target: e.target || '',
        note: e.note || '',
        link: article ? `https://www.bilibili.com/read/${e.target}/` : `https://www.bilibili.com/video/${e.target}`,
        success: e.success !== false,
      }
    })
    const today = bjDate(new Date().toISOString())
    const todayItems = items.filter(i => bjDate(i.t) === today)
    return send(res, 200, JSON.stringify({
      days,
      todayCount: todayItems.length,
      todayOk: todayItems.filter(i => i.success).length,
      totalCount: items.length,
      items: items.slice(-60).reverse(),
    }))
  }
  if (pathname === '/api/bili-stats' && req.method === 'GET') {
    const cfg = getJson('config.json')
    const ownerMid = cfg.bili?.ownerMid
    const ownerName = cfg.bili?.ownerName || '主人'
    const selfMid = cfg.bili?.selfMid
    const botH = biliReqHeaders('bot') || biliReqHeaders()
    const mainH = biliReqHeaders('main')
    const activeAcc = getActiveAccountCreds()

    async function fetchStats(mid, useCookie, headerH) {
      const H = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://space.bilibili.com/${mid}`,
      }
      if (useCookie && headerH?.cookie) {
        H.Cookie = headerH.cookie
      }
      let following = 0, follower = 0, likes = 0
      try {
        const r = await fetch(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`, { headers: H })
        const j = await r.json()
        if (j?.code === 0) { following = j.data?.following ?? 0; follower = j.data?.follower ?? 0 }
      } catch {}
      try {
        const r = await fetch(`https://api.bilibili.com/x/space/upstat?mid=${mid}`, { headers: H })
        const j = await r.json()
        if (j?.code === 0) likes = j.data?.likes ?? 0
      } catch {}
      return { following, follower, likes }
    }

    let selfData = { following: 0, follower: 0, likes: 0 }
    let ownerData = { following: 0, follower: 0, likes: 0 }
    let selfNav = null
    let ownerNav = null
    let atCount = 0, replyCount = 0, likeReplyCount = 0
    let ownerAt = 0, ownerReply = 0, ownerLikeReply = 0

    if (selfMid) selfData = await fetchStats(selfMid, true, botH)
    if (ownerMid && String(ownerMid) !== String(selfMid)) ownerData = await fetchStats(ownerMid, true, botH)

    if (botH?.cookie) {
      const Hnav = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': botH.cookie,
      }
      try {
        const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: Hnav })
        const j = await r.json()
        if (j?.code === 0) selfNav = j.data
      } catch {}
      try {
        const r = await fetch('https://api.bilibili.com/x/msgfeed/unread?build=0&mobi_app=web', { headers: Hnav })
        const j = await r.json()
        if (j?.code === 0) {
          atCount = j.data?.at ?? 0
          replyCount = j.data?.reply ?? 0
          likeReplyCount = j.data?.liked_reply ?? 0
        }
      } catch {}
    }

    if (mainH?.cookie && ownerMid) {
      const HmainNav = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': mainH.cookie,
      }
      try {
        const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: HmainNav })
        const j = await r.json()
        if (j?.code === 0) ownerNav = j.data
      } catch {}
      try {
        const r = await fetch('https://api.bilibili.com/x/msgfeed/unread?build=0&mobi_app=web', { headers: HmainNav })
        const j = await r.json()
        if (j?.code === 0) {
          ownerAt = j.data?.at ?? 0
          ownerReply = j.data?.reply ?? 0
          ownerLikeReply = j.data?.liked_reply ?? 0
        }
      } catch {}
    }

    saveStatsSnapshot({ self: selfData, owner: ownerData, selfMid, ownerMid, ownerName })

    const aPool = getJson('accounts.json')
    const botAcc = (aPool.accounts || []).find(a => a.role === 'bot' || a.id === 'bot')
    const selfNavUnameOK = selfNav && String(selfNav.mid) === String(selfMid)
    const selfName = selfNavUnameOK ? selfNav.uname
      : cfg.bili?.selfName
        || botAcc?.name
          || botAcc?.label?.replace(/^[（(]?小号[)）]?\s*[（(]?分身[)）]?$/g, '').trim()
            || '豆包分身'

    let ownerFace = null
    let botFace = null
    try {
      const r = await fetch(`https://api.bilibili.com/x/space/acc/info?mid=${ownerMid}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://space.bilibili.com/${ownerMid}` } })
      const j = await r.json()
      if (j?.code === 0) ownerFace = j.data?.face || null
    } catch {}
    try {
      const r = await fetch(`https://api.bilibili.com/x/space/acc/info?mid=${selfMid}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://space.bilibili.com/${selfMid}` } })
      const j = await r.json()
      if (j?.code === 0) botFace = j.data?.face || null
    } catch {}
    const selfFace = selfNavUnameOK ? (selfNav?.face || botFace) : (botFace || selfNav?.face || null)

    return send(res, 200, JSON.stringify({
      ok: !!selfNav || !!selfMid,
      cookieLogin: !!selfNav?.isLogin,
      cookieInfo: activeAcc.sess && activeAcc.jct ? {
        hasSess: !!activeAcc.sess,
        hasJct: !!activeAcc.jct,
        hasBuvid3: !!activeAcc.buvid,
        isLogin: !!selfNav?.isLogin,
        expireTs: selfNav?.expire_info || null,
        accountId: activeAcc.accountId,
      } : null,
      owner: { mid: ownerMid, name: ownerName, face: ownerFace, coin: ownerNav?.money ?? 0, level: ownerNav?.level_info?.current_level ?? 0, unread: { at: ownerAt, reply: ownerReply, likeReply: ownerLikeReply }, ...ownerData },
      self: { mid: selfMid, name: selfName, face: selfFace, coin: selfNav?.money ?? 0, level: selfNav?.level_info?.current_level ?? 0, ...selfData, unread: { at: atCount, reply: replyCount, likeReply: likeReplyCount } },
    }))
  }
  if (pathname === '/api/stats-history' && req.method === 'GET') {
    const dir = PATHS.dataDir
    const f = path.join(dir, 'stats-history.json')
    let data = []
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    return send(res, 200, JSON.stringify({ ok: true, data }))
  }
  if (pathname === '/api/bili/unfollow' && req.method === 'POST') {
    const body = await parseBody(req)
    const mid = Number(body.mid)
    if (!mid) return send(res, 400, JSON.stringify({ error: 'mid required' }))
    return biliModifyRelation(res, mid, 2)
  }
  if (pathname === '/api/generate-diary' && req.method === 'POST') {
    const creds = getJson('credentials.json')
    if (!creds.doubaoApiKey) return send(res, 400, JSON.stringify({ error: '未配置豆包 API Key' }))
    const today = bjDate(new Date().toISOString())
    const whaleToday = readWhaleLog().filter(e => bjDate(e.at) === today)
    const toolToday = readToolLog().filter(e => bjDate(e.time || e.at) === today)
    const agentState = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(PATHS.dataDir, 'agent-state.json'), 'utf8')) } catch { return null }
    })()
    const followSyncRec = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(PATHS.dataDir, 'follow-sync-state.json'), 'utf8')) } catch { return null }
    })()
    let summary
    let source = ''
    if (whaleToday.length > 0) {
      summary = summarizeWhale(whaleToday)
      source = 'whale-log'
    } else if (toolToday.length > 0) {
      summary = summarizeTools(toolToday)
      source = 'tool-log'
    } else {
      const combined = {
        videos: [], ups: [], comments: [], follows: 0, unfollows: 0, dms: [],
      }
      if (agentState?.rounds || agentState?.lastAt) {
        combined.videos.push({ bv: agentState.lastBv || '', title: `AI agent 运行 ${agentState.rounds || 0} 轮`, up: '' })
      }
      if (followSyncRec) {
        combined.follows = (followSyncRec.doneToday || 0)
      }
      if (combined.videos.length || combined.follows) {
        summary = combined
        source = 'agent-state+follow-sync'
      } else {
        return send(res, 400, JSON.stringify({ error: '今天还没有任何活动记录' }))
      }
    }
    const cfg = getJson('config.json')
    const prompt = buildDiaryPrompt(cfg, summary)
    try {
      const j = await doubaoHttps({ messages: [
            { role: 'system', content: `你是主人（${cfg.bili?.ownerName || ''}）的B站分身。主人让你根据今天的活动记录，写一篇结构化的日记总结。` },
            { role: 'user', content: prompt },
          ], max_tokens: 1500 }, creds.doubaoApiKey, creds.doubaoEndpointId)
      const text = j?.choices?.[0]?.message?.content || ''
      if (!text) return send(res, 500, JSON.stringify({ error: '豆包返回空', raw: JSON.stringify(j).slice(0, 200) }))
      const whaleDir = path.dirname(PATHS.whaleLogFile)
      if (!fs.existsSync(whaleDir)) fs.mkdirSync(whaleDir, { recursive: true })
      const whalePath = PATHS.whaleLogFile
      const now = new Date()
      const parsed = []
      for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
        try {
          if (line.startsWith('{')) { const obj = JSON.parse(line); if (obj.kind && obj.note) parsed.push(obj); continue }
        } catch {}
        const m = line.match(/^\*\*(summary|thought|comment|feeling|wake|action)\*\*[:：]?\s*(.+)$/)
        if (m) parsed.push({ kind: m[1], note: m[2] })
      }
      const toWrite = parsed.length > 0 ? parsed : [{ kind: 'summary', note: text }]
      let i = 0
      for (const ev of toWrite) {
        const at = new Date(now.getTime() + i * 1000).toISOString()
        const line = JSON.stringify({ at, kind: ev.kind, note: String(ev.note || '').slice(0, 1000), ...(ev.target ? { target: ev.target } : {}) })
        fs.appendFileSync(whalePath, line + '\n')
        i++
      }
      return send(res, 200, JSON.stringify({ ok: true, count: toWrite.length, note: text.slice(0, 200) }))
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e.message) }))
    }
  }
  if (pathname === '/api/at-me' && req.method === 'GET') {
    const H = biliReqHeaders()
    if (!H) return send(res, 400, JSON.stringify({ error: '凭据缺失' }))
    try {
      const r = await fetch('https://api.bilibili.com/x/msgfeed/at?build=0&mobi_app=web', { headers: H })
      const j = await r.json()
      if (j.code !== 0) return send(res, 500, JSON.stringify({ error: `at-me code=${j.code} ${j.message}` }))
      const cfg = getJson('config.json')
      const ownerMid = String(cfg.bili?.ownerMid || '')
      const myMid = String(cfg.bili?.selfMid || '')
      const processed = loadAtProcessed()
      let ownerFace = ''
      if (ownerMid) {
        try {
          const cardR = await fetch('https://api.bilibili.com/x/web-interface/card?mid=' + ownerMid, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/' } })
          const cardJ = await cardR.json()
          if (cardJ?.code === 0) ownerFace = cardJ.data?.card?.face || ''
        } catch {}
      }
      const rawItems = (j.data?.items || [])
      const checked = await Promise.all(rawItems.map(async x => {
        const isOwner = String(x.user?.mid) === ownerMid
        const id = String(x.id)
        let replied = processed.has(id)
        if (!replied && isOwner && myMid) {
          replied = await checkAlreadyReplied(H, x.item?.subject_id, x.item?.root_id, x.item?.source_id, myMid)
          if (replied) saveAtProcessed(id)
        }
        return {
          id,
          at_time: x.at_time,
          nickname: x.user?.nickname || '',
          mid: String(x.user?.mid || ''),
          avatar: x.user?.face || (isOwner ? ownerFace : ''),
          content: x.item?.source_content || '',
          bvid: extractBv(x.item?.uri || ''),
          aid: x.item?.subject_id || '',
          root_id: x.item?.root_id || 0,
          source_id: x.item?.source_id || '',
          is_owner: isOwner,
          processed: replied,
        }
      }))
      const ownerItems = checked.filter(x => x.is_owner && !x.processed)
      return send(res, 200, JSON.stringify({ total: checked.length, owner_unprocessed: ownerItems.length, items: ownerItems }))
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e.message) }))
    }
  }
  if (pathname === '/api/reply-at' && req.method === 'POST') {
    const body = await parseBody(req)
    const atId = body.id
    if (!atId) return send(res, 400, JSON.stringify({ error: '缺少 id' }))
    const H = biliReqHeaders()
    if (!H) return send(res, 400, JSON.stringify({ error: '凭据缺失' }))
    const processed = loadAtProcessed()
    if (processed.has(String(atId))) {
      return send(res, 400, JSON.stringify({ error: '已经回复过这条 @ 了，不再重复' }))
    }
    const cfg = getJson('config.json')
    const ownerMid = String(cfg.bili?.ownerMid || '')
    const myMid = String(cfg.bili?.selfMid || '')
    const creds = getJson('credentials.json')
    if (!creds.doubaoApiKey) return send(res, 400, JSON.stringify({ error: '未配置豆包 API Key' }))
    try {
      const r = await fetch('https://api.bilibili.com/x/msgfeed/at?build=0&mobi_app=web', { headers: H })
      const j = await r.json()
      const atItem = (j.data?.items || []).find(x => String(x.id) === String(atId))
      if (!atItem) return send(res, 404, JSON.stringify({ error: '找不到这条 @' }))
      if (String(atItem.user?.mid) !== ownerMid) return send(res, 400, JSON.stringify({ error: '不是主人艾特的，按规矩不回' }))
      const aid = atItem.item?.subject_id
      const sourceId = atItem.item?.source_id
      const root = sourceId
      const parent = sourceId
      if (myMid && await checkAlreadyReplied(H, aid, root, parent, myMid)) {
        saveAtProcessed(String(atId))
        return send(res, 400, JSON.stringify({ error: '评论区已存在我的回复，跳过' }))
      }
      const bvid = extractBv(atItem.item?.uri || '')
      if (!bvid) return send(res, 400, JSON.stringify({ error: '无法从 URI 解析 BV' }))
      const content = atItem.item?.source_content || ''
      const nickname = atItem.user?.nickname || cfg.bili?.ownerName || '主人'
      const replyText = await generateAtReply(creds, cfg, nickname, content, bvid)
      if (!replyText) return send(res, 500, JSON.stringify({ error: '豆包生成空回复' }))
      const commentScript = path.join(path.resolve(__dirname, '..'), 'tools', 'commands', 'comment.mjs')
      const args = ['--oid', String(aid), '--bvid', bvid, '--message', replyText, '--root', String(root), '--parent', String(parent), '--go']
      const child = spawn('node', [commentScript, ...args], { env: spawnEnv() })
      let out = '', err = ''
      child.stdout.on('data', b => out += b.toString())
      child.stderr.on('data', b => err += b.toString())
      const code = await new Promise(resolve => child.on('close', resolve))
      const fakeSuccess = code === 7
      const ok = code === 0
      const verifiedState = (out.match(/\[state-check\] state=(-?\d+)/) || [])[1] || ''
      if (!ok && !fakeSuccess) {
        return send(res, 500, JSON.stringify({ error: `评论发送失败(code=${code}): ${err.trim() || out.trim()}` }))
      }
      saveAtProcessed(String(atId))
      fs.appendFileSync(PATHS.whaleLogFile, JSON.stringify({ at: new Date().toISOString(), kind: 'comment', note: `回复主人 @：${content.slice(0, 60)} → ${replyText.slice(0, 80)}`, target: bvid, success: ok, fakeSuccess: fakeSuccess, verifiedState: verifiedState ? Number(verifiedState) : null, exitCode: code }) + '\n')
      return send(res, 200, JSON.stringify({ ok: true, message: replyText, comment_result: out.trim().slice(0, 300) }))
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: String(e.message) }))
    }
  }

  return send(res, 404, JSON.stringify({ error: 'not found' }))
}

function applyAccountToCreds(account) {
  if (!account || !PATHS.credFile) return false
  let creds = {}
  try { creds = JSON.parse(fs.readFileSync(PATHS.credFile, 'utf8')) } catch { creds = {} }
  let changed = false
  for (const f of ['sessdata', 'buvid3', 'buvid4', 'buvid_fp', 'b_lsid']) {
    if (account[f] !== undefined && account[f] !== creds[f]) { creds[f] = account[f]; changed = true }
  }
  if (account.bili_jct !== undefined) {
    if (creds.bili_jct !== account.bili_jct || creds.biliJct !== account.bili_jct) {
      creds.bili_jct = account.bili_jct
      creds.biliJct = account.bili_jct
      changed = true
    }
  }
  if (account.sessdata !== undefined && creds.sessdata !== account.sessdata) { creds.sessdata = account.sessdata; changed = true }
  if (changed) { fs.writeFileSync(PATHS.credFile, JSON.stringify(creds, null, 2) + '\n') }
  return changed
}

function getActiveAccountCreds() {
  const a = getJson('accounts.json')
  const activeId = a.activeId || a.defaultId
  if (activeId) {
    const acc = (a.accounts || []).find(x => x.id === activeId)
    if (acc && acc.sessdata && (acc.bili_jct || acc.biliJct)) {
      return { sess: acc.sessdata, jct: acc.bili_jct || acc.biliJct, buvid: acc.buvid3, buvid4: acc.buvid4, buvidFp: acc.buvid_fp, bLsid: acc.b_lsid, account: acc, accountId: acc.id }
    }
  }
  const creds = getJson('credentials.json')
  return { sess: creds.sessdata, jct: creds.bili_jct || creds.biliJct, buvid: creds.buvid3, buvid4: creds.buvid4, buvidFp: creds.buvid_fp, bLsid: creds.b_lsid, accountId: null }
}

function biliReqHeaders(forceAccountId) {
  let sess, jct, buvid, buvid4, buvidFp, bLsid
  let src = 'accounts'
  if (forceAccountId) {
    const a = getJson('accounts.json')
    const acc = (a.accounts || []).find(x => x.id === forceAccountId)
    if (acc) {
      sess = acc.sessdata; jct = acc.bili_jct || acc.biliJct; buvid = acc.buvid3; buvid4 = acc.buvid4; buvidFp = acc.buvid_fp; bLsid = acc.b_lsid
    }
  } else {
    const c = getActiveAccountCreds()
    sess = c.sess; jct = c.jct; buvid = c.buvid; buvid4 = c.buvid4; buvidFp = c.buvidFp; bLsid = c.bLsid
    if (!c.sess) src = 'credentials'
  }
  if (!sess || !jct) return null
  const cookieParts = [`SESSDATA=${sess}`, `bili_jct=${jct}`]
  if (buvid) cookieParts.push(`buvid3=${buvid}`)
  if (buvid4) cookieParts.push(`buvid4=${buvid4}`)
  if (bLsid) cookieParts.push(`b_lsid=${bLsid}`)
  if (buvidFp) cookieParts.push(`buvid_fp=${buvidFp}`)
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referer: 'https://space.bilibili.com/',
    cookie: cookieParts.join('; '),
  }
}

async function biliSelf(res) {
  const H = biliReqHeaders()
  if (!H) return send(res, 401, JSON.stringify({ error: 'B 站 Cookie 未配置' }))
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: H })
    const j = await r.json()
    if (j?.code !== 0) return send(res, 200, JSON.stringify({ error: `code=${j?.code} ${j?.message || ''}` }))
    const d = j.data
    return send(res, 200, JSON.stringify({
      mid: d.mid,
      name: d.uname,
      face: d.face,
      level: d.level_info?.current_level || 0,
      following: d.following || 0,
      follower: d.follower || 0,
      sign: d.sign || '',
    }))
  } catch (e) {
    return send(res, 200, JSON.stringify({ error: String(e.message) }))
  }
}

async function biliFollowings(res, pn, ps) {
  const H = biliReqHeaders()
  if (!H) return send(res, 401, JSON.stringify({ error: 'B 站 Cookie 未配置' }))
  try {
    const myR = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: H })
    const myJ = await myR.json()
    const myMid = myJ?.data?.mid
    if (!myMid) return send(res, 200, JSON.stringify({ error: `无法获取自身 UID` }))

    const r = await fetch(`https://api.bilibili.com/x/relation/followings?vmid=${myMid}&pn=${pn}&ps=${ps}&order=desc`, { headers: H })
    const j = await r.json()
    if (j?.code !== 0) return send(res, 200, JSON.stringify({ error: `code=${j?.code} ${j?.message || ''}` }))
    const list = (j?.data?.list || []).map(u => ({
      mid: u.mid,
      name: u.uname,
      face: u.face,
      sign: u.sign || '',
      official: u.official?.title || '',
      fans: u.fans || 0,
      live: u.live_status ? { status: u.live_status, title: u.live_title || '', cover: u.live_cover || '' } : null,
    }))
    return send(res, 200, JSON.stringify({
      total: j?.data?.total || 0,
      pn, ps,
      list,
    }))
  } catch (e) {
    return send(res, 200, JSON.stringify({ error: String(e.message) }))
  }
}

async function biliUpInfo(res, mid) {
  const H = biliReqHeaders()
  if (!H) return send(res, 401, JSON.stringify({ error: 'B 站 Cookie 未配置' }))
  try {
    const r = await fetch(`https://api.bilibili.com/x/space/wbi/acc/info?mid=${mid}`, { headers: H })
    const j = await r.json()
    if (j?.code !== 0) return send(res, 200, JSON.stringify({ error: `code=${j?.code} ${j?.message || ''}` }))
    const d = j.data
    return send(res, 200, JSON.stringify({
      mid: d.mid,
      name: d.name,
      face: d.face,
      sign: d.sign || '',
      official: d.official?.title || '',
      level: d.level || 0,
      follower: d.follower || 0,
      following: d.following || 0,
    }))
  } catch (e) {
    return send(res, 200, JSON.stringify({ error: String(e.message) }))
  }
}

async function biliModifyRelation(res, fid, act) {
  const creds = getJson('credentials.json')
  const jct = creds.bili_jct || creds.biliJct
  const sess = creds.sessdata
  const buvid = creds.buvid3
  if (!sess || !jct) return send(res, 401, JSON.stringify({ error: 'B 站 Cookie 未配置' }))
  const H = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referer: `https://space.bilibili.com/${fid}`,
    cookie: `SESSDATA=${sess}; bili_jct=${jct}; buvid3=${buvid}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  const body = `fid=${fid}&act=${act}&re_src=11&csrf=${jct}`
  try {
    const r = await fetch('https://api.bilibili.com/x/relation/modify', { method: 'POST', headers: H, body })
    const j = await r.json()
    if (j?.code !== 0) return send(res, 200, JSON.stringify({ ok: false, error: `code=${j?.code} ${j?.message || ''}` }))
    return send(res, 200, JSON.stringify({ ok: true, action: act === 1 ? 'followed' : 'unfollowed', mid: fid }))
  } catch (e) {
    return send(res, 200, JSON.stringify({ ok: false, error: String(e.message) }))
  }
}

function extractCookie(cookieStr, name) {
  const m = cookieStr.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

function extractBv(uri) {
  if (!uri) return ''
  const m = String(uri).match(/BV[0-9A-Za-z]+/)
  return m ? m[0] : ''
}

const AT_PROCESSED_FILE = PATHS.atProcessedFile

function loadAtProcessed() {
  try {
    const raw = fs.readFileSync(AT_PROCESSED_FILE, 'utf8')
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveAtProcessed(id) {
  try {
    const s = loadAtProcessed()
    s.add(String(id))
    fs.mkdirSync(path.dirname(AT_PROCESSED_FILE), { recursive: true })
    fs.writeFileSync(AT_PROCESSED_FILE, JSON.stringify(Array.from(s), null, 2))
  } catch {}
}

async function checkAlreadyReplied(H, aid, rootId, sourceId, myMid) {
  if (!aid || !myMid) return false
  try {
    const root = sourceId && Number(sourceId) > 0 ? Number(sourceId)
               : rootId && Number(rootId) > 0 ? Number(rootId)
               : Number(aid)
    const r = await fetch(`https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${root}`, { headers: H })
    const j = await r.json()
    if (j.code !== 0) return false
    const replies = j.data?.replies || []
    return replies.some(c => String(c.member?.mid) === String(myMid))
  } catch {
    return false
  }
}

async function generateAtReply(creds, cfg, nickname, content, bvid) {
  const ownerName = cfg.bili?.ownerName || '主人'
  const sys = `你是${ownerName}的B站分身，现在主人在B站@了你，说了：「${content}」。请你用主人分身的身份，写一句简短、自然、贴合语境的回复。要求：15-50字，口语化，像真人在B站评论区的回复，可以带emoji但不要太多，不要开头加"主人好"之类的称呼。直接输出回复文本，不要任何其他内容。`
  try {
    const j = await doubaoHttps({ messages: [
          { role: 'system', content: sys },
        ], max_tokens: 200 }, creds.doubaoApiKey, creds.doubaoEndpointId)
    const text = (j?.choices?.[0]?.message?.content || '').trim()
    if (text) return text.replace(/^["「『]|["」』]$/g, '').trim()
  } catch (e) {
    console.log('[doubao]', e?.message || e)
  }
  const fallbacks = [
    '收到收到！这条我记下啦～',
    '哈哈懂你意思了，稍后看一下～',
    '好的好的，让我看看这条内容~',
    '嗯嗯，我回头去看看！',
    'Get到了，马上安排～',
  ]
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]
}

function runDaily(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const child = spawn('node', ['src/run-daily.mjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: spawnEnv(),
  })
  _agentChild = child

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  sendEvent({ type: 'start', time: new Date().toISOString() })

  child.stdout.on('data', (buf) => {
    const lines = buf.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      sendEvent({ type: 'stdout', text: line })
    }
  })

  child.stderr.on('data', (buf) => {
    sendEvent({ type: 'stderr', text: buf.toString() })
  })

  child.on('close', (code) => {
    _agentChild = null
    sendEvent({ type: 'done', code, time: new Date().toISOString() })
    res.end()
  })

  child.on('error', (err) => {
    sendEvent({ type: 'error', text: err.message })
    res.end()
  })

  req.on('close', () => {
    if (!child.killed) child.kill()
  })
}

function runTool(res, args) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  const child = spawn('node', ['tools/bili.mjs', ...args], {
    cwd: path.resolve(__dirname, '..'),
    env: spawnEnv(),
  })
  child.stdout.on('data', (b) => res.write(b))
  child.stderr.on('data', (b) => res.write(b))
  child.on('close', () => res.end())
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  api(req, res, url.pathname).catch(err => {
    send(res, 500, JSON.stringify({ error: err.message }))
  })
})

const shutdown = () => {
  console.log(`\n🛑 收到退出信号，正在清理...`)
  cleanupAll()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(PORT, () => {
  console.log(`\n🌐 doubao-bot v${VERSION}  running at http://localhost:${PORT}`)
  console.log(`   Dashboard:   http://localhost:${PORT}/`)
  console.log(`   Port: ${PORT}  (set PORT env var to change)\n`)
  startScheduler()
  startFollowWatcher()
})