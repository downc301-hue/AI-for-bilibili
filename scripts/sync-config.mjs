import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const p = path.join(os.homedir(), '.doubao-bot', 'config.json')
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')) } catch {}

cfg.bili = cfg.bili || {}
// TODO: 替换为你自己的 B 站小号 UID 和昵称
cfg.bili.selfMid = '你的小号UID'
cfg.bili.selfName = '你的小号昵称'

fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n')
console.log('✅ config.json 已更新')
console.log('   selfName:', cfg.bili.selfName)
console.log('   selfMid:', cfg.bili.selfMid)