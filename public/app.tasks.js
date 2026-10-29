(function(){
function toast(msg,type){
  var t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:14px 28px;border-radius:10px;color:#fff;z-index:9999;font-weight:500;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .3s;opacity:0;pointer-events:none';
  t.style.background=type==='error'?'#ff4d4f':type==='ok'?'#52c41a':'#0ea5e9';
  document.body.appendChild(t);
  requestAnimationFrame(function(){t.style.opacity=1});
  setTimeout(function(){t.style.opacity=0;setTimeout(function(){t.remove()},300)},2500);
}

var editingTaskId=null;
async function saveTask(){
  var nameEl=document.getElementById('tk-name');
  var urlEl=document.getElementById('tk-target-url');
  var dayEl=document.getElementById('tk-day');
  var timeEl=document.getElementById('tk-time');
  var leadEl=document.getElementById('tk-lead');
  var task={
    id:editingTaskId||('task-'+Date.now()),
    name:nameEl.value.trim(),
    targetUrl:urlEl.value.trim(),
    day:parseInt(dayEl.value),
    time:timeEl.value,
    leadMin:parseInt(leadEl.value)||15,
    template:document.getElementById('tk-template').value.trim(),
    ownerRef:document.getElementById('tk-owner-ref').value.trim(),
    description:document.getElementById('tk-desc').value.trim(),
    enabled:true,
    accountId:document.getElementById('tk-account').value || undefined,
    recoveryAccountId:document.getElementById('tk-restore-account').value || undefined,
    stages:typeof collectStages==='function'?collectStages():undefined,
  };
  if(!task.name){nameEl.focus();nameEl.style.borderColor='#ff6b6b';toast('请填任务名称','error');return}
  if(!task.targetUrl){urlEl.focus();urlEl.style.borderColor='#ff6b6b';toast('请填视频链接','error');return}
  if(!/^(https?:)?\/\//.test(task.targetUrl)&&!/^BV\d+/.test(task.targetUrl)&&!/^ss\d+/.test(task.targetUrl)){
    urlEl.focus();urlEl.style.borderColor='#ff6b6b';toast('视频链接格式不对','error');return
  }
  if(isNaN(task.day)||task.day<0||task.day>6){dayEl.focus();dayEl.style.borderColor='#ff6b6b';toast('请选更新日','error');return}
  if(!task.time||!/^\d{1,2}:\d{2}$/.test(task.time)){timeEl.focus();timeEl.style.borderColor='#ff6b6b';toast('上线时间格式应为 HH:MM','error');return}
  if(task.leadMin<0||task.leadMin>120){leadEl.focus();leadEl.style.borderColor='#ff6b6b';toast('提前量在 0-120 分钟之间','error');return}
  [nameEl,urlEl,dayEl,timeEl,leadEl].forEach(function(el){if(el)el.style.borderColor=''});
  var saveBtn=document.getElementById('tk-save-btn');
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='保存中...'}
  var resp=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',task})});
  var result=await resp.json();
  if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='保存任务'}
  if(result.ok){
    toast('任务已保存 ✓','ok');
    editingTaskId=null;
    var hint=document.getElementById('tk-editor-hint');if(hint)hint.remove();
    ['tk-name','tk-target-url','tk-template','tk-owner-ref','tk-desc'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=''});
    if(dayEl)dayEl.value='6';
    if(timeEl)timeEl.value='11:00';
    if(leadEl)leadEl.value='20';
    loadTasks();
    var __a=document.getElementById('tk-name');if(__a)__a.scrollIntoView({behavior:'smooth',block:'center'});
  }else{
    toast('保存失败','error');
  }
}

async function loadTasks(){
  var list=await fetch('/api/tasks').then(function(r){return r.json()});
  var wrap=document.getElementById('task-list');
  if(!wrap)return;
  if(!list||list.length===0){wrap.innerHTML='<div class="task-empty">还没有定时任务，下面加一个吧~</div>';return}
  wrap.innerHTML=list.map(function(t){
    var chip='<span class="task-chip '+(t.enabled===false?'disabled':(t.todayDone?'done':'pending'))+'">'+
      (t.enabled===false?'已暂停':(t.todayDone?(t.todayStatus==='fail'?'失败':'今日已完成'):'待触发'))+'</span>';
    var meta='<div class="task-meta">'+
      '<span class="task-chip">'+(t.days||'每天')+'</span>'+
      '<span class="task-chip">'+(t.time||'--:--')+'</span>'+
      '<span class="task-chip">提前'+(t.leadMin||0)+'分钟</span>'+
      (t.accountId?'<span class="task-chip" style="background:#fff0f6;color:#c41d7f;border-color:#ffadd2">账号: '+t.accountId+'</span>':'')+
      (t.recoveryAccountId?'<span class="task-chip" style="background:#f9f0ff;color:#531dab;border-color:#d3adf7">恢复: '+t.recoveryAccountId+'</span>':'')+
      (Array.isArray(t.stages)&&t.stages.length>0?'<span class="task-chip" style="background:#e6fffb;color:#08979c;border-color:#87e8de">'+t.stages.length+' 阶段</span>':'')+
      (t.ownerRef?'<span class="task-chip">引流: '+t.ownerRef+'</span>':'')+
      (t.lastRun?'<span class="mini">上次: '+t.lastRun+'</span>':'')+
    '</div>';
    var desc='';if(t.description)desc='<div class="task-desc">'+t.description+'</div>';
    var tmpl='';if(t.template)tmpl='<div class="task-desc" style="opacity:.6">预设文案: '+t.template.slice(0,60)+(t.template.length>60?'...':'')+'</div>';
    var act='<div class="task-actions">'+
      '<button class="btn ghost" data-id="'+t.id+'" onclick="editTask(this)">编辑</button>'+
      '<button class="btn ghost" data-id="'+t.id+'" onclick="toggleTask(this)">'+(t.enabled===false?'启用':'暂停')+'</button>'+
      '<button class="btn ghost danger" data-id="'+t.id+'" onclick="deleteTask(this)">删除</button>'+
    '</div>';
    return '<div class="task-card">'+
      '<div class="task-head">'+
        '<span class="task-name">'+(t.name||'')+'</span>'+
        chip+
      '</div>'+
      meta+desc+tmpl+act+
    '</div>';
  }).join('');
}

async function editTask(btn){
  var id=btn.dataset.id;
  var list=await fetch('/api/tasks').then(function(r){return r.json()});
  var t=list.find(function(x){return x.id===id});
  if(!t)return;
  editingTaskId=id;
  document.getElementById('tk-name').value=t.name||'';
  document.getElementById('tk-target-url').value=t.targetUrl||'';
  document.getElementById('tk-day').value=t.day!=null?t.day:'';
  document.getElementById('tk-time').value=t.time||'';
  document.getElementById('tk-lead').value=t.leadMin||15;
  document.getElementById('tk-template').value=t.template||'';
  document.getElementById('tk-owner-ref').value=t.ownerRef||'';
  document.getElementById('tk-desc').value=t.description||'';
  if(typeof loadAccounts==='function')loadAccounts();
  document.getElementById('tk-account').value=t.accountId||'';
  document.getElementById('tk-restore-account').value=t.recoveryAccountId||'';
  var __stg=document.getElementById('tk-stages');
  if(__stg){
    __stg.innerHTML='';
    if(Array.isArray(t.stages)&&t.stages.length>0){
      t.stages.forEach(function(s){
        addStage();
        var row=__stg.children[__stg.children.length-1];
        if(row){
          row.querySelector('.stg-name').value=s.name||'';
          row.querySelector('.stg-trigger').value=s.trigger||'';
          row.querySelector('.stg-account').value=s.accountId||'';
          row.querySelector('.stg-url').value=s.targetUrl||'';
          row.querySelector('.stg-template').value=s.template||'';
        }
      });
    }
  }
  var hint=document.getElementById('tk-editor-hint');
  if(!hint){
    hint=document.createElement('div');
    hint.id='tk-editor-hint';
    hint.style.cssText='background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:14px;color:#d46b08;display:flex;justify-content:space-between;align-items:center';
    hint.innerHTML='正在编辑任务，保存会覆盖原有设置 <button class="btn ghost danger" style="padding:4px 10px;min-width:auto" onclick="cancelEdit()">取消编辑</button>';
    var card=document.querySelector('#pane-tasks .card:last-of-type')||document.body;
    card.insertBefore(hint, card.firstChild);
  }
  var saveBtn=document.getElementById('tk-save-btn');
  if(saveBtn)saveBtn.textContent='更新任务';
  var __a=document.getElementById('tk-name');if(__a)__a.scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelEdit(){
  editingTaskId=null;
  var hint=document.getElementById('tk-editor-hint');if(hint)hint.remove();
  ['tk-name','tk-target-url','tk-template','tk-owner-ref','tk-desc'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=''});
  var d=document.getElementById('tk-day');if(d)d.value='6';
  var ti=document.getElementById('tk-time');if(ti)ti.value='11:00';
  var l=document.getElementById('tk-lead');if(l)l.value='20';
  var saveBtn=document.getElementById('tk-save-btn');if(saveBtn)saveBtn.textContent='保存任务';
}

async function toggleTask(btn){
  var id=btn.dataset.id;
  await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle',id:id})});
  loadTasks();
}
async function deleteTask(btn){
  var id=btn.dataset.id;
  if(!confirm('确定删除这个任务吗？'))return;
  await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id:id})});
  loadTasks();
}

async function runTool(kind){
  var resultEl=document.getElementById('tool-result');
  function showErr(msg){toast(msg,'error');if(resultEl)resultEl.textContent='❌ '+msg}
  var url='', q, label='';
  if(kind==='search'){
    q=document.getElementById('tool-search-q');if(!q)return;
    var v=q.value.trim();
    if(!v){toast('请输入搜索关键词','error');q.focus();q.style.borderColor='#ff6b6b';return}
    q.style.borderColor='';
    url='/tools/search?q='+encodeURIComponent(v);label='搜索: '+v;
  }else if(kind==='video'){
    q=document.getElementById('tool-video-bvid');if(!q)return;
    var v=q.value.trim();
    if(!v){toast('请输入视频 BV 号','error');q.focus();q.style.borderColor='#ff6b6b';return}
    if(!/^BV[A-Za-z0-9]+$/i.test(v)){toast('BV 号格式不对，应以 BV 开头，如 BV1xx411c7mu','error');q.focus();q.select();q.style.borderColor='#ff6b6b';return}
    q.style.borderColor='';
    url='/tools/video?bvid='+v;label='视频: '+v;
  }else if(kind==='whois'){
    q=document.getElementById('tool-whois-mid');if(!q)return;
    var v=q.value.trim();
    if(!v){toast('请输入 UP 主 MID','error');q.focus();q.style.borderColor='#ff6b6b';return}
    if(!/^\d+$/.test(v)){toast('MID 必须是纯数字','error');q.focus();q.select();q.style.borderColor='#ff6b6b';return}
    q.style.borderColor='';
    url='/tools/whois?mid='+v;label='MID: '+v;
  }else if(kind==='feed'){
    url='/tools/feed';label='刷新 Feed';
  }else{toast('未知工具: '+kind,'error');return}
  toast('请求中...','info');
  if(resultEl){resultEl.textContent='⏳ '+label+'\n请求中，请稍候...\n';resultEl.scrollTop=0}
  try{
    var r=await fetch(url);
    var text=await r.text();
    if(!r.ok){if(resultEl)resultEl.textContent='❌ HTTP '+r.status+'\n\n'+text;toast('请求失败: '+r.status,'error');return}
    if(resultEl)resultEl.textContent=text||'(空输出)';
    toast('完成 ✓','ok');
  }catch(e){
    if(resultEl)resultEl.textContent='❌ 网络错误: '+e.message;
    toast('网络错误','error');
  }
}

loadTasks();
loadAllOverviews();
setInterval(function(){loadTasks();loadAllOverviews()},30000);

async function loadAllOverviews(){
  loadTaskOverview();
  loadCheckinBox();
  loadFollowBox();
  loadSyncBox();
}

async function loadTaskOverview(){
  var box=document.getElementById('task-overview');
  var dateSpan=document.getElementById('task-date');
  if(!box)return;
  try{
    var d=await fetch('/api/dashboard').then(function(r){return r.json()});
    if(dateSpan){
      var today=new Date();
      dateSpan.textContent=today.toLocaleDateString('zh-CN',{month:'long',day:'numeric'})+' · '+['周日','周一','周二','周三','周四','周五','周六'][today.getDay()];
    }
    var statusMap={idle:{c:'#8c8c8c',t:'空闲',cls:'bili-gray'},running:{c:'#1677ff',t:'运行中',cls:'bili-blue'},done:{c:'#52c41a',t:'已完成',cls:'bili-green'},error:{c:'#ff4d4f',t:'异常',cls:'bili-red'}};
    var st=statusMap[d.agentStatus]||{c:'#8c8c8c',t:d.agentStatus||'未知',cls:'bili-gray'};
    var pct=Math.min(100,Math.round((d.todayTokens||0)/(d.budget||50000)*100));
    var tokenColor=pct>90?'#ff4d4f':pct>70?'#faad14':'#52c41a';
    var rows=[];
    rows.push('<div class="mini-stat '+st.cls+'">');
    rows.push('  <div class="mini-icon"><span class="iconfont icon-doubao1"></span></div>');
    rows.push('  <div class="mini-body">');
    rows.push('    <div class="mini-num">'+st.t+'</div>');
    rows.push('    <div class="mini-label">分身状态</div>');
    rows.push('  </div></div>');
    rows.push('<div class="mini-stat bili-purple">');
    rows.push('  <div class="mini-icon"><span class="iconfont icon-money"></span></div>');
    rows.push('  <div class="mini-body">');
    rows.push('    <div class="mini-num">'+(d.todayTokens||0).toLocaleString()+' <span class="mini">/ '+(d.budget||50000).toLocaleString()+'</span></div>');
    rows.push('    <div class="mini-label">Token 今日 <span style="background:#eee;border-radius:3px;height:3px;display:inline-block;width:40px;vertical-align:middle;margin-left:4px"><span style="background:'+tokenColor+';display:block;height:100%;border-radius:3px;width:'+pct+'%"></span></span></div>');
    rows.push('  </div></div>');
    rows.push('<div class="mini-stat bili-'+(d.creds?.sessdata?'green':'red')+'">');
    rows.push('  <div class="mini-icon"><span class="iconfont icon-link"></span></div>');
    rows.push('  <div class="mini-body">');
    rows.push('    <div class="mini-num">'+(d.creds?.sessdata?'已登录':'未登录')+'</div>');
    rows.push('    <div class="mini-label">B站 Cookie</div>');
    rows.push('  </div></div>');
    rows.push('<div class="mini-stat bili-orange">');
    rows.push('  <div class="mini-icon"><span class="iconfont icon-home"></span></div>');
    rows.push('  <div class="mini-body">');
    rows.push('    <div class="mini-num">'+(d.bili?.ownerName||'未设置')+'</div>');
    rows.push('    <div class="mini-label">UP 主</div>');
    rows.push('  </div></div>');
    if(d.latestDiary){
      rows.push('<div class="mini-stat bili-cyan">');
      rows.push('  <div class="mini-icon" style="background:rgba(22,119,255,.12)"><span class="iconfont icon-check-in" style="color:#1677ff"></span></div>');
      rows.push('  <div class="mini-body">');
      rows.push('    <div class="mini-num" style="font-size:14px;font-weight:600;letter-spacing:0;color:var(--c-text-title)">'+(d.latestDiary.summary||'')+'</div>');
      rows.push('    <div class="mini-label">'+d.latestDiary.date+' · 最新活动</div>');
      rows.push('  </div></div>');
    }
    box.innerHTML=rows.join('');
  }catch(e){box.textContent='加载失败';}
}

async function loadCheckinBox(){
  var box=document.getElementById('checkin-box');
  if(!box)return;
  try{
    var d=await fetch('/api/daily-checkin').then(function(r){return r.json()});
    var rows=[];
    if(d.error){
      rows.push('<div style="padding:12px 14px;background:#fff2f0;border:1px solid #ffccc7;border-radius:10px;color:#cf1322;font-size:13px">');
      rows.push('<div style="font-weight:600;margin-bottom:4px">⚠️ B站 Cookie 异常</div>');
      rows.push('<div style="opacity:.85">'+d.error+'</div>');
      rows.push('<div class="mini" style="margin-top:6px">请到 <b>账户</b> 标签页，粘贴最新的 Cookie（从浏览器 DevTools → Network → bilibili.com 请求头 → Copy as string）</div>');
      rows.push('</div>');
    }
    if(d.level){
      rows.push('<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">');
      rows.push('  <div style="background:linear-gradient(135deg,#fb7299,#ff9a9e);color:#fff;padding:4px 12px;border-radius:14px;font-weight:600;font-size:13px">Lv.'+(d.level.current_level||'-')+'</div>');
      rows.push('  <div class="mini">'+(d.level.current_exp||0)+' / '+(d.level.next_exp||0)+' 经验</div>');
      rows.push('  <div style="background:#eee;border-radius:4px;height:4px;flex:1;max-width:180px;overflow:hidden"><div style="background:#fb7299;width:'+(d.level.next_exp?Math.round((d.level.current_exp||0)/d.level.next_exp*100):0)+'%;height:100%"></div></div>');
      rows.push('</div>');
    }
    if(d.tasks&&d.tasks.length){
      rows.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px">');
      d.tasks.forEach(function(t){
        var mark=t.done?'✓':'○';
        var color=t.done?'#52c41a':'#bbb';
        var prog=t.progress!=null?' <span class="mini">('+t.progress+(t.key==='coins'?'/5':'')+')</span>':'';
        rows.push('<div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:6px;font-size:13px;display:flex;justify-content:space-between;align-items:center">');
        rows.push('  <span><span style="color:'+color+';font-weight:600">'+mark+'</span> '+t.label+prog+'</span>');
        rows.push('  <span class="mini" style="color:#888">+'+t.exp+'</span>');
        rows.push('</div>');
      });
      rows.push('</div>');
    }
    if(!d.tasks||d.tasks.length===0){
      if(!d.error){
        rows.push('<div class="mini" style="padding:10px;color:#888;text-align:center">暂无经验数据 · 完成 Cookie 登录后自动显示</div>');
      }
    }
    if(d.level||(d.tasks&&d.tasks.length)){
      rows.push('<div class="mini" style="margin-top:8px;text-align:right">今日已拿 <b>'+(d.totalExp||0)+'</b> 经验 '+((d.allDone?'· 🎉 全部完成':(d.tasks&&d.tasks.length?'· 还差一点':'')))+'</div>');
    }
    if(d.warning){
      rows.push('<div class="mini" style="margin-top:6px;color:#faad14">'+d.warning+'</div>');
    }
    box.innerHTML=rows.length?rows.join(''):'查询中...';
  }catch(e){box.textContent='加载失败：'+e.message;}
}

async function loadFollowBox(){
  var box=document.getElementById('follow-box');
  if(!box)return;
  try{
    var d=await fetch('/api/follow/status').then(function(r){return r.json()});
    var color=d.running?'#52c41a':d.enabled?'#faad14':'#ff4d4f';
    var dot=d.running?'●':'○';
    var statusTxt=d.running?'运行中':d.enabled?'已暂停':'已禁用';
    var rows=[];
    rows.push('<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">');
    rows.push('  <span style="color:'+color+';font-size:18px">'+dot+'</span>');
    rows.push('  <span style="font-weight:600">关注守望 · '+statusTxt+'</span>');
    rows.push('</div>');
    rows.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">');
    rows.push('  <div style="padding:6px 10px;background:#f9fafb;border-radius:6px"><div class="mini">开关</div><div style="font-weight:600;color:'+(d.enabled?'#52c41a':'#ff4d4f')+'">'+(d.enabled?'启用':'禁用')+'</div></div>');
    rows.push('  <div style="padding:6px 10px;background:#f9fafb;border-radius:6px"><div class="mini">轮询间隔</div><div style="font-weight:600">'+(d.interval||300)+'s</div></div>');
    rows.push('  <div style="padding:6px 10px;background:#f9fafb;border-radius:6px"><div class="mini">不发评论</div><div style="font-weight:600;color:'+(d.noComment?'#52c41a':'#888')+'">'+(d.noComment?'是':'否')+'</div></div>');
    rows.push('  <div style="padding:6px 10px;background:#f9fafb;border-radius:6px"><div class="mini">仅白名单</div><div style="font-weight:600;color:'+(d.onlyWhitelist?'#52c41a':'#888')+'">'+(d.onlyWhitelist?'是':'否')+'</div></div>');
    rows.push('</div>');
    rows.push('<div style="margin-top:8px;display:flex;gap:8px">');
    rows.push('  <button class="btn ghost" onclick="toggleFollow(' + (d.running ? '\'stop\'' : '\'start\'') + ')">' + (d.running ? '停止' : '启动') + '守望</button>');
    rows.push('</div>');
    box.innerHTML=rows.join('');
  }catch(e){box.textContent='加载失败';}
}

window.toggleFollow=async function(action){
  var r=await fetch('/api/follow/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action})}).then(function(r){return r.json()});
  toast(r.ok?'✓ 已'+(action==='start'?'启动':'停止'):'❌ 操作失败',r.ok?'ok':'error');
  loadFollowBox();
};

async function loadSyncBox(){
  var box=document.getElementById('sync-box');
  var info=document.getElementById('sync-info');
  if(!box)return;
  try{
    var d=await fetch('/api/follow/sync-status').then(function(r){return r.json()});
    if(info)info.textContent='进度 '+d.pct+'%';
    var rows=[];
    rows.push('<div class="sync-progress-wrap">');
    rows.push('  <div class="sync-progress-label">');
    rows.push('    <span>同步进度</span>');
    rows.push('    <span class="mini">'+d.done+' / '+d.total+'</span>');
    rows.push('  </div>');
    rows.push('  <div class="sync-progress-bar"><div style="width:'+d.pct+'%"></div></div>');
    rows.push('</div>');
    rows.push('<div class="sync-chips">');
    rows.push('  <div class="sync-chip sync-chip-done"><div class="mini">成功</div><div class="sync-chip-val">'+d.done+'</div></div>');
    rows.push('  <div class="sync-chip sync-chip-freq"><div class="mini">频率限</div><div class="sync-chip-val">'+(d.freqBlocked||d.failed||0)+'</div></div>');
    rows.push('  <div class="sync-chip sync-chip-perm"><div class="mini">永久错误</div><div class="sync-chip-val">'+(d.permFail||0)+'</div></div>');
    rows.push('  <div class="sync-chip sync-chip-remain"><div class="mini">剩余</div><div class="sync-chip-val">'+d.remaining+'</div></div>');
    rows.push('  <div class="sync-chip sync-chip-today"><div class="mini">今日完成</div><div class="sync-chip-val">'+d.doneToday+'</div></div>');
    if(d.bHad) rows.push('  <div class="sync-chip sync-chip-had"><div class="mini">小号已有关注</div><div class="sync-chip-val">'+d.bHad+'</div></div>');
    rows.push('</div>');
    var hasRecent=(d.recentSuccess&&d.recentSuccess.length)||(d.recentFailures&&d.recentFailures.length);
    if(hasRecent){
      rows.push('<details class="sync-details">');
      rows.push('<summary class="sync-details-summary">📋 今日运行明细</summary>');
      rows.push('<div class="sync-tabs">');
      rows.push('<button type="button" id="sync-tab-ok" onclick="switchSyncTab(\'ok\')" class="sync-tab sync-tab-active">成功 '+(d.recentSuccess?d.recentSuccess.length:0)+'</button>');
      rows.push('<button type="button" id="sync-tab-fail" onclick="switchSyncTab(\'fail\')" class="sync-tab">失败 '+(d.recentFailures?d.recentFailures.length:0)+'</button>');
      rows.push('</div>');
      rows.push('<div id="sync-list-ok">');
      if(d.recentSuccess&&d.recentSuccess.length){
        d.recentSuccess.forEach(function(f){
          rows.push('<div class="sync-item">'+(f.uname||'?')+' <span class="sync-mid">· MID</span> '+f.mid+' <span class="sync-ok">✓</span></div>');
        });
      }else{
        rows.push('<div class="sync-empty">暂无成功记录</div>');
      }
      rows.push('</div>');
      rows.push('<div id="sync-list-fail" style="display:none">');
      if(d.recentFailures&&d.recentFailures.length){
        d.recentFailures.forEach(function(f){
          rows.push('<div class="sync-item">'+(f.uname||'?')+' <span class="sync-mid">· MID</span> '+f.mid+' <span class="sync-fail">'+(f.label||f.code)+'</span></div>');
        });
      }else{
        rows.push('<div class="sync-empty sync-empty-ok">🎉 今日无失败</div>');
      }
      rows.push('</div>');
      rows.push('</details>');
    }
    rows.push('<div class="sync-actions">');
    rows.push('  <button id="btn-sync-run" class="btn btn-primary-solid" style="padding:6px 14px;font-size:13px"><span class="iconfont icon-refresh"></span> 执行同步</button>');
    rows.push('  <span id="btn-sync-status" class="mini sync-status"></span>');
    rows.push('</div>');
    box.innerHTML=rows.join('');
    var btn=document.getElementById('btn-sync-run');
    if(btn){btn.onclick=runFollowSync;checkSyncRunning();}
  }catch(e){box.textContent='加载失败';}
}

async function checkSyncRunning(){
  try{
    var d=await fetch('/api/follow/sync-running').then(function(r){return r.json()});
    var btn=document.getElementById('btn-sync-run');
    var st=document.getElementById('btn-sync-status');
    if(btn){
      if(d.running){btn.disabled=true;btn.classList.add('disabled');btn.querySelector('.iconfont').className='iconfont icon-loading';btn.querySelector('.iconfont').style.animation='spin 1s linear infinite';btn.title='同步进行中'}
      else{btn.disabled=false;btn.classList.remove('disabled');btn.querySelector('.iconfont').className='iconfont icon-refresh';btn.querySelector('.iconfont').style.animation=''}
    }
    if(st)st.textContent=d.running?'运行中 pid='+d.pid:'';
  }catch(e){}
}

async function runFollowSync(){
  var btn=document.getElementById('btn-sync-run');
  if(btn){btn.disabled=true;btn.classList.add('disabled')}
  try{
    var r=await fetch('/api/follow/sync-run?daily=20',{method:'POST'}).then(function(r){return r.json()});
    toast(r.ok?'已启动同步':'❌ '+(r.message||'失败'),r.ok?'ok':'error');
  }catch(e){toast('❌ 请求失败','error')}
  setTimeout(function(){loadSyncBox();},1500);
  checkSyncRunning();
}

async function showTokenChart(){
  var modal=document.getElementById('token-modal');
  var content=document.getElementById('token-chart-content');
  modal.style.display='flex';
  content.textContent='加载中...';
  try{
    var r=await fetch('/tokens');
    var j=await r.json();
    var data=j.history||[];
    if(data.length===0){
      content.innerHTML='<div style="text-align:center;padding:40px;color:var(--c-text-dim)">暂无数据<br><small>分身还没醒过，今天 token 消耗为 0</small></div>';
      return;
    }
    renderTokenChart(data);
  }catch(e){
    content.textContent='加载失败: '+e.message;
  }
}

// --- 导出到全局 ---
window.saveTask = saveTask;
window.editTask = editTask;
window.cancelEdit = cancelEdit;
window.refreshTasks = loadTasks;
window.deleteTask = deleteTask;
window.runTool = runTool;
window.showTokenChart = showTokenChart;
window.toast = toast;
window.switchSyncTab = function(tab) {
  var okBtn = document.getElementById('sync-tab-ok');
  var failBtn = document.getElementById('sync-tab-fail');
  var okList = document.getElementById('sync-list-ok');
  var failList = document.getElementById('sync-list-fail');
  if (!okBtn) return;
  if (tab === 'ok') {
    okBtn.classList.add('sync-tab-active');
    okBtn.classList.remove('sync-tab-fail-active');
    failBtn.classList.remove('sync-tab-active','sync-tab-fail-active');
    okList.style.display = '';
    failList.style.display = 'none';
  } else {
    failBtn.classList.add('sync-tab-fail-active');
    failBtn.classList.remove('sync-tab-active');
    okBtn.classList.remove('sync-tab-active','sync-tab-fail-active');
    okList.style.display = 'none';
    failList.style.display = '';
  }
};
})();