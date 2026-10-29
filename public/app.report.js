(function(){
function animateNumber(el, target, duration) {
  duration = duration || 1000;
  var start = parseInt(el.textContent) || 0;
  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(start + (target - start) * ease);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function loadDailyReport() {
  fetch('/api/daily-report').then(function(r){return r.json()}).then(function(d){
    var dateEl = document.getElementById('daily-date');
    if (dateEl) dateEl.textContent = '· ' + (d.date || '');
    var roles = ['archives','danmus','comments','interactions'];
    var maxMap = { archives: 30, danmus: 30, comments: 10, interactions: 60 };
    roles.forEach(function(role){
      var card = document.querySelector('.mini-stat[data-role="'+role+'"]');
      if (!card) return;
      var numEl = card.querySelector('.mini-num');
      var barEl = card.querySelector('.mini-bar > div');
      animateNumber(numEl, d[role] || 0, 1200);
      if (barEl) {
        var pct = Math.min((d[role] || 0) / (maxMap[role] || 1), 1) * 100;
        setTimeout(function(){ barEl.style.width = pct + '%'; }, 100);
      }
    });
    var planText = document.getElementById('plan-text');
    if (planText) {
      var archives = d.archives || 0, danmus = d.danmus || 0, comments = d.comments || 0;
      var archiveOk = archives >= 30, danmuOk = danmus >= 30, commentOk = comments >= 5;
      var parts = [];
      parts.push('<span style="color:'+ (archiveOk ? '#52c41a' : '#faad14') +'"><span class="iconfont icon-bookmark-check" style="vertical-align:-2px"></span> 三连 '+archives+'/30</span>');
      parts.push('<span style="color:'+ (danmuOk ? '#52c41a' : '#faad14') +'"><span class="iconfont icon-barrage" style="vertical-align:-2px"></span> 弹幕 '+danmus+'/30</span>');
      var cfg = null;
      try { cfg = document.getElementById('fw-nc') } catch {}
      var noComment = cfg ? cfg.checked : false;
      if (noComment) {
        parts.push('<span style="color:#888"><span class="iconfont icon-edit-pen" style="vertical-align:-2px"></span> 评论（养号模式已关）</span>');
      } else {
        parts.push('<span style="color:'+ (commentOk ? '#52c41a' : '#faad14') +'"><span class="iconfont icon-edit-pen" style="vertical-align:-2px"></span> 评论 '+comments+'/5</span>');
      }
      planText.innerHTML = parts.join(' &nbsp;·&nbsp; ') + '<span style="color:#888;margin-left:12px">· 每 3 轮 idle 自动触发热门互动</span>';
      var actBox = document.getElementById('daily-actions');
      if (actBox && d.actions && d.actions.length) {
        actBox.innerHTML = '';
        var head = document.createElement('div');
        head.style.cssText = 'font-size:12px;color:#888;margin-bottom:6px';
        head.innerHTML = '<span class="iconfont icon-list" style="vertical-align:-2px"></span> 今日已操作 · 点击可跳转视频';
        actBox.appendChild(head);
        d.actions.slice(0,20).forEach(function(a){
        var t=new Date(a.t);
        var ts=t.toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}).slice(0,5);
        var toolMap={archive:'三连',danmu:'弹幕',like:'点赞',fav:'收藏',share:'分享',comment:'评论',action:'动作'};
        var label=toolMap[a.tool]||a.tool||'操作';
        var evtClsMap={archive:'evt-action',danmu:'evt-thought',like:'evt-action',fav:'evt-action',share:'evt-action',comment:'evt-comment',action:'evt-action'};
        var cls=evtClsMap[a.tool]||'evt-event';
        var note=(a.note||'').slice(0,80);
        var node=document.getElementById('tpl-action-row').content.firstElementChild.cloneNode(true);
        node.classList.remove('evt-action','evt-thought','evt-comment','evt-event','evt-wake','evt-feeling','evt-summary');
        node.classList.add(cls);
        node.querySelector('.evt-tag').textContent=label;
        node.querySelector('.evt-time').textContent=ts;
        var targetEl=node.querySelector('.evt-target');
        if(a.link){
          targetEl.textContent=a.target||'';
          targetEl.href=a.link;
          targetEl.style.display='';
          node.dataset.href=a.link;
        } else {
          targetEl.style.display='none';
          node.dataset.href='';
        }
        if (a.tool === 'comment') {
          let badge = '';
          if (a.fakeSuccess) {
            badge = '<span style="background:#ff4d4f;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;margin-left:6px">⚠️ 风控吞了</span>';
          } else if (a.verifiedState === 0) {
            badge = '<span style="background:#52c41a;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;margin-left:6px">✓ 公开可见</span>';
          } else if (a.verifiedState === null && a.success) {
            badge = '<span style="background:#faad14;color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;margin-left:6px">⚠ 未验证</span>';
          }
          const noteEl = node.querySelector('.evt-note');
          noteEl.textContent = note;
          if (badge) noteEl.innerHTML += badge;
        } else {
          node.querySelector('.evt-note').textContent = note;
        }       actBox.appendChild(node);
      });
      } else if (actBox) { actBox.innerHTML = ''; }
    }
  }).catch(function(){});
}

async function exportLog() {
  var btn = document.getElementById('btn-export-log');
  var box = document.getElementById('export-log-box');
  var tip = document.getElementById('export-log-tip');
  if (!btn || !box) return;
  btn.disabled = true; btn.textContent = '生成中...';
  box.style.display = 'none'; box.value = '';
  if (tip) { tip.style.color = ''; tip.textContent = ''; }
  try {
    var r1 = await fetch('/api/daily-report').then(function(r){return r.json()});
    var r2 = await fetch('/api/like-log?days=7').then(function(r){return r.json()});
    var r3 = await fetch('/api/stats-history').then(function(r){return r.json()});
    var r4 = await fetch('/api/dashboard').then(function(r){return r.json()});

    var today = r1.date || new Date().toISOString().slice(0,10);
    var prev = (r3.data && r3.data.length >= 2) ? r3.data[r3.data.length - 2] : null;
    var cur = (r3.data && r3.data.length >= 1) ? r3.data[r3.data.length - 1] : null;
    var ownerDelta = '';
    if (prev && cur) {
      var of = (cur.owner?.follower||0) - (prev.owner?.follower||0);
      var od = (cur.owner?.following||0) - (prev.owner?.following||0);
      var ol = (cur.owner?.likes||0) - (prev.owner?.likes||0);
      ownerDelta = ' | 主号 粉丝' + (of>=0?'+':'') + of + ' 关注' + (od>=0?'+':'') + od + ' 被赞' + (ol>=0?'+':'') + ol;
    }
    var selfDelta = '';
    if (prev && cur) {
      var sf = (cur.self?.follower||0) - (prev.self?.follower||0);
      var sd = (cur.self?.following||0) - (prev.self?.following||0);
      var sl = (cur.self?.likes||0) - (prev.self?.likes||0);
      selfDelta = ' | 分身 粉丝' + (sf>=0?'+':'') + sf + ' 关注' + (sd>=0?'+':'') + sd + ' 被赞' + (sl>=0?'+':'') + sl;
    }

    var lines = [];
    lines.push('# Day ' + today + ' · 养号素材草稿');
    lines.push('');
    lines.push('## 📊 今日数据');
    lines.push('');
    lines.push('| 指标 | 今日完成 | 目标 | 状态 |');
    lines.push('|------|---------|------|------|');
    lines.push('| 三连 | ' + r1.archives + ' | 30 | ' + (r1.archives>=30?'✅':'⏳') + ' |');
    lines.push('| 弹幕 | ' + r1.danmus + ' | 30 | ' + (r1.danmus>=30?'✅':'⏳') + ' |');
    lines.push('| 评论 | ' + r1.comments + ' | 5 | ' + (r1.comments>=5?'✅':'⏳') + ' |');
    lines.push('| 总计 | ' + r1.interactions + ' | 60 | ' + (r1.interactions>=60?'✅':'⏳') + ' |');
    lines.push('');
    if (ownerDelta || selfDelta) {
      lines.push('## 📈 账号增量');
      lines.push('');
      lines.push((cur ? '最新: ' + (cur.date||today) : '') + ownerDelta + selfDelta);
      lines.push('');
    }
    lines.push('## 🤖 Token 消耗');
    lines.push('');
    var tok = r4.todayTokens || 0, bud = r4.budget || 50000;
    var pct = Math.round(tok / bud * 100);
    lines.push('- 今日: ' + tok.toLocaleString() + ' / ' + bud.toLocaleString() + ' (' + pct + '%)');
    lines.push('- 豆包 API: ' + (r4.creds?.doubaoApiKey ? '✅ 已配置' : '❌ 未配置'));
    lines.push('- B站 Cookie: ' + (r4.creds?.sessdata ? '✅ OK' : '❌ 请登录'));
    lines.push('');
    if (r2.items && r2.items.length) {
      lines.push('## ❤️ 近 7 天点赞明细');
      lines.push('');
      var todayItems = r2.items.filter(function(i){ return i.t && i.t.slice(0,10) === today; });
      if (todayItems.length) {
        lines.push('**今日 ' + todayItems.length + ' 条:**');
        lines.push('');
        todayItems.forEach(function(i){
          var type = i.type === 'article' ? '📖专栏' : '🎬视频';
          var time = i.t ? i.t.slice(11,16) : '';
          lines.push('- [' + time + '] ' + type + ' `' + i.target + '` ' + (i.note||''));
        });
        lines.push('');
      }
      lines.push('**累计: ' + r2.totalCount + ' 条（今日 ' + r2.todayCount + ' 成功 ' + r2.todayOk + '）**');
      lines.push('');
    }
    if (r1.actions && r1.actions.length) {
      lines.push('## 🎯 今日操作明细');
      lines.push('');
      r1.actions.forEach(function(a){
        var toolMap = { archive:'三连', danmu:'弹幕', like:'点赞', fav:'收藏', share:'分享', comment:'评论', action:'动作' };
        var label = toolMap[a.tool] || a.tool;
        var time = a.t ? new Date(a.t).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}).slice(0,5) : '';
        var link = a.link ? ' → ' + a.link : '';
        lines.push('- [' + time + '] **' + label + '** ' + a.target + link + (a.note ? ' — ' + a.note : ''));
      });
      lines.push('');
    }
    lines.push('---');
    lines.push('*自动生成于 ' + new Date().toLocaleString('zh-CN') + ' · 复制后改一改就是 Day 文章*');

    box.value = lines.join('\n');
    box.style.display = 'block';
    tip.style.color = '#52c41a';
    tip.textContent = '✅ 已生成 ' + box.value.length + ' 字，点右侧可复制';
    box.focus(); box.select();
    var ok = document.execCommand('copy');
    if (ok) tip.textContent += ' · 已复制到剪贴板';
  } catch(e) {
    tip.style.color = '#ff4d4f';
    tip.textContent = '❌ 生成失败: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '生成日志素材';
  }
}

// --- 导出到全局 ---
window.animateNumber = animateNumber;
window.loadDailyReport = loadDailyReport;
window.exportLog = exportLog;
})();