import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBangumi, parseSeasonId } from '../tools/commands/bangumi.mjs'
import { pickMeme, uploadMeme, sendCommentDirect } from '../tools/lib/at-reply.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BILI_MJS = path.join(ROOT, 'tools', 'bili.mjs')

function runBili(args) {
  const result = spawnSync(process.execPath, [BILI_MJS, ...args], {
    encoding: 'utf8', timeout: 120_000, cwd: ROOT, env: process.env,
  })
  const out = String(result.stdout || '').trim()
  const err = String(result.stderr || '').trim()
  return { code: result.status ?? 1, out, err }
}

function bvToAid(bv) {
  const r = spawnSync(process.execPath, ['-e', `
    fetch('https://api.bilibili.com/x/web-interface/view?bvid=${bv}')
      .then(r=>r.json())
      .then(j=>{console.log(j?.data?.aid || '')})
      .catch(()=>{})
  `], { encoding: 'utf8', timeout: 30_000 })
  return String(r.stdout || '').trim()
}

async function expandMessage(template, vars) {
  let msg = template
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v || ''))
  }
  return msg
}

async function main() {
  const raw = process.argv[2]
  let task
  try { task = JSON.parse(raw) } catch {
    console.error('direct-runner 需要一个 JSON task 参数')
    process.exit(1)
  }

  console.log(`\n🚀 === 纯脚本直达模式（0 token）===`)
  console.log(`   任务: ${task.name}`)
  console.log(`   目标: ${task.targetUrl || '(无)'}`)

  let bv = ''
  let bangumiInfo = null

  const ps = parseSeasonId(task.targetUrl)
  if (ps) {
    console.log(`   🔗 检测到番剧 ${ps.type}=${ps.id}，解析最新正片...`)
    const r = await resolveBangumi(task.targetUrl)
    if (!r.ok) {
      console.error(`   ❌ 番剧解析失败: ${r.error}`)
      process.exit(1)
    }
    bv = r.latest.bvid
    bangumiInfo = r
    console.log(`   ✅ 《${r.title}》第${r.latest.index || r.latest.title || '?'}集 → ${bv}`)
  } else if (task.targetUrl) {
    const bvMatch = task.targetUrl.match(/(BV[\w]+)/)
    if (bvMatch) {
      bv = bvMatch[1]
      console.log(`   ✅ 从链接提取 BV: ${bv}`)
    } else {
      console.error(`   ❌ 无法从链接提取 BV 号: ${task.targetUrl}`)
      process.exit(1)
    }
  } else {
    console.error(`   ❌ 任务没有 targetUrl`)
    process.exit(1)
  }

  const aid = bvToAid(bv)
  if (!aid) {
    console.error(`   ❌ BV ${bv} 查不到 aid`)
    process.exit(1)
  }
  console.log(`   📌 aid=${aid}`)

  const vars = {
    bv,
    aid,
    title: bangumiInfo?.title || '',
    index: bangumiInfo?.latest?.index || bangumiInfo?.latest?.title || '',
    date: bangumiInfo?.latest?.pub_date || new Date().toLocaleDateString('sv-SE'),
    owner: task.ownerRef || '',
    ownerBV: task.ownerRef || '',
  }
  let message = await expandMessage(task.template || '前排占位~', vars)
  if (task.ownerRef && !message.includes('@') && !message.includes(task.ownerRef)) {
    message = message + ` @${task.ownerRef} 来看呀`
  }
  message = message.replace(/"/g, '「').slice(0, 900)

  console.log(`\n   📝 评论内容: ${message.slice(0, 120)}${message.length > 120 ? '...' : ''}`)

  let pictures = null
  let memeName = ''
  try {
    const meme = pickMeme((task._title || '') + ' ' + message, message)
    const pic = await uploadMeme(meme.file)
    if (pic?.img_src) {
      pictures = pic
      memeName = meme.name
      console.log(`   🎨 匹配表情: ${meme.name} (${meme.file}) → 已上传图床`)
    }
  } catch (e) {
    console.log(`   🎨 表情上传失败，降级纯文字：${String(e.message).slice(0, 80)}`)
  }

  let result
  if (pictures) {
    console.log(`   📤 带图发送中...`)
    const j = await sendCommentDirect({ aid, bvid: bv, message, pictures })
    const code = j?.code ?? -1
    const msg = j?.message ?? ''
    if (code === 0) {
      const rpid = j?.data?.rpid_str ?? j?.data?.rpid
      const vs = j._verifiedState ?? null
      const fake = !!j._fakeSuccess
      console.log(`   ✅ 带图发送成功！rpid=${rpid} state=${vs ?? '?'} [${memeName}] 0 token 消耗`)
      const outParts = [`code=0`, `rpid=${rpid}`, `meme=${memeName}`]
      if (vs !== null) outParts.push(`[state-check] state=${vs}`)
      result = { code: 0, out: outParts.join('\n'), err: '' }
      if (fake) result.code = 7
    } else {
      console.log(`   ⚠️ 带图被拒(${code}: ${msg})，降级纯文字...`)
      result = runBili(['comment', '--oid', aid, '--bvid', bv, '--message', message, '--go', '--auto'])
    }
  } else {
    console.log(`   📤 纯文字发送中...`)
    result = runBili(['comment', '--oid', aid, '--bvid', bv, '--message', message, '--go', '--auto'])
  }
  console.log(result.out.split('\n').map(l => '   ' + l).join('\n'))
  if (result.err) console.log(result.err.split('\n').map(l => '   ERR: ' + l).join('\n'))

  if (result.code !== 0 && result.code !== 7) {
    console.error(`\n   ❌ 发送失败（exit ${result.code}）`)
    process.exit(result.code)
  } else if (result.code === 7) {
    console.error(`\n   ⚠️ 评论被风控/假成功（exit 7）`)
    process.exit(7)
  }
}

main().catch(e => {
  console.error('   💥 异常:', e.message)
  process.exit(1)
})