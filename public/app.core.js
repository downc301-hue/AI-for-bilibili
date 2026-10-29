(function(){
function confirmDialog(title,msg,okText,cancelText,danger){
  return new Promise(function(resolve){
    var mask=document.getElementById('confirm-mask');
    if(!mask){resolve(false);return}
    mask.querySelector('[data-f="title"]').textContent=title||'确认';
    mask.querySelector('[data-f="msg"]').textContent=msg||'';
    var okBtn=mask.querySelector('#confirm-ok');
    var cancelBtn=mask.querySelector('#confirm-cancel');
    okBtn.textContent=okText||'确定';
    cancelBtn.textContent=cancelText||'取消';
    okBtn.style.background=danger?'#ff4d4f':'';
    function close(v){mask.style.display='none';okBtn.onclick=null;cancelBtn.onclick=null;resolve(v)}
    okBtn.onclick=function(){close(true)};
    cancelBtn.onclick=function(){close(false)};
    mask.style.display='flex';
  });
}

window.confirmDialog=confirmDialog;

document.querySelectorAll('.tab').forEach(function(t){t.onclick=function(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
  document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('active')});
  t.classList.add('active');
  var pane=document.getElementById('pane-'+t.dataset.tab);
  if(pane)pane.classList.add('active');
  if(t.dataset.tab==='diary'&&typeof loadDiary==='function')loadDiary();
  if(t.dataset.tab==='overview'&&typeof renderDashboard==='function')renderDashboard();
  if(t.dataset.tab==='config'&&typeof loadConfig==='function')loadConfig();
  if(t.dataset.tab==='creds'&&typeof loadAccounts==='function')loadAccounts();
}});

var btnRun=document.getElementById('btn-run');if(btnRun)btnRun.onclick=async function(){
  var btn=document.getElementById('btn-run');
  var log=document.getElementById('run-log');
  var status=document.getElementById('run-status');
  btn.disabled=true;btn.textContent='运行中...';
  status.className='tag online';status.textContent='运行中';
  log.textContent='';
  var es=new EventSource('/run');
  var started=false;
  es.onmessage=function(e){
    var d=JSON.parse(e.data);
    if(d.type==='start'){started=true;log.textContent+='分身开始醒来...\n'}
    else if(d.type==='stdout'){log.textContent+=d.text+'\n';log.classList.add('streaming');log.scrollTop=log.scrollHeight}
    else if(d.type==='stderr'){log.textContent+='[错误] '+d.text+'\n'}
    else if(d.type==='done'){
      log.classList.remove('streaming');
      log.textContent+=('\n完成，退出码: '+d.code+' 于 '+new Date(d.time).toLocaleTimeString()+'\n');
      status.className=d.code===0?'tag online':'tag offline';
      status.textContent=d.code===0?'完成 (码0)':'退出码 '+d.code;
      btn.disabled=false;btn.textContent='唤醒分身';
      es.close();
    }
  };
  es.onerror=function(){if(!started){log.textContent='连接失败，检查服务端口\n';btn.disabled=false;btn.textContent='唤醒分身';es.close()}};
};

async function renderDashboard(){
  var d=await fetch('/api/dashboard').then(function(r){return r.json()});
  if(!d)return;

  var tok=d.todayTokens||0,bud=d.budget||50000,pct=Math.min(100,Math.round(tok/bud*100));
  var bar=document.querySelector('#stat-tokens-bar');
  bar.className='bar'+(pct>95?' crit':pct>80?' warn':'');
  bar.querySelector('div').style.width=pct+'%';
  document.getElementById('stat-tokens-value').textContent=tok.toLocaleString()+' / '+bud.toLocaleString();
  var st=document.getElementById('stat-tokens');
  st.classList.remove('ok','warn','err');
  st.classList.add(tok>bud?'warn':'ok');

  var doubaoSt=document.getElementById('stat-doubao');
  doubaoSt.classList.remove('ok','err');
  doubaoSt.classList.add(d.creds?.doubaoApiKey?'ok':'err');
  doubaoSt.querySelector('.value').textContent=d.creds?.doubaoApiKey?'已配置':'未配置';

  var biliSt=document.getElementById('stat-bili-api');
  if(biliSt){biliSt.classList.remove('ok','err');biliSt.classList.add(d.creds?.sessdata?'ok':'err');biliSt.querySelector('.value').textContent=d.creds?.sessdata?'Cookie OK':'请登录'}

  var descEl=document.getElementById('sb-user-desc');
  if(descEl){
    descEl.textContent=d.noComment?'B站小号 · 养号中':'B站小号 · 正常模式';
  }

  var userSt=document.getElementById('stat-user');
  userSt.classList.remove('ok','err');
  userSt.classList.add(d.bili?.ownerMid?'ok':'err');
  userSt.querySelector('.value').textContent=d.bili?.ownerName||'未设置';

  if(d.latestDiary){
    var card=document.getElementById('latest-diary-card');
    card.style.display='block';
    document.getElementById('latest-diary-title').innerHTML='<span class="iconfont icon-check-in"></span>最新日记 · '+(d.latestDiary.date||'');
    var body=document.getElementById('latest-diary-body');
    var html='<div class="diary-event evt-thought" style="cursor:pointer" onclick="this.classList.toggle(\'expanded\')"><div class="evt-body"><div class="evt-note">'+(d.latestDiary.summary||'...')+'</div></div></div>';
    (d.latestDiary.events||[]).forEach(function(ev){
      var t=ev.target||'';
      var targetHtml='';
      if(t){var href='#';if(/^BV/i.test(t))href='https://www.bilibili.com/video/'+t;else if(/^cv/i.test(t))href='https://www.bilibili.com/read/'+t;else if(/^\d+$/.test(t))href='https://www.bilibili.com/video/av'+t;else if(/^https?:\/\//i.test(t))href=t;targetHtml='<a class="evt-target" href="'+href+'" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">'+t+'</a>';}
      html+='<div class="diary-event evt-'+(ev.kind||'event')+'" style="cursor:pointer" onclick="this.classList.toggle(\'expanded\')"><div class="evt-body"><div class="evt-head"><span class="evt-time">'+(ev.time||'')+'</span>'+targetHtml+'</div><div class="evt-note">'+(ev.note||'')+'</div></div></div>';
    });
    body.innerHTML=html;
  }

  var btnRun=document.getElementById('btn-run');
  var runStatus=document.getElementById('run-status');
  if(btnRun&&runStatus){
    var st=d.agentStatus||'idle';
    if(st==='running'){
      btnRun.disabled=true;btnRun.textContent='运行中...';
      runStatus.className='tag online';runStatus.textContent='运行中';
    }else if(st==='done'){
      btnRun.disabled=false;btnRun.textContent='现在就唤醒';
      runStatus.className='tag online';runStatus.textContent='本轮已完成';
    }else if(st==='forced'){
      btnRun.disabled=false;btnRun.textContent='现在就唤醒';
      runStatus.className='tag offline';runStatus.textContent='达上限收工';
    }else if(st==='aborted'){
      btnRun.disabled=false;btnRun.textContent='现在就唤醒';
      runStatus.className='tag offline';runStatus.textContent='已中止';
    }else{
      btnRun.disabled=false;btnRun.textContent='现在就唤醒';
      runStatus.className='tag offline';runStatus.textContent='待运行';
    }
  }
}

renderDashboard();
if(typeof loadAtMe==='function')loadAtMe();

async function loadConfig(){
  try{
    var c=await fetch('/config').then(function(r){return r.json()});
    if(c.persona){
      var p=c.persona;
      var el=document.getElementById('cf-name');if(el)el.value=p.name||'';
      el=document.getElementById('cf-tags');if(el)el.value=(p.tags||[]).join(', ');
      el=document.getElementById('cf-like');if(el)el.value=((c.preferences||{}).like||[]).join(', ');
      el=document.getElementById('cf-dislike');if(el)el.value=((c.preferences||{}).dislike||[]).join(', ');
      el=document.getElementById('cf-budget');if(el)el.value=(c.budget?.dailyTokens||50000);
      el=document.getElementById('cf-owner-name');if(el)el.value=(c.bili||{}).ownerName||'';
      el=document.getElementById('cf-owner-mid');if(el)el.value=(c.bili||{}).ownerMid||'';
      var creds=c._creds||{};
      var be=document.getElementById('cred-endpoint');if(be)be.value=creds.endpointId||'';
      var bs=document.getElementById('bili-status');if(bs){bs.textContent=creds.biliCookieSet?'Cookie 已配置':'未配置';bs.className='tag '+(creds.biliCookieSet?'online':'offline')}
    }
    var fw=await fetch('/api/fw-config').then(function(r){return r.json()}).catch(function(){return {}});
    var fwEl=document.getElementById('fw-enabled');if(fwEl)fwEl.checked=!!fw.enabled;
    fwEl=document.getElementById('fw-interval');if(fwEl)fwEl.value=fw.interval||300;
    fwEl=document.getElementById('fw-ol');if(fwEl)fwEl.checked=!!fw.onlyWhitelist;
    fwEl=document.getElementById('fw-nc');if(fwEl)fwEl.checked=!!fw.noComment;
    fwEl=document.getElementById('fw-wl');if(fwEl)fwEl.value=(fw.whitelist||[]).join(', ');
    fwEl=document.getElementById('fw-bl');if(fwEl)fwEl.value=(fw.blacklist||[]).join(', ');
    fwEl=document.getElementById('fw-templates');if(fwEl)fwEl.value=(fw.templates||[]).join('\n');
    var fwStatus=document.getElementById('fw-status');
    if(fwStatus){
      var run=fw.running;var en=fw.enabled;
      fwStatus.textContent=en?(run?'运行中':'已启用但未启动'):'未启用';
      fwStatus.className='tag '+(en&&run?'online':'offline');
    }
  }catch(e){console.log('config load err',e)}
}
loadConfig();

var btnSaveP=document.getElementById('btn-save-persona');if(btnSaveP)btnSaveP.onclick=async function(){
  var p={};
  var n=document.getElementById('cf-name').value.trim();if(n)p.name=n;
  var t=document.getElementById('cf-tags').value.trim();if(t)p.tags=t.split(/[,，、\s]+/).filter(Boolean);
  var body={persona:p,preferences:{}};
  var l=document.getElementById('cf-like').value.trim();if(l)body.preferences.like=l.split(/[,，、\s]+/).filter(Boolean);
  var d=document.getElementById('cf-dislike').value.trim();if(d)body.preferences.dislike=d.split(/[,，、\s]+/).filter(Boolean);
  await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('人设已保存');
};
var btnSaveBud=document.getElementById('btn-save-budget');if(btnSaveBud)btnSaveBud.onclick=async function(){
  var body={budget:{dailyTokens:parseInt(document.getElementById('cf-budget').value)||50000}};
  await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('预算已保存');
  renderDashboard();
};
var btnSaveC=document.getElementById('btn-save-owner');if(btnSaveC)btnSaveC.onclick=async function(){
  var body={bili:{}};
  var n=document.getElementById('cf-owner-name').value.trim();if(n)body.bili.ownerName=n;
  var m=document.getElementById('cf-owner-mid').value.trim();if(m)body.bili.ownerMid=m;
  await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('已保存');renderDashboard();
};

var diaryAutoCb=document.getElementById('diary-auto-cb');
var diaryAutoTag=document.getElementById('diary-auto-tag');
if(diaryAutoCb){
  (async function(){
    var cfg=await fetch('/config').then(function(r){return r.json()});
    var auto=cfg.diary?cfg.diary.auto!==false:true;
    diaryAutoCb.checked=auto;
    if(diaryAutoTag){
      diaryAutoTag.textContent=auto?'自动日记：开':'自动日记：关';
      diaryAutoTag.className='tag '+(auto?'online':'offline');
    }
  })();
  diaryAutoCb.onchange=async function(){
    var body={diary:{auto:diaryAutoCb.checked}};
    await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(diaryAutoTag){
      diaryAutoTag.textContent=diaryAutoCb.checked?'自动日记：开':'自动日记：关';
      diaryAutoTag.className='tag '+(diaryAutoCb.checked?'online':'offline');
    }
    toast('自动日记已'+(diaryAutoCb.checked?'开启':'关闭'),'ok');
  };
}
var btnGenDiary=document.getElementById('btn-gen-diary');
if(btnGenDiary){
  btnGenDiary.onclick=async function(){
    btnGenDiary.disabled=true;btnGenDiary.textContent='正在生成...';
    var resultDiv=document.getElementById('diary-gen-result');
    try{
      var r=await fetch('/api/generate-diary',{method:'POST'}).then(function(r){return r.json()});
      if(r.ok){
        btnGenDiary.textContent='✨ 生成完成！';
        resultDiv.style.display='block';
        resultDiv.style.color='#52c41a';
        resultDiv.textContent='已写入 '+r.count+' 条日记事件。'+(r.note||'');
        toast('日记生成成功 ✓','ok');
        setTimeout(function(){btnGenDiary.disabled=false;btnGenDiary.textContent='✨ 生成今日日记总结';loadDiary();},2000);
      }else{
        throw new Error(r.error||'生成失败');
      }
    }catch(e){
      btnGenDiary.disabled=false;btnGenDiary.textContent='✨ 生成今日日记总结';
      resultDiv.style.display='block';resultDiv.style.color='#ff4d4f';resultDiv.textContent=e.message;
      toast('生成失败：'+e.message,'error');
    }
  };
}

var btnSaveFW=document.getElementById('btn-save-fw');if(btnSaveFW)btnSaveFW.onclick=async function(){
  var body={
    enabled:document.getElementById('fw-enabled').checked,
    interval:document.getElementById('fw-interval').value,
    onlyWhitelist:document.getElementById('fw-ol').checked,
    noComment:document.getElementById('fw-nc').checked,
    whitelist:document.getElementById('fw-wl').value,
    blacklist:document.getElementById('fw-bl').value,
    templates:document.getElementById('fw-templates').value,
  };
  await fetch('/follow-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('关注守望已保存并重启');location.reload();
};
window.testFollowFetch=async function(){
  var r=await fetch('/follow-test').then(function(r){return r.json()});
  var items=r.items||[];
  var msg='';
  if(items.length>0){
    msg='API OK! '+items.length+' feeds:\n';
    items.slice(0,5).forEach(function(i){msg+='  '+i.pub+' '+i.up+'('+i.mid+') '+i.title+' BV='+i.bvid+'\n'});
  }else{
    msg='API returned: '+(r.error||'empty, cookie expired?');
  }
  alert(msg);
};
var d=document.getElementById('btn-save-doubao');if(d)d.onclick=async function(){
  var k=document.getElementById('cred-doubao-key').value;
  var e=document.getElementById('cred-endpoint').value;
  if(!k&&!e){alert('请至少填一项');return}
  await fetch('/creds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({doubaoApiKey:k,doubaoEndpointId:e})});
  alert('豆包凭据已保存');location.reload();
};
var bi=document.getElementById('btn-save-bili');if(bi)bi.onclick=async function(){
  var cookie=document.getElementById('cred-bili-cookie').value;
  if(!cookie.trim()){alert('请粘贴 Cookie');return}
  await fetch('/creds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({biliCookie:cookie})});
  alert('B站 Cookie 已保存');location.reload();
};

async function loadDiary(){
  var list=document.getElementById('diary-list');
  if(!list)return;
  list.innerHTML='<p class="mini">加载中...</p>';
  try{
    var KIND_LABEL={wake:'醒来',thought:'想法',feeling:'心情',action:'动作',comment:'评论',summary:'总结',event:'事件'};
    var diary=await fetch('/diary').then(function(r){return r.json()});
    if(!Array.isArray(diary)||diary.length===0){list.innerHTML='<p class="mini">还没有日记，唤醒分身一次就会有了~</p>';return}
    list.innerHTML=diary.slice().reverse().map(function(d){
      var evts=(d.events||[]).map(function(ev){
        var cls='evt-'+(ev.kind||'event');
        var label=KIND_LABEL[ev.kind]||ev.kind||'事件';
        var targetHtml='';
        if(ev.target){
          var t=ev.target;
          var href='#';
          if(/^BV/i.test(t))href='https://www.bilibili.com/video/'+t;
          else if(/^cv/i.test(t))href='https://www.bilibili.com/read/'+t;
          else if(/^\d+$/.test(t))href='https://www.bilibili.com/video/av'+t;
          else if(/^https?:\/\//i.test(t))href=t;
          targetHtml='<a class="evt-target" href="'+href+'" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">'+t+'</a>';
        }
        return '<div class="diary-event '+cls+'" style="cursor:pointer" onclick="this.classList.toggle(\'expanded\')">'+
          '<span class="evt-tag">'+label+'</span>'+
          '<div class="evt-body">'+
            '<div class="evt-head">'+
              '<span class="evt-time">'+(ev.time||'')+'</span>'+
              targetHtml+
            '</div>'+
            '<div class="evt-note">'+(ev.note||'')+'</div>'+
          '</div>'+
        '</div>';
      }).join('');
      return '<div class="diary-day">'+
        '<div class="diary-date">'+d.date+' <span class="mini">'+(d.summary||'')+'</span></div>'+
        evts+
      '</div>';
    }).join('');
  }catch(e){
    list.innerHTML='<p class="mini" style="color:#ff4d4f">加载失败：'+e.message+'</p>';
  }
}
loadDiary();

var btnRunDaily=document.getElementById('btn-run-daily');if(btnRunDaily)btnRunDaily.onclick=async function(){
  await fetch('/run-daily',{method:'POST'});
  alert('已触发日常唤醒');
};

// --- 导出到全局 ---
window.loadDiary = loadDiary;
window.renderDashboard = renderDashboard;
window.loadConfig = loadConfig;
})();