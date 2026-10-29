import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { PATHS } from './config.mjs'

const REAL_USER_HOMEDIR = PATHS.realHome

function spawnEnv() {
  const env = { ...process.env }
  if (process.env.USERPROFILE !== REAL_USER_HOMEDIR) {
    env.USERPROFILE = REAL_USER_HOMEDIR
    env.HOME = REAL_USER_HOMEDIR
  }
  return env
}

const DATA_DIR = PATHS.dataDir
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const STATE_FILE = path.join(DATA_DIR, 'scheduler-state.json')
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json')
const CREDS_FILE = PATHS.credFile

const BILI_FIELDS = ['sessdata', 'bili_jct', 'buvid3', 'buvid4', 'buvid_fp', 'b_lsid']

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) } catch { return { accounts: [], defaultId: null, activeId: null } }
}
function writeAccounts(a) { writeJson(ACCOUNTS_FILE, a) }

function applyAccount(account) {
  if (!fs.existsSync(CREDS_FILE)) return false
  const creds = readJson(CREDS_FILE, {})
  let changed = false
  for (const f of BILI_FIELDS) {
    if (account[f] !== undefined && account[f] !== creds[f]) {
      creds[f] = account[f]
      changed = true
    }
  }
  if (account.sessdata && creds.sessdata !== account.sessdata) { creds.sessdata = account.sessdata; changed = true }
  if (account.bili_jct && creds.bili_jct !== account.bili_jct) { creds.bili_jct = account.bili_jct; creds.biliJct = account.bili_jct; changed = true }
  if (changed) { writeJson(CREDS_FILE, creds) }
  return changed
}

export function switchToAccount(accountId) {
  const a = readAccounts()
  const acc = a.accounts.find(x => x.id === accountId)
  if (!acc) { console.error(`[accounts] 找不到账号: ${accountId}`); return false }
  const changed = applyAccount(acc)
  a.activeId = accountId
  writeAccounts(a)
  console.log(`🔑 切换账号 → ${acc.label || acc.id}${changed ? '（已更新 credentials.json）' : '（已在当前活跃）'}`)
  return true
}

export function restoreDefaultAccount() {
  const a = readAccounts()
  if (!a.defaultId) return false
  const acc = a.accounts.find(x => x.id === a.defaultId)
  if (!acc) return false
  const changed = applyAccount(acc)
  a.activeId = a.defaultId
  writeAccounts(a)
  console.log(`🔑 恢复默认账号 → ${acc.label || acc.id}${changed ? '（已更新 credentials.json）' : '（已在当前活跃）'}`)
  return true
}

export function getActiveAccount() {
  const a = readAccounts()
  if (!a.activeId && a.defaultId) return a.defaultId
  return a.activeId || null
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n')
  } catch {}
}

export function getTasks() {
  const list = readJson(TASKS_FILE, [])
  if (!Array.isArray(list)) return []
  return list.filter(t => t && t.enabled !== false)
}
export function setTasks(list) { writeJson(TASKS_FILE, list) }

export function getState() { return readJson(STATE_FILE, {}) }
export function setState(s) { writeJson(STATE_FILE, s) }

function todayStr() { return new Date().toLocaleDateString('sv-SE') }
function dayOfWeek() { return new Date().getDay() }
function nowHHMM() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function parseHHMM(s) {
  const [h, m] = String(s).split(':').map(Number)
  return h * 60 + (m || 0)
}
function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

export function checkTasks() {
  const tasks = getTasks()
  const state = getState()
  const today = todayStr()
  const dow = dayOfWeek()
  const cur = nowMinutes()
  const triggered = []

  for (const t of tasks) {
    if (t.enabled === false) continue
    if (Array.isArray(t.day) && t.day.length > 0 && !t.day.includes(dow)) continue
    if (typeof t.day === 'number' && t.day !== dow) continue
    const trigger = parseHHMM(t.time) - (Number(t.leadMin) || 0)
    if (cur < trigger) continue
    const key = t.id || t.name
    if (state[key] && state[key].date === today) continue
    triggered.push(t)
  }

  return triggered
}

export function markDone(taskId) {
  const state = getState()
  state[taskId] = { date: todayStr(), time: nowHHMM(), status: 'done' }
  setState(state)
}

export function markFail(taskId, err) {
  const state = getState()
  state[taskId] = { date: todayStr(), time: nowHHMM(), status: 'fail', error: String(err || '').slice(0, 200) }
  setState(state)
}

function _runOneSpawn(scriptPath, args, logTag) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: spawnEnv(),
    })
    let out = '', err = ''
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(`[${logTag}] ${d}`) })
    proc.stderr.on('data', d => { err += d.toString(); process.stderr.write(`[${logTag}] ERR ${d}`) })
    proc.on('close', (code) => resolve({ code, out, err }))
    proc.on('error', (e) => resolve({ code: -1, err: String(e.message) }))
  })
}

async function _waitUntilHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  const target = new Date()
  target.setHours(h, m, 0, 0)
  if (target < new Date()) {
    const tomorrow = new Date(target.getTime() + 86400_000)
    tomorrow.setHours(h, m, 0, 0)
    return new Promise(resolve => {
      const tick = () => { if (new Date() >= tomorrow) resolve(); else setTimeout(tick, 15_000) }
      tick()
    })
  }
  return new Promise(resolve => {
    const tick = () => { if (new Date() >= target) resolve(); else setTimeout(tick, 15_000) }
    tick()
  })
}

async function _runStage(stageTask, stageLabel) {
  if (stageTask.type === 'script') {
    const scriptPath = path.isAbsolute(stageTask.script) ? stageTask.script : path.join(process.cwd(), stageTask.script || '')
    const args = String(stageTask.args || '').split(/\s+/).filter(Boolean)
    console.log(`📜 ${stageLabel} → ${scriptPath} ${args.join(' ')}`)
    return _runOneSpawn(scriptPath, [scriptPath, ...args], `script ${stageLabel}`)
  }

  const hasTemplate = !!(stageTask.template && String(stageTask.template).trim())
  const script = path.join(process.cwd(), 'src', hasTemplate ? 'run-task-direct.mjs' : 'run-task.mjs')
  if (hasTemplate) stageTask._direct = true

  return _runOneSpawn(script, [script, JSON.stringify(stageTask)], `task ${stageLabel}`)
}

export async function runTask(task) {
  const taskKey = task.id || task.name
  const stages = (Array.isArray(task.stages) && task.stages.length > 0) ? task.stages : [null]

  const hadAccountSwitch = !!task.accountId && getActiveAccount() !== task.accountId
  const restoreTo = task.recoveryAccountId || null
  const results = []

  try {
    if (hadAccountSwitch) {
      console.log(`🎯 任务 [${task.name}] 指定账号 ${task.accountId}，先切换...`)
      switchToAccount(task.accountId)
    }

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]
      const stageLabel = stages.length > 1
        ? `${task.name} · 阶段${i + 1}${stage?.name ? ' [' + stage.name + ']' : ''}`
        : task.name

      let stageTask = { ...task }
      if (stage) {
        stageTask = { ...task, ...stage }
        if (stage.trigger && /^\d{1,2}:\d{2}$/.test(stage.trigger)) {
          console.log(`⏳ ${stageLabel} 等待 ${stage.trigger} ...`)
          await _waitUntilHHMM(stage.trigger)
        }
        if (stage.accountId && stage.accountId !== getActiveAccount()) {
          switchToAccount(stage.accountId)
        }
      }

      if (hadAccountSwitch) {
        console.log(`🎯 执行 ${stageLabel} (账号=${getActiveAccount()})`)
      }

      const result = await _runStage(stageTask, stageLabel)
      results.push({ stage: i, code: result.code })

      if (result.code !== 0) {
        console.error(`❌ ${stageLabel} 失败 (exit ${result.code})`)
        markFail(taskKey, `${stageLabel} exit ${result.code}`)
        return { code: result.code, results }
      }
    }

    markDone(taskKey)
    console.log(`✅ 任务 [${task.name}] 全部阶段完成`)
    return { code: 0, results }
  } catch (e) {
    markFail(taskKey, e.message)
    console.error(`💥 任务 [${task.name}] 异常:`, e.message)
    return { code: -1, error: e.message, results }
  } finally {
    if (hadAccountSwitch || restoreTo) {
      const target = restoreTo || readAccounts().defaultId
      if (target && getActiveAccount() !== target) {
        console.log(`🔄 任务结束，恢复账号 → ${target}`)
        restoreDefaultAccount()
      }
    }
  }
}

let running = false
let followProc = null

export function startScheduler() {
  if (running) return
  running = true
  console.log(`⏰ 定时调度器启动（每 60s 扫一次任务表）`)
  setInterval(async () => {
    if (runTask._active) return
    const tasks = checkTasks()
    if (tasks.length === 0) return
    runTask._active = true
    try {
      for (const t of tasks) {
        console.log(`🎯 触发任务: ${t.name} @ ${nowHHMM()}`)
        await runTask(t)
      }
    } finally {
      runTask._active = false
    }
  }, 60 * 1000)
}

export function startFollowWatcher() {
  if (followProc) {
    console.log(`🎬 关注守望已在运行（pid ${followProc.pid}）`)
    return
  }
  const config = getJson('follow-config.json')
  if (!config.enabled) {
    console.log(`🎬 关注守望未启用（设置 follow-config.json 的 enabled=true）`)
    return
  }

  const interval = Math.max(180, Number(config.interval || 300))
  const onlyWl = config.onlyWhitelist ? '--only-whitelist' : ''
  const noCmt = config.noComment ? '--no-comment' : ''
  const script = path.join(process.cwd(), 'src', 'follow-await.mjs')

  console.log(`🎬 启动关注列表守望（每 ${interval}s 扫一次${onlyWl ? ' · 仅白名单' : ''}${noCmt ? ' · 养号模式(无评论)' : ''}）`)

  function launch() {
    const args = [script, '--interval', String(interval), onlyWl, noCmt].filter(Boolean)
    const p = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv(),
    })
    p.stdout.on('data', d => process.stdout.write(d.toString()))
    p.stderr.on('data', d => process.stderr.write(d.toString()))
    p.on('close', (code) => {
      console.log(`🎬 守望进程退出（code=${code}），5 秒后重启...`)
      followProc = null
      setTimeout(launch, 5000)
    })
    p.on('error', (e) => {
      console.error(`🎬 守望进程启动失败: ${e.message}`)
      followProc = null
      setTimeout(launch, 15000)
    })
    followProc = p
  }

  launch()
}

export function stopFollowWatcher() {
  if (followProc) {
    followProc.kill('SIGTERM')
    followProc = null
    console.log(`🎬 已停止关注守望`)
  }
}

export function getFollowStatus() {
  return {
    running: !!followProc,
    pid: followProc?.pid || null,
  }
}

export function cleanupAll() {
  try { stopFollowWatcher() } catch {}
  if (typeof _agentChild !== 'undefined' && _agentChild) {
    try { _agentChild.kill('SIGTERM') } catch {}
    _agentChild = null
  }
  console.log(`\n🧹 已清理所有子进程`)
}

function getJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(
    path.join(os.homedir(), '.doubao-bot'), name
  ), 'utf8')) } catch { return {} }
}

export function getNextRun(task) {
  const state = getState()
  const key = task.id || task.name
  const todayDone = state[key]?.date === todayStr()
  if (todayDone) return null
  const trigger = parseHHMM(task.time) - (Number(task.leadMin) || 0)
  const cur = nowMinutes()
  if (trigger > cur) {
    const h = Math.floor(trigger / 60)
    const m = trigger % 60
    return `今天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  }
  return null
}

let _syncProc = null
export function spawnFollowSync(dailyLimit = 20) {
  if (_syncProc) { console.log('sync already running'); return false }
  const script = path.join(process.cwd(), 'tools', 'commands', 'follow-sync.mjs')
  const args = [script, '--go', '--daily', String(dailyLimit)]
  const p = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() })
  p.stdout.on('data', d => process.stdout.write(d.toString()))
  p.stderr.on('data', d => process.stderr.write(d.toString()))
  p.on('close', code => { console.log('sync exit code=' + code); _syncProc = null })
  _syncProc = p
  console.log('follow-sync spawned pid=' + p.pid)
  return true
}
export function getSyncStatus() { return { running: !!_syncProc, pid: _syncProc?.pid || null } }