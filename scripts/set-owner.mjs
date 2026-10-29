import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const p = path.join(os.homedir(), '.doubao-bot', 'config.json')
let cfg = JSON.parse(fs.readFileSync(p, 'utf8'))

// TODO: 替换为你自己的 B 站主账号 UID 和昵称
cfg.bili.ownerMid = '你的主账号UID'
cfg.bili.ownerName = '你的主账号昵称'

fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n')
console.log('✅ 主人信息已同步')
console.log('   ownerName:', cfg.bili.ownerName)
console.log('   ownerMid:', cfg.bili.ownerMid)