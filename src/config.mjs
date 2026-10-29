import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

function scanUserDirs() {
  const dirs = []
  const drive = process.platform === 'win32' ? path.parse(process.cwd()).root : '/'
  if (process.platform === 'win32') {
    const usersRoots = ['C:\\Users', 'D:\\Users', 'E:\\Users', 'C:\\Documents and Settings']
    for (const root of usersRoots) {
      try {
        if (fs.existsSync(root)) {
          for (const name of fs.readdirSync(root)) {
            if (name === 'Public' || name === 'Default' || name === 'Default User' || name === 'All Users') continue
            const p = path.join(root, name)
            try { if (fs.statSync(p).isDirectory()) dirs.push(p) } catch {}
          }
        }
      } catch {}
    }
    dirs.push('C:\\root', 'D:\\root')
  } else {
    dirs.push('/root')
    try {
      if (fs.existsSync('/home')) {
        for (const name of fs.readdirSync('/home')) {
          const p = path.join('/home', name)
          try { if (fs.statSync(p).isDirectory()) dirs.push(p) } catch {}
        }
      }
    } catch {}
  }
  return dirs
}

function resolveHome() {
  const envHome = process.env.USERPROFILE || process.env.HOME
  const allHomes = []
  if (envHome) allHomes.push(envHome)
  try { allHomes.push(os.homedir()) } catch {}
  allHomes.push(...scanUserDirs())

  for (const h of allHomes) {
    if (!h) continue
    try {
      const hasCred = fs.existsSync(path.join(h, '.doubao-bot', 'credentials.json')) ||
                     fs.existsSync(path.join(h, '.bili-ai', 'credentials.json'))
      if (hasCred) {
        if (envHome !== h) {
          process.env.USERPROFILE = h
          process.env.HOME = h
        }
        return h
      }
    } catch {}
  }

  for (const h of allHomes) {
    if (h) { try { if (fs.existsSync(h)) return h } catch {} }
  }
  return process.cwd()
}

const REAL_HOME = resolveHome()

function findDir(relPaths) {
  const scanHomes = [REAL_HOME, ...scanUserDirs()]
  const candidates = []
  for (const h of scanHomes) {
    if (!h) continue
    for (const rp of relPaths) candidates.push(path.join(h, rp))
  }
  candidates.push(path.join(process.cwd(), '.doubao-bot'))

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir
    } catch {}
  }
  return path.join(REAL_HOME, relPaths[0])
}

const DATA_DIR = findDir(['.doubao-bot'])
const BILI_AI_DIR = findDir(['.bili-ai'])
const DSH_DIR = (() => {
  for (const h of [REAL_HOME, ...scanUserDirs()]) {
    if (!h) continue
    const p = path.join(h, '.dsh')
    try { if (fs.existsSync(p)) return p } catch {}
    const wl = path.join(p, 'whale-log.jsonl')
    try { if (fs.existsSync(wl)) return p } catch {}
  }
  return path.join(REAL_HOME, '.dsh')
})()
const CRED_FILE = path.join(DATA_DIR, 'credentials.json')
const CFG_FILE = path.join(DATA_DIR, 'config.json')
const BILI_AI_CRED = path.join(BILI_AI_DIR, 'credentials.json')
const WHALE_LOG = path.join(DSH_DIR, 'whale-log.jsonl')
const AT_PROCESSED = path.join(DATA_DIR, 'at-processed.json')

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n')
}

export const PATHS = {
  realHome: REAL_HOME,
  credFile: CRED_FILE,
  configFile: CFG_FILE,
  dataDir: DATA_DIR,
  biliAiDir: BILI_AI_DIR,
  biliAiCredFile: BILI_AI_CRED,
  dshDir: DSH_DIR,
  whaleLogFile: WHALE_LOG,
  atProcessedFile: AT_PROCESSED,
  toolsDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools'),
}

const DEFAULT_CONFIG = {
  doubao: {
    apiKey: '',
    endpointId: '',
    model: 'doubao-lite-32k',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  bili: {
    sessdata: '',
    biliJct: '',
    buvid3: '',
    selfMid: '',
    selfName: '',
    ownerMid: '',
    ownerName: '',
  },
  budget: {
    dailyTokens: 30000,
    modelFallback: 'doubao-lite-32k',
  },
  night: {
    windows: [{ start: '20:00', end: '24:00', wakes: 1 }],
    skipChance: 0.3,
    maxVideos: 5,
  },
  preferences: {
    like: ['AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
  },
  quota: { shareDaily: 3 },
}

export function getCredentials() {
  const main = readJson(CRED_FILE) || {}
  const biliAi = readJson(BILI_AI_CRED) || {}
  return {
    ...main,
    sessdata: main.sessdata || biliAi.sessdata || '',
    biliJct: main.biliJct || biliAi.biliJct || biliAi.bili_jct || '',
    buvid3: main.buvid3 || biliAi.buvid3 || '',
  }
}

export function getConfig() {
  const cred = getCredentials()
  const cfg = readJson(CFG_FILE) || {}
  const merged = deepMerge(DEFAULT_CONFIG, cfg)
  if (cred.doubaoApiKey) merged.doubao.apiKey = cred.doubaoApiKey
  if (cred.doubaoEndpointId) merged.doubao.endpointId = cred.doubaoEndpointId
  if (cred.sessdata) merged.bili.sessdata = cred.sessdata
  if (cred.biliJct) merged.bili.biliJct = cred.biliJct
  if (cred.buvid3) merged.bili.buvid3 = cred.buvid3
  return merged
}

export function saveCredentials(cred) {
  writeJson(CRED_FILE, cred)
}

export function saveConfig(cfg) {
  writeJson(CFG_FILE, cfg)
}

function deepMerge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(base[k] ?? {}, v) : v
  }
  return out
}