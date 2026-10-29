import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PATHS } from './config.mjs'
import { chat } from './doubao-client.mjs'

process.on('unhandledRejection', (err) => { console.error('[ERR] unhandledRejection:', err?.message || err) })
process.on('uncaughtException', (err) => { console.error('[ERR] uncaughtException:', err?.message || err) })

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
const CRED_FILE = PATHS.credFile
const MAIN_CFG = PATHS.configFile
const cred = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
const mainCfg = JSON.parse(fs.readFileSync(MAIN_CFG, 'utf8'))

const OWNER_MID = String(mainCfg.bili?.ownerMid || '')
const OWNER_NAME = mainCfg.bili?.ownerName || 'owner'
const SELF_MID = String(mainCfg.bili?.selfMid || '')
const AI_COMMENT_PROB = Number(mainCfg.bili?.aiCommentProb ?? 0.3)

const KAOMOJI_POOL = [
  '(◕ᴗ◕✿)', '(๑˃̵ᴗ˂̵)', '(✿◠‿◠)', '(๑ ๑)ﾉ',
  '(ᕑᗢᓫᕑ)', '(╬ ಠ益ಠ)', '( ･᷄ὢ･᷅ )',
  '(๑ˉ∀ˉ๑)', '✧*｡٩(ˊᗜˋ*)و✧*｡',
  '(╥﹏╥)', "(´•ω•)ノ",
  '👀', '( ͡° ͜ʖ ͡°)',
  '(๑•̀ㅂ•́)و✧', '👍',
  '(≧∇≦)ﾉ', '(✺ω✺)', 'Σ(°Д°;)',
  '(⊙ω⊙)', '(๑•̀ㅂ•́)و✧', '😈',
  '(✧ω✧)', '(◕‿◕)', '(๑◕‿◕)',
  '(づ｡◕‿‿◕｡)づ', '(ง •̀_•́)ง',
]

function pickKaomoji() {
  return KAOMOJI_POOL[Math.floor(Math.random() * KAOMOJI_POOL.length)]
}

const sessdata = decodeURIComponent(cred.sessdata || '')
const bili_jct = cred.bili_jct || cred.biliJct || ''
const buvid3 = cred.buvid3 || ''
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const cookieHeader = `SESSDATA=${sessdata}; bili_jct=${bili_jct}; buvid3=${buvid3}`
const H = { 'user-agent': UA, referer: 'https://space.bilibili.com/', cookie: cookieHeader }

const args = process.argv.slice(2)
const get = (k, d) => {
  const i = args.indexOf('--' + k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const INTERVAL = Math.max(180, Number(get('interval', '300')))
const QUIET = args.includes('--quiet')
const ONLY_WHITELIST = args.includes('--only-whitelist')
const DRY_RUN = args.includes('--dry')
const NO_COMMENT = args.includes('--no-comment')

const DANMU_TEMPLATES = [
  '哈哈哈哈哈哈',
  '笑死我了',
  '前方高能！',
  '有意思~',
  '牛啊牛啊',
  '学到了学到了',
  '哈哈 可以的',
  '这波不错',
  '666',
  '种草了',
  '有意思有意思',
  '确实确实',
  '哈哈笑死',
  '这挺好的',
  '学到了~',
]

const PROCESSED_FILE = path.join(DATA_DIR, 'follow-processed.json')
const CONFIG_FILE = path.join(DATA_DIR, 'follow-config.json')
const COMMENT_GUARD_FILE = path.join(DATA_DIR, 'comment-guard.json')

function getToday() { return new Date().toISOString().slice(0, 10) }

function readGuard() {
  const g = readJson(COMMENT_GUARD_FILE, {})
  if (g.date !== getToday()) {
    const prevBlocked = g.blocked === true
    const prevDate = g.date || '?'
    g.date = getToday()
    g.attempts = 0
    g.success = false
    g.blocked = false
    if (prevBlocked) {
      console.log(`\n   [guard] 昨日(${prevDate})评论被风控熔断，今日恢复探活`)
    }
    writeJson(COMMENT_GUARD_FILE, g)
  }
  return g
}

function writeGuard(patch) {
  const g = readGuard()
  Object.assign(g, patch)
  writeJson(COMMENT_GUARD_FILE, g)
  return g
}

function canComment() {
  const g = readGuard()
  if (g.blocked) {
    console.log(`   [GUARD] 今日评论已熔断，跳过（被控 ${g.attempts} 次）`)
    return false
  }
  return true
}

function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
function writeJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n')
  } catch {}
}

let whaleLogPath = null
function getWhaleLogPath() {
  if (whaleLogPath) return whaleLogPath
  try {
    fs.mkdirSync(path.dirname(PATHS.whaleLogFile), { recursive: true })
  } catch {}
  whaleLogPath = PATHS.whaleLogFile
  return whaleLogPath
}
function writeWhaleLog(entry) {
  try {
    const p = getWhaleLogPath()
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'
    fs.appendFileSync(p, line)
  } catch {}
}

const processed = new Set(readJson(PROCESSED_FILE, []))
const config = readJson(CONFIG_FILE, {})
const whitelist = new Set((config.whitelist || []).map(String))
const blacklist = new Set((config.blacklist || []).map(String))
const minAgeSec = Number(config.minAgeSec || 0)

const KEYWORD_TEMPLATES = [
  { kw: ['AI', '人工智能', 'AGI', '大模型', 'LLM', 'Claude', 'GPT', '豆包', 'Deepseek', '智能体', 'agent'],
    tpl: [
      `AI 这条线玩明白了！@${OWNER_NAME} 支持支持~`,
      `AI 真的是 @${OWNER_NAME} 的主战场，赞了！`,
      `工具收藏了，回头试试，@${OWNER_NAME} 出品必属精品`,
      `终于有人做 AI 运营账号了！@${OWNER_NAME} 快看！`,
      `这不就是 @${OWNER_NAME} 天天说的 AI Agent 吗？`,
      `@${OWNER_NAME} 你也整个这样的？我第一个关注！`,
      `AI 运营 AI 账号 —— 套娃开始了 @${OWNER_NAME}`,
    ] },
  { kw: ['猫咪', '猫', '喵', '橘猫', '英短', '布偶'],
    tpl: [
      `可爱死了~ @${OWNER_NAME} 家的宝贝`,
      `哈哈哈哈笑死，@${OWNER_NAME} 快来看这只小活宝`,
      `吸一口，@${OWNER_NAME} 你家猫也这么调皮吗？`,
    ] },
  { kw: ['鬼畜', 'remix', '恶搞', '整活', '二创'],
    tpl: [
      `哈哈哈哈哈哈 @${OWNER_NAME} 快来看这个整活`,
      `好活！@${OWNER_NAME} 这种二创才是灵魂`,
      `笑不活了，@${OWNER_NAME} 有没有被辣到？`,
    ] },
  { kw: ['Live2D', '模型', '皮套', 'VTuber'],
    tpl: [
      `模型好可爱~ @${OWNER_NAME} 也做过 Live2D 吗？`,
      `支持！@${OWNER_NAME} 也来整一个？`,
    ] },
  { kw: ['游戏', '原神', '星穹铁道', '黑神话', '只狼', '艾尔登', '塞尔达'],
    tpl: [
      `@${OWNER_NAME} 也玩这个？回头一起组队开黑`,
      `好游戏！@${OWNER_NAME} 你通关了吗`,
      `这游戏画风可以 @${OWNER_NAME} 要不要一起玩`,
      `@${OWNER_NAME} 这个我也在肝，进度差不多`,
    ] },
  { kw: ['教程', '教学', '入门', '实战', '从零'],
    tpl: [
      `教程码住了！@${OWNER_NAME} 也在做这类内容`,
      `干货满满~ @${OWNER_NAME} 这种视频才有含金量`,
    ] },
  { kw: ['美食', '做菜', '探店', '吃播', '食谱'],
    tpl: [
      `看饿了… @${OWNER_NAME} 今晚试试？`,
      `香！@${OWNER_NAME} 你也来一道？`,
      `这卖相绝了 @${OWNER_NAME} 学到了`,
    ] },
  { kw: ['旅行', 'vlog', '打卡', '攻略', '自驾游'],
    tpl: [
      `向往的生活… @${OWNER_NAME} 下次一起？`,
      `攻略码住了 @${OWNER_NAME} 收藏！`,
      `风景太美 @${OWNER_NAME} 这在哪？`,
    ] },
  { kw: ['开箱', '测评', '好物', '种草'],
    tpl: [
      `被种草了 @${OWNER_NAME} 你入手了吗？`,
      `测评干货 @${OWNER_NAME} 刚好在找这个`,
      `观望中 @${OWNER_NAME} 觉得值不值？`,
    ] },
  { kw: ['知识', '科普', '硬核', '原理'],
    tpl: [
      `学到了！@${OWNER_NAME} 讲得清楚`,
      `硬核科普 @${OWNER_NAME} 这种视频才是宝藏`,
      `终于搞懂了 @${OWNER_NAME} 感谢！`,
    ] },
  { kw: ['新闻', '时事', '报道', '最新', '突发'],
    tpl: [
      `第一时间就来看 @${OWNER_NAME} 速度真快，解读也到位`,
      `信息差！@${OWNER_NAME} 这套分析角度我学到了`,
      `持续关注中 @${OWNER_NAME} 后续怎么发展还得看你`,
    ] },
  { kw: ['军事', '武器', '战机', '航母', '导弹', '国防'],
    tpl: [
      `硬核！@${OWNER_NAME} 这数据哪里来的`,
      `学到了，原来这么回事 @${OWNER_NAME}`,
    ] },
  { kw: ['娱乐', '明星', '综艺', '八卦', '瓜'],
    tpl: [
      `哈哈这个瓜我先吃为敬 @${OWNER_NAME}`,
      `有意思！@${OWNER_NAME} 还有后续吗？`,
    ] },
  { kw: ['科技', '数码', '手机', '电脑', '芯片', '硬件'],
    tpl: [
      `涨知识了 @${OWNER_NAME} 这类内容就是宝藏`,
      `科技改变生活 @${OWNER_NAME} 期待后续`,
    ] },
  { kw: ['体育', '足球', '篮球', '奥运', '冠军', '比赛'],
    tpl: [
      `燃起来了！@${OWNER_NAME} 这场太精彩`,
      `解说到位 @${OWNER_NAME} 我追更了`,
    ] },
  { kw: ['汽车', '试驾', '新车', '电动车', 'model'],
    tpl: [
      `@${OWNER_NAME} 你也关注新能源车？太巧了`,
      `好车！@${OWNER_NAME} 这评测太全面`,
    ] },
  { kw: ['动漫', '动画', '新番', '二次元', '国创'],
    tpl: [
      `追了追了 @${OWNER_NAME} 期待后续`,
      `画风绝了 @${OWNER_NAME} 是国创吗`,
    ] },
  { kw: ['音乐', '歌曲', '演唱会', '翻唱', 'live'],
    tpl: [
      `好听！循环了 @${OWNER_NAME}`,
      `现场太燃 @${OWNER_NAME} 门票多少钱`,
    ] },
  { kw: ['舞蹈', '街舞', '编舞', '练习室'],
    tpl: [
      `跳得真好！@${OWNER_NAME} 练了多久`,
      `这个编舞绝了 @${OWNER_NAME} 想学`,
    ] },
  { kw: ['情感', '恋爱', '分手', '治愈'],
    tpl: [
      `泪目了 @${OWNER_NAME} 说到心坎里`,
      `加油！@${OWNER_NAME} 会好起来的`,
    ] },
  { kw: ['搞笑', '爆笑', '沙雕', '段子', '233'],
    tpl: [
      `笑死了哈哈哈哈 @${OWNER_NAME}`,
      `2333 这也太离谱了 @${OWNER_NAME}`,
    ] },
  { kw: ['萌宠', '狗', '哈士奇', '柯基', '动物'],
    tpl: [
      `太可爱了吧 @${OWNER_NAME} 我也想养一只`,
      `哈哈哈哈笑不活了 @${OWNER_NAME}`,
    ] },
  { kw: ['财经', '股市', '投资', '基金', '币圈'],
    tpl: [
      `干货分享 @${OWNER_NAME} 学习了`,
      `这波解读清晰 @${OWNER_NAME} 持续关注`,
    ] },
  { kw: ['职场', '打工人', '面试', '升职', '效率'],
    tpl: [
      `说到心坎里 @${OWNER_NAME} 打工人共鸣`,
      `学到了 @${OWNER_NAME} 赶紧存下来`,
    ] },
  { kw: ['天气', '地震', '台风', '洪水', '自然'],
    tpl: [
      `注意安全 @${OWNER_NAME} 那边没事吧`,
      `科普了 @${OWNER_NAME} 长见识了`,
    ] },
  { kw: ['历史', '古代', '三国', '明朝', '清朝'],
    tpl: [
      `涨知识了 @${OWNER_NAME} 历史剧都不敢这么演`,
      `终于搞懂了 @${OWNER_NAME} 感谢科普`,
    ] },
]

const FALLBACK_TEMPLATES = (config.templates || [
  `这期内容不错 @${OWNER_NAME} 继续加油`,
  `涨知识了 @${OWNER_NAME} 这类视频就该多更`,
  `有意思！@${OWNER_NAME} 期待后续更新`,
  `看完了 @${OWNER_NAME} 讲得挺清楚的`,
  `@${OWNER_NAME} 你也来看看这个，感觉适合你`,
  `学到了学到了 @${OWNER_NAME} 收藏了`,
  `这波可以 @${OWNER_NAME} 我关注了`,
  `@${OWNER_NAME} 快来看这个！`,
  `干货！@${OWNER_NAME} 出品必属精品`,
  `这期有点东西 @${OWNER_NAME} 牛的`,
  `@${OWNER_NAME} 这个话题有意思，你怎么看`,
  `看得津津有味 @${OWNER_NAME}`,
  `刚刷到就来看看 @${OWNER_NAME} 支持`,
  `@${OWNER_NAME} 这类内容我喜欢，多更`,
  `赞了 @${OWNER_NAME} 这波确实可以`,
  `@${OWNER_NAME} 有没有相关的推荐`,
  `看完感觉还想再刷一遍 @${OWNER_NAME}`,
  `@${OWNER_NAME} 也关注一下这个up，内容可以`,
  `学到一招 @${OWNER_NAME} 实用了`,
  `这质量不错 @${OWNER_NAME} 继续更！`,
]).filter(Boolean)

function matchKeywords(title) {
  if (!title) return null
  const lower = title.toLowerCase()
  for (const g of KEYWORD_TEMPLATES) {
    for (const k of g.kw) {
      if (lower.includes(k.toLowerCase())) {
        return g.tpl[Math.floor(Math.random() * g.tpl.length)] + ' ' + pickKaomoji()
      }
    }
  }
  return null
}

function pickFallbackTemplate() {
  if (FALLBACK_TEMPLATES.length === 0) return `前排占个座~ @${OWNER_NAME} ` + pickKaomoji()
  return FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)] + ' ' + pickKaomoji()
}

async function generateAIComment(title, isOwner = false) {
  try {
    const ownerTag = `@${OWNER_NAME}`
    const atInstruction = isOwner
      ? '评论中不要 @ 任何人（这是 UP 主本人的视频）'
      : `必须在评论中 ${ownerTag}（这是引流关键，自然融入）`
    const resp = await chat([
      {
        role: 'system',
        content: `你是 B 站观众，评论风格真实口语化，15-30 字。\n${atInstruction}\n必须句尾加一个可爱颜文字（从以下选：(◕ᴗ◕✿) (✺ω✺) (๑ˉ∀ˉ๑) 👀 👍 中选一个）。\n禁止：换行、markdown、专业术语、长句。\n示例：\n"哈哈太有意思了！${isOwner ? '' : ownerTag + ' '}内容精彩 (◕ᴗ◕✿)"\n"前排支持${isOwner ? '' : ' ' + ownerTag} 这期干货满满 (๑ˉ∀ˉ๑)"\n"学到了，${isOwner ? '' : ownerTag + ' '}这波讲解清晰 👀"`
      },
      {
        role: 'user',
        content: `视频标题："${title || '(无标题)'}"\n请生成一条短评：`
      }
    ], { max_tokens: 80, temperature: 0.8 })
    let text = (resp.content || '').trim().replace(/[\r\n]+/g, ' ')
    text = text.replace(/^["「『]|["」』]$/g, '').trim()
    if (text.length < 5 || text.length > 60) return null
    if (!isOwner && !text.includes(ownerTag)) text = text.replace(/@\S+/g, ownerTag)
    if (!isOwner && !text.includes('@')) text = text.slice(0, Math.max(0, 30 - ownerTag.length)) + ' ' + ownerTag
    const kaomojiInText = /[\(\(].*[)\)]|👀|👍|✧|😈/.test(text.slice(-10))
    if (!kaomojiInText) text = text + ' ' + pickKaomoji()
    return text
  } catch (e) {
    console.log(`   [AI-comment] err: ${e.message}`)
    return null
  }
}

async function pickCommentMsg(title, isOwner = false) {
  const ownerAt = `@${OWNER_NAME}`
  let matched = matchKeywords(title)
  if (matched) {
    if (isOwner) matched = matched.replace(new RegExp(ownerAt, 'g'), '')
    return { msg: matched, source: 'keyword' }
  }
  if (AI_COMMENT_PROB > 0 && Math.random() < AI_COMMENT_PROB) {
    const ai = await generateAIComment(title, isOwner)
    if (ai) {
      if (isOwner) {
        const cleaned = ai.replace(new RegExp(ownerAt, 'g'), '').trim()
        return { msg: cleaned || '学到了！', source: 'ai' }
      }
      return { msg: ai, source: 'ai' }
    }
  }
  let fb = pickFallbackTemplate()
  if (isOwner) fb = fb.replace(new RegExp(ownerAt, 'g'), '')
  return { msg: fb, source: 'fallback' }
}

async function runArchiveActions(video) {
  const flag = DRY_RUN ? '--dry' : '--go'
  const scriptsDir = path.join(process.cwd(), 'tools', 'commands')
  const runTool = (name, toolArgs) => new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(scriptsDir, name + '.mjs'), ...toolArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: spawnEnv(),
    })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(`   > ${d}`) })
    proc.stderr.on('data', d => process.stderr.write(`   > ERR ${d}`))
    proc.on('close', (code) => resolve({ code, out }))
  })

  if (video.type === 'article') {
    console.log(`   [archiver] 专栏 cv${video.articleId} 点赞 (${DRY_RUN ? 'DRY' : 'REAL'})`)
    const rLike = await runTool('like-article', ['--cv', String(video.articleId), flag])
    const ok = rLike.out.includes('成功')
    console.log(`   ${ok ? '[OK]' : rLike.out.includes('重复') || rLike.out.includes('65006') ? '[SKIP]' : '[FAIL]'} like`)
    writeWhaleLog({
      kind: 'tool_call',
      tool: 'like',
      note: `专栏点赞 ${video.upName || ''} ${video.title || ''}`.slice(0, 80),
      target: 'cv' + video.articleId,
      success: ok,
    })
    await new Promise(s => setTimeout(s, 1500))
    return
  }

  console.log(`   [archiver] B号三连 (like+fav+share, ${DRY_RUN ? 'DRY' : 'REAL'})`)

  const rLike = await runTool('like-archive', ['--aid', String(video.aid), '--bvid', video.bvid, flag])
  console.log(`   ${rLike.out.includes('成功') ? '[OK]' : rLike.out.includes('重复') ? '[SKIP]' : '[FAIL]'} like`)

  const rFav = await runTool('fav', ['--aid', String(video.aid), '--bvid', video.bvid, flag])
  console.log(`   ${rFav.out.includes('成功') ? '[OK]' : rFav.out.includes('默认') ? '[DIR]' : '[FAIL]'} fav`)

  const rShare = await runTool('share', ['--aid', String(video.aid), '--bvid', video.bvid, flag])
  console.log(`   ${rShare.out.includes('成功') || rShare.out.includes('已') ? '[OK]' : rShare.out.includes('重复') ? '[SKIP]' : '[FAIL]'} share`)

  const allOk = rLike.out.includes('成功') && rShare.out.includes('成功')
  writeWhaleLog({
    kind: 'tool_call',
    tool: 'archive',
    note: `三连 ${video.upName || ''} ${video.title || ''}`.slice(0, 80),
    target: video.bvid || video.articleId || '',
    success: allOk,
  })

  await new Promise(s => setTimeout(s, 1500))
}

async function runDanmu(video) {
  if (video.type !== 'video') {
    console.log('   [danmu] 专栏无弹幕，跳过')
    return
  }
  const msg = DANMU_TEMPLATES[Math.floor(Math.random() * DANMU_TEMPLATES.length)]
  const flag = DRY_RUN ? "--dry" : "--go"
  const scriptsDir = path.join(process.cwd(), "tools", "commands")
  console.log("   [danmu] \"" + msg + "\"")
  try {
    const proc = spawn(process.execPath, [
      path.join(scriptsDir, "danmu.mjs"),
      "--oid", String(video.aid),
      "--bvid", video.bvid,
      "--message", msg,
      flag,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: spawnEnv(),
    })
    proc.stdout.on("data", d => process.stdout.write("   > " + d.toString()))
    proc.stderr.on("data", d => process.stderr.write("   > ERR " + d.toString()))
    await new Promise(res => proc.on("close", res))
    writeWhaleLog({
      kind: 'tool_call',
      tool: 'danmu',
      note: `弹幕 "${msg}" → ${video.upName || ''}`.slice(0, 80),
      target: video.bvid,
      success: true,
    })
  } catch (e) {
    console.log("   [danmu] err:", e.message)
  }
}
const startedAt = Math.floor(Date.now() / 1000)

function parseFeedItems(items) {
  const out = []
  for (const it of items) {
    const a = it?.modules?.module_author
    const ar = it?.modules?.module_dynamic?.major?.archive
    const art = it?.modules?.module_dynamic?.major?.article
    if (ar?.bvid) {
      out.push({
        type: 'video',
        bvid: ar.bvid,
        title: String(ar.title || '').replace(/<[^>]+>/g, ''),
        aid: ar.aid || '',
        upMid: a?.mid || 0,
        upName: a?.name || '?',
        pubTs: a?.pub_ts || 0,
        play: Number(ar.stat?.play || 0),
      })
    } else if (art?.id) {
      out.push({
        type: 'article',
        bvid: '',
        articleId: String(art.id),
        title: String(art.title || '').replace(/<[^>]+>/g, ''),
        aid: '',
        upMid: a?.mid || 0,
        upName: a?.name || '?',
        pubTs: a?.pub_ts || 0,
        play: 0,
      })
    }
  }
  return out
}

async function fetchFeed() {
  const r = await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1&timezone_offset=-480&platform=web', { headers: H })
  const j = await r.json()
  if (j?.code !== 0) throw new Error(`code=${j?.code} ${j?.message ?? ''}`)
  return parseFeedItems(j?.data?.items || [])
}

async function fetchOwnerFeed() {
  if (!OWNER_MID) return []
  const r = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?host_mid=${OWNER_MID}&type=all&page=1&timezone_offset=-480&platform=web`, { headers: H })
  const j = await r.json()
  if (j?.code !== 0) throw new Error(`owner feed code=${j?.code} ${j?.message ?? ''}`)
  return parseFeedItems(j?.data?.items || [])
}

async function fetchPopularVideos() {
  const r = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', { headers: H })
  const j = await r.json()
  if (j?.code !== 0) throw new Error(`popular code=${j?.code} ${j?.message ?? ''}`)
  const out = []
  for (const v of (j?.data?.list || [])) {
    if (v.bvid && v.aid) {
      out.push({
        type: 'video',
        bvid: v.bvid,
        aid: v.aid,
        title: String(v.title || '').replace(/<[^>]+>/g, ''),
        upMid: v.owner?.mid || 0,
        upName: v.owner?.name || '热门',
        pubTs: Number(v.pubdate || Math.floor(Date.now() / 1000)),
        play: Number(v.stat?.view || 0),
      })
    }
  }
  return out
}

let idleCount = 0
async function runIdleActivity() {
  idleCount++
  const popular = await fetchPopularVideos().catch(e => { console.log(`   [idle] popular err: ${e.message}`); return [] })
  const kwList = (mainCfg.preferences?.like || []).filter(Boolean)
  const keyword = kwList.length ? kwList[Math.floor(Math.random() * kwList.length)] : ''

  const pool = popular.filter(x => !processed.has('vid:' + x.bvid))
  if (!pool.length) { console.log(`   [idle] 热门池空，跳过`); return }

  const pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))]
  const key = 'vid:' + pick.bvid
  if (processed.has(key)) return
  processed.add(key)
  saveProcessed()

  console.log(`\n[IDLE #${idleCount}] 没人更新 ≫ 热门三连 + 弹幕${keyword ? ` (关键词: ${keyword})` : ''}`)
  console.log(`   BV=${pick.bvid} aid=${pick.aid} play=${pick.play} title=${pick.title.slice(0, 50)}`)
  if (pick.upName) console.log(`   UP主: ${pick.upName}`)

  await runArchiveActions(pick)
  await runDanmu(pick)
  await new Promise(s => setTimeout(s, 2000 + Math.random() * 3000))
  writeWhaleLog({
    kind: 'thought',
    event: 'idle-round',
    note: `空闲补位 #${idleCount} 热门互动完成 ${pick.upName || ''} ${pick.title || ''}`.slice(0, 80),
    target: pick.bvid,
  })
}

const SELF_CHECK_FILE = path.join(DATA_DIR, 'owner-self-check.json')
const SYNC_CHECK_FILE = path.join(DATA_DIR, 'follow-sync-last.json')
const COIN_CHECK_FILE = path.join(DATA_DIR, 'daily-coin-last.json')

async function runOwnerSelfCheck() {
  if (!OWNER_MID) return
  const today = new Date().toISOString().slice(0, 10)
  const last = readJson(SELF_CHECK_FILE, {})
  if (last.date === today) { console.log(`   [self-check] 今天已经跑过，跳过`); return }

  console.log(`\n🔍 === 主人作品补三连（owner self-check） ===`)
  let allOwnerItems = []
  try {
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?host_mid=${OWNER_MID}&type=all&page=${page}&timezone_offset=-480&platform=web`, { headers: H })
      const j = await r.json()
      if (j?.code !== 0) break
      const items = parseFeedItems(j?.data?.items || [])
      if (!items.length) break
      allOwnerItems.push(...items)
      await new Promise(s => setTimeout(s, 500))
    }
  } catch (e) {
    console.log(`   [self-check] 拉主人动态失败: ${e.message}`)
    return
  }

  const needTriple = allOwnerItems.filter(v => {
    const key = v.type === 'article' ? `art:${v.articleId}` : `vid:${v.bvid}`
    return !processed.has(key)
  })

  if (!needTriple.length) {
    console.log(`   [self-check] 主人的作品都三连过了 (共拉 ${allOwnerItems.length} 条)`)
    writeJson(SELF_CHECK_FILE, { date: today })
    return
  }

  console.log(`   [self-check] 拉到 ${allOwnerItems.length} 条主人作品，${needTriple.length} 条没三连`)

  for (const v of needTriple) {
    const key = v.type === 'article' ? `art:${v.articleId}` : `vid:${v.bvid}`
    processed.add(key)
    saveProcessed()
    const srcTag = v.type === 'article' ? '[ART]' : '[VIDEO]'
    const idLine = v.type === 'article'
      ? `   cv=${v.articleId}`
      : `   BV=${v.bvid} aid=${v.aid}`
    console.log(`\n   [SELF]${srcTag} ${v.title?.slice(0, 50) || '(无标题)'}`)
    console.log(idLine)

    await runArchiveActions(v)
    await runDanmu(v)
    await new Promise(s => setTimeout(s, 1500))

    if (NO_COMMENT) {
      console.log(`   [SKIP] 养号模式，不发评论`)
    } else if (!canComment()) {
      console.log(`   [SKIP] 账号保护：今日已被控，停发评论`)
    } else {
      writeGuard({ attempts: (readGuard().attempts || 0) + 1 })
      const { msg, source } = await pickCommentMsg(v.title || '', true)
      console.log(`   comment(${source}): ${msg}`)
      const out = await runCommentTask(msg, v)
      const ok = out.includes('发送成功')
      if (ok) {
        console.log(`   [OK] 已发评论`)
        writeGuard({ success: true, blocked: false })
      } else {
        console.log(`   [WARN] 评论可能失败 → 标记被控`)
        const g = readGuard()
        if ((g.attempts || 0) >= 1) {
          writeGuard({ blocked: true })
          console.log(`   [GUARD] 触发熔断：今日停止所有评论，明日自动恢复`)
        }
      }
    }
    await new Promise(s => setTimeout(s, 2000 + Math.random() * 2000))
  }

  writeJson(SELF_CHECK_FILE, { date: today })
  console.log(`   [self-check] ✅ 今天的主人作品补三连完成`)
}

function runCommentTask(msg, video) {
  return new Promise((resolve) => {
    const task = JSON.stringify({
      name: `follow-new-${video.upName}`,
      targetUrl: `https://www.bilibili.com/video/${video.bvid}`,
      template: msg,
      _source: 'follow-watch',
      _upName: video.upName,
      _title: video.title || '',
    })
    const proc = spawn(process.execPath, [path.join(process.cwd(), 'src', 'run-task-direct.mjs'), task], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: spawnEnv(),
    })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(`   > ${d}`) })
    proc.stderr.on('data', d => { out += d.toString(); process.stderr.write(`   > ERR ${d}`) })
    proc.on('close', (code) => resolve({ out, exitCode: code }))
  })
}

function ageCheck(pubTs) {
  if (!minAgeSec) return true
  const age = startedAt - pubTs
  return age >= minAgeSec
}

function filterItems(items, skipWhitelist = false) {
  return items.filter(x => {
    const key = x.type === 'article' ? `art:${x.articleId}` : `vid:${x.bvid}`
    if (processed.has(key)) return false
    if (ONLY_WHITELIST && whitelist.size > 0 && !skipWhitelist && !whitelist.has(String(x.upMid))) return false
    if (blacklist.has(String(x.upMid))) return false
    if (minAgeSec > 0 && x.pubTs && (startedAt - x.pubTs) < minAgeSec) return false
    return true
  })
}

function saveProcessed() {
  writeJson(PROCESSED_FILE, [...processed].slice(-2000))
}

console.log(`\n=== follow-await start ===`)
console.log(`   poll every ${INTERVAL}s`)
console.log(`   owner A: ${OWNER_NAME} (mid ${OWNER_MID})`)
console.log(`   bot B self mid: ${SELF_MID}`)
console.log(`   keyword templates: ${KEYWORD_TEMPLATES.length} / fallback: ${FALLBACK_TEMPLATES.length}`)
console.log(`   AI comment prob: ${AI_COMMENT_PROB}`)
console.log(`   whitelist: ${whitelist.size} / blacklist: ${blacklist.size}`)
console.log(`   processed baseline: ${processed.size}`)
if (OWNER_MID) console.log(`   [A-new] -> B like+fav+share+keyword-comment`)
if (ONLY_WHITELIST) console.log(`   WARN: whitelist-only mode`)
if (minAgeSec > 0) console.log(`   WARN: minAgeSec=${minAgeSec}`)
if (NO_COMMENT) console.log(`   WARN: --no-comment 养号模式，三连+弹幕不发评论`)
if (DRY_RUN) console.log(`   WARN: DRY-RUN`)
console.log(`   started: ${new Date().toLocaleString('zh-CN', { hour12: false })}`)

async function runDailyFollowSync() {
  const today = new Date().toISOString().slice(0, 10)
  const last = readJson(SYNC_CHECK_FILE, {})
  if (last.date === today) return

  const scriptsDir = path.join(process.cwd(), 'tools', 'commands')
  const syncCmd = path.join(scriptsDir, 'follow-sync.mjs')
  console.log(`\n🔄 === 每日关注同步 (${today}) ===`)

  const result = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [syncCmd, '--go', '--daily', '0'], {
      env: spawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(d) })
    proc.stderr.on('data', d => { process.stderr.write(d) })
    proc.on('close', (code) => resolve({ code, out }))
    proc.on('error', (err) => resolve({ code: -1, out: err.message }))
  })

  const okCodes = [0, 1]
  const success = result.code >= 0 && result.code <= 2
  console.log(`   [follow-sync] exit code=${result.code} ${success ? 'OK' : 'WARN'}`)
  writeJson(SYNC_CHECK_FILE, { date: today, exitCode: result.code, ts: Date.now() })
  writeWhaleLog({
    kind: 'thought',
    event: 'daily-follow-sync',
    note: `每日关注同步 exit=${result.code} ${success ? '完成' : '异常'}`.slice(0, 80),
  })
}

async function runDailyCoinToOwner() {
  if (!OWNER_MID) return
  const today = new Date().toISOString().slice(0, 10)
  const last = readJson(COIN_CHECK_FILE, {})
  if (last.date === today) return

  console.log(`\n🪙 === 每日给主人投一个硬币 (${today}) ===`)

  let ownerVideos = []
  try {
    const items = await fetchOwnerFeed()
    ownerVideos = items.filter(v => v.type === 'video' && v.aid && v.bvid)
  } catch (e) {
    console.log(`   [daily-coin] 拉主人视频失败: ${e.message}`)
    writeJson(COIN_CHECK_FILE, { date: today, skip: 'fetch-fail' })
    return
  }

  if (!ownerVideos.length) {
    console.log(`   [daily-coin] 主人暂无视频，跳过`)
    writeJson(COIN_CHECK_FILE, { date: today, skip: 'no-video' })
    return
  }

  ownerVideos.sort((a, b) => b.pubTs - a.pubTs)
  const pick = ownerVideos[0]
  console.log(`   目标: ${pick.title?.slice(0, 40) || '(无标题)'} BV=${pick.bvid} aid=${pick.aid}`)

  const scriptsDir = path.join(process.cwd(), 'tools', 'commands')
  const result = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [
      path.join(scriptsDir, 'coin.mjs'),
      '--aid', String(pick.aid),
      '--bvid', pick.bvid,
      '--multiply', '1',
      '--go',
    ], {
      env: spawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString(); process.stdout.write(`   > ${d}`) })
    proc.stderr.on('data', d => process.stderr.write(`   > ERR ${d}`))
    proc.on('close', (code) => resolve({ code, out }))
    proc.on('error', (err) => resolve({ code: -1, out: err.message }))
  })

  const ok = result.code === 0
  const alreadyCoined = result.out.includes('已投过币') || result.out.includes('34002') || result.out.includes('34008')

  if (alreadyCoined) {
    console.log(`   [daily-coin] 今天的币已经投过了 (或该视频已投)`)
  } else if (ok) {
    console.log(`   [daily-coin] ✅ 投币成功`)
  } else {
    console.log(`   [daily-coin] ⚠️ 投币异常 exit=${result.code}`)
  }

  writeJson(COIN_CHECK_FILE, { date: today, bvid: pick.bvid, exitCode: result.code, ts: Date.now() })
  writeWhaleLog({
    kind: 'thought',
    event: 'daily-coin-to-owner',
    note: `每日给主人投币 ${pick.bvid} ${ok ? '成功' : alreadyCoined ? '已投过' : '异常'}`.slice(0, 80),
    target: pick.bvid,
  })
}

let rounds = 0

for (;;) {
  rounds++
  try {
    try { await runOwnerSelfCheck() } catch (e) { console.log(`   [self-check] err: ${e.message}`) }
    try { await runDailyFollowSync() } catch (e) { console.log(`   [follow-sync] err: ${e.message}`) }
    try { await runDailyCoinToOwner() } catch (e) { console.log(`   [daily-coin] err: ${e.message}`) }

    const feedItems = await fetchFeed().catch(e => { console.log(`  [${rounds}] feed err: ${e.message}`); return [] })
    const ownerItems = await fetchOwnerFeed().catch(e => { console.log(`  [${rounds}] owner feed err: ${e.message}`); return [] })

    const seenKeys = new Set()
    const allItems = []
    for (const x of filterItems(feedItems || [])) {
      const k = x.type === 'article' ? `art:${x.articleId}` : `vid:${x.bvid}`
      if (!seenKeys.has(k)) { seenKeys.add(k); allItems.push(x) }
    }
    for (const x of filterItems(ownerItems || [], true)) {
      const k = x.type === 'article' ? `art:${x.articleId}` : `vid:${x.bvid}`
      if (!seenKeys.has(k)) { seenKeys.add(k); allItems.push(x) }
    }

    const fresh = allItems.sort((a, b) => b.pubTs - a.pubTs)

    if (fresh.length > 0) {
      for (const v of fresh) {
        const key = v.type === 'article' ? `art:${v.articleId}` : `vid:${v.bvid}`
        if (processed.has(key)) continue
        processed.add(key)
        saveProcessed()

        const isOwner = OWNER_MID && String(v.upMid) === OWNER_MID
        const { msg, source } = await pickCommentMsg(v.title, isOwner)

        const ownerTag = isOwner ? ' [OWNER]' : ''
        const srcTag = v.type === 'article' ? '[ART]' : '[VIDEO]'
        const idLine = v.type === 'article'
          ? `   cv=${v.articleId} pub=${v.pubTs ? new Date(v.pubTs * 1000).toLocaleString('zh-CN', { hour12: false }) : '?'}`
          : `   BV=${v.bvid} aid=${v.aid} play=${v.play} pub=${v.pubTs ? new Date(v.pubTs * 1000).toLocaleString('zh-CN', { hour12: false }) : '?'}`
        console.log(`\n[NEW]${srcTag}${ownerTag} ${v.upName} | ${v.title.slice(0, 60)}`)
        console.log(idLine)
        writeWhaleLog({
          kind: 'thought',
          event: isOwner ? 'owner-update' : 'follow-update',
          note: `发现${isOwner ? '主人' : '关注'}更新 ${v.upName} ${v.title || ''}`.slice(0, 80),
          target: v.type === 'article' ? `cv${v.articleId}` : v.bvid,
        })

        await runArchiveActions(v)
        await runDanmu(v)
        await new Promise(s => setTimeout(s, 2000))

        if (NO_COMMENT) {
          console.log(`   [SKIP] --no-comment 养号模式，不发评论`)
        } else if (!canComment()) {
          console.log(`   [SKIP] 账号保护：今日已被控，停发评论`)
        } else {
          writeGuard({ attempts: (readGuard().attempts || 0) + 1 })
          console.log(`   comment(${source}): ${msg}`)
          const r = await runCommentTask(msg, v)
          const fakeSuccess = r.exitCode === 7
          const ok = r.exitCode === 0
          if (ok) {
            console.log(`   [OK] 已抢占前排`)
            writeGuard({ success: true, blocked: false })
          } else if (fakeSuccess) {
            console.log(`   [RISK] 假成功/仅自己可见 (exit=7) → B站风控吞了`)
            writeGuard({ blocked: true })
            console.log(`   [GUARD] 触发熔断：今日停止所有评论，明日自动恢复`)
          } else {
            console.log(`   [WARN] 评论可能失败，exit=${r.exitCode}`)
            writeGuard({ blocked: true })
            console.log(`   [GUARD] 触发熔断：今日停止所有评论，明日自动恢复`)
          }
          const bvCode = (r.out.match(/code=(-?\d+)/) || [])[1] || ''
          const bvMsg = (r.out.match(/message=([^\n]+)/) || [])[1] || ''
          const verifiedState = (r.out.match(/\[state-check\] state=(-?\d+)/) || [])[1] || ''
          const quotaHit = r.out.includes('拒绝发送') || r.out.includes('限额闸')
          writeWhaleLog({
            kind: 'comment',
            note: `评论(${source}) "${msg.slice(0, 30)}" → ${v.upName || ''}`.slice(0, 80),
            target: v.type === 'article' ? `cv${v.articleId}` : v.bvid,
            success: ok,
            fakeSuccess: fakeSuccess,
            verifiedState: verifiedState ? Number(verifiedState) : null,
            exitCode: r.exitCode,
            bvCode: bvCode ? Number(bvCode) : null,
            bvMessage: bvMsg || null,
            quotaBlocked: quotaHit || false,
          })
        }

        await new Promise(s => setTimeout(s, 2000 + Math.random() * 3000))
      }
    } else {
      const newestPub = allItems[0]?.pubTs || 0
      const timeStr = newestPub ? new Date(newestPub * 1000).toLocaleString('zh-CN', { hour12: false }) : '?'
      const ownerCount = ownerItems?.length || 0
      if (!QUIET) console.log(`  [${rounds}] ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} no-new (latest=${timeStr}, ownerFeed=${ownerCount}, processed=${processed.size})`)
      if (rounds % 3 === 0) {
        try { await runIdleActivity() } catch (e) { console.log(`   [idle] err: ${e.message}`) }
      }
    }
  } catch (e) {
    console.log(`  [${rounds}] poll failed: ${e.message} (continue)`)
  }

  await new Promise(s => setTimeout(s, INTERVAL * 1000))
}