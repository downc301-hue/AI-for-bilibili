(function(){
var _accountsCache=[];
var _accountFormEditingId=null;

function _cloneTpl(id){return document.getElementById(id).content.firstElementChild.cloneNode(true)}

function parseCookieString(str){
  var out={};
  if(!str)return out;
  str.split(';').forEach(function(p){
    var i=p.indexOf('=');if(i<=0)return;
    var k=p.slice(0,i).trim(),v=p.slice(i+1).trim();
    if(k)out[k]=decodeURIComponent(v);
  });
  return out;
}

function loadAccounts(){
  fetch('/api/accounts').then(function(r){return r.json()}).then(function(resp){
    _accountsCache=resp.accounts||[];
    var wrap=document.getElementById('accounts-list');
    if(!wrap)return;
    wrap.innerHTML='';
    if(_accountsCache.length===0){
      wrap.innerHTML='<div class="mini" style="color:#999">账号池为空，点 "新增账号" 添加</div>';
    }else{
      _accountsCache.forEach(function(a){
        var node=_cloneTpl('tpl-account-card');
        node.dataset.id=a.id;
        var active=a.id===resp.activeId;
        if(active)node.classList.add('active');
        var avatarImg=node.querySelector('.ac-avatar');
        var face=a.status?.face||a.face;
        var mid=a.status?.mid||a.mid;
        if(face){avatarImg.src='/api/face?url='+encodeURIComponent(face);avatarImg.style.visibility=''}
        else if(mid){avatarImg.src='/api/face?url='+encodeURIComponent('https://i0.hdslb.com/bfs/face/member/noface.jpg');avatarImg.style.visibility=''}
        else{avatarImg.style.visibility='hidden'}
        avatarImg.onerror=function(){this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'};
        node.querySelector('.ac-label').textContent=(a.label||a.id);
        var roleTag=node.querySelector('.ac-role-tag');
        var roleMap={bot:'[bot]',main:'[主号]',backup:'[备选]'};
        roleTag.textContent=roleMap[a.role]||'';
        var badgeRun=node.querySelector('.ac-badge-run');
        var badgeStop=node.querySelector('.ac-badge-stop');
        var badgeDef=node.querySelector('.ac-badge-default');
        var statusDot=node.querySelector('.ac-status-dot');
        if(active){badgeRun.style.display='';badgeStop.style.display='none';statusDot.style.background='#52c41a'}
        else{badgeRun.style.display='none';badgeStop.style.display='';statusDot.style.background='#bfbfbf'}
        if(a.isDefault){badgeDef.style.display=''}else{badgeDef.style.display='none'}
        var meta=[];
        if(a.status?.uname)meta.push(a.status.uname);
        meta.push('role='+a.role);
        if(!a.status?.ok)meta.push('⚠ 登录异常');
        node.querySelector('.ac-meta').textContent=meta.join(' · ');
        node.querySelector('[data-act="switch"]').onclick=function(){switchAccount(a.id)};
        var btnDef=node.querySelector('[data-act="setdefault"]');
        if(a.isDefault){btnDef.disabled=true;btnDef.classList.add('disabled');btnDef.title='已是默认账号'}
        else{btnDef.onclick=function(){setDefaultAccount(a.id)}}
        node.querySelector('[data-act="edit"]').onclick=function(){openAccountForm(a.id)};
        node.querySelector('[data-act="delete"]').onclick=function(){deleteAccount(a.id)};
        wrap.appendChild(node);
      });
    }

    var activeTagEl=document.getElementById('accounts-active-tag');
    if(activeTagEl){
      var act=_accountsCache.find(function(x){return x.id===resp.activeId});
      if(act&&act.status?.ok){
        activeTagEl.textContent='当前: '+act.status.uname;
        activeTagEl.className='tag';
      }else if(act){
        activeTagEl.textContent='当前: '+act.label+' ⚠';
        activeTagEl.className='tag offline';
      }
    }

    refreshAccountSelects();
    refreshAccountSelectsForStages();
  });
}

function refreshAccountSelects(){
  var selects=['tk-account','tk-restore-account'];
  selects.forEach(function(id){
    var el=document.getElementById(id);
    if(!el)return;
    var cur=el.value;
    el.innerHTML='';
    var defOpt=document.createElement('option');
    defOpt.value='';
    defOpt.textContent=(id==='tk-account'?'默认小号':'执行完毕切回默认');
    el.appendChild(defOpt);
    _accountsCache.forEach(function(a){
      var roleTag={bot:'[bot]',main:'[主号]',backup:'[备选]'}[a.role]||'';
      var opt=document.createElement('option');
      opt.value=a.id;
      opt.textContent=roleTag+' '+(a.label||a.id);
      el.appendChild(opt);
    });
    if(cur)el.value=cur;
  });
}

function refreshAccountSelectsForStages(){
  document.querySelectorAll('.stage-row .stg-account').forEach(function(sel){
    var cur=sel.value;
    sel.innerHTML='';
    var defOpt=document.createElement('option');
    defOpt.value='';
    defOpt.textContent='继承任务账号';
    sel.appendChild(defOpt);
    _accountsCache.forEach(function(a){
      var opt=document.createElement('option');
      opt.value=a.id;
      opt.textContent=(a.label||a.id);
      sel.appendChild(opt);
    });
    if(cur)sel.value=cur;
  });
}

function openAccountForm(id){
  var card=document.getElementById('account-form-card');
  if(!card){toast('请先在配置Tab添加账号表单','error');return}
  card.style.display='block';
  if(id){
    var a=_accountsCache.find(function(x){return x.id===id});
    if(a){
      document.getElementById('account-form-title').textContent='编辑账号: '+(a.label||a.id);
      _accountFormEditingId=id;
      document.getElementById('ac-id').value=a.id;
      document.getElementById('ac-id').disabled=true;
      document.getElementById('ac-role').value=a.role||'bot';
      document.getElementById('ac-label').value=a.label||'';
      document.getElementById('ac-cookie').value='';
    }
  }else{
    document.getElementById('account-form-title').textContent='新增账号';
    _accountFormEditingId=null;
    document.getElementById('ac-id').value='';
    document.getElementById('ac-id').disabled=false;
    document.getElementById('ac-role').value='backup';
    document.getElementById('ac-label').value='';
    document.getElementById('ac-cookie').value='';
  }
  card.scrollIntoView({behavior:'smooth',block:'center'});
}

function closeAccountForm(){
  var card=document.getElementById('account-form-card');
  if(card)card.style.display='none';
  _accountFormEditingId=null;
}

async function saveAccount(){
  var id=document.getElementById('ac-id').value.trim();
  var role=document.getElementById('ac-role').value;
  var label=document.getElementById('ac-label').value.trim()||id;
  var rawCookie=document.getElementById('ac-cookie').value.trim();
  var btn=document.getElementById('ac-btn-save');
  if(!id){toast('请填账号 ID','error',btn);return}

  var existing=_accountsCache.find(function(x){return x.id===id});
  var merged=existing?JSON.parse(JSON.stringify(existing)):{id:id,role:role,label:label};
  merged.role=role;merged.label=label;

  if(rawCookie){
    var parsed=parseCookieString(rawCookie);
    if(!parsed.SESSDATA&&!parsed.sessdata){toast('Cookie 里没找到 SESSDATA','error',btn);return}
    merged.sessdata=parsed.SESSDATA||parsed.sessdata;
    merged.bili_jct=parsed.bili_jct||parsed.BILI_JCT||merged.bili_jct;
    merged.buvid3=parsed.buvid3||parsed.BUVID3||merged.buvid3;
    if(parsed.buvid4)merged.buvid4=parsed.buvid4;
    if(parsed.b_lsid)merged.b_lsid=parsed.b_lsid;
    if(parsed.buvid_fp)merged.buvid_fp=parsed.buvid_fp;
    if(parsed.DedeUserID)merged.mid=parseInt(parsed.DedeUserID);
  }

  var resp=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:_accountFormEditingId?'update':'add',account:merged})}).then(function(r){return r.json()});
  if(resp.ok){toast('账号已保存 ✓','ok',btn);closeAccountForm();loadAccounts()}
  else toast('保存失败','error',btn);
}

async function switchAccount(id){
  var resp=await fetch('/api/accounts/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})}).then(function(r){return r.json()});
  if(resp.ok){toast('已切换账号 ✓','ok');loadAccounts()}
  else toast('切换失败','error');
}

async function setDefaultAccount(id){
  var resp=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set-default',id:id})}).then(function(r){return r.json()});
  if(resp.ok)toast('已设为默认 ✓','ok');
  else toast('设置失败','error');
}

async function deleteAccount(id){
  if(!(await confirmDialog('删除账号','确定删除账号 '+id+' 吗？此操作不可恢复。','删除','取消',true)))return;
  var resp=await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id:id})}).then(function(r){return r.json()});
  if(resp.ok){toast('已移除 ✓','ok');loadAccounts()}
  else toast('删除失败','error');
}

async function switchRestore(){
  var resp=await fetch('/api/accounts/restore',{method:'POST'}).then(function(r){return r.json()});
  if(resp.ok){toast('已恢复默认账号 ✓','ok');loadAccounts()}
  else toast('恢复失败','error');
}

function addStage(){
  var wrap=document.getElementById('tk-stages');
  if(!wrap){toast('找不到多阶段容器','error');return}
  var idx=wrap.children.length;
  var row=_cloneTpl('tpl-stage-row');
  row.querySelector('[data-f="label"]').textContent='阶段 '+(idx+1);
  row.querySelector('[data-act="del-stage"]').onclick=function(){
    row.remove();
    document.querySelectorAll('#tk-stages [data-f="label"]').forEach(function(el,i){el.textContent='阶段 '+(i+1)});
  };
  wrap.appendChild(row);
  refreshAccountSelectsForStages();
}

function collectStages(){
  var rows=document.querySelectorAll('#tk-stages .stage-row');
  if(rows.length===0)return null;
  var list=[];
  rows.forEach(function(row){
    var s={
      name:row.querySelector('.stg-name').value.trim(),
      trigger:row.querySelector('.stg-trigger').value.trim(),
      accountId:row.querySelector('.stg-account').value||undefined,
      targetUrl:row.querySelector('.stg-url').value.trim(),
      template:row.querySelector('.stg-template').value.trim(),
    };
    if(s.name||s.trigger||s.targetUrl||s.template||s.accountId)list.push(s);
  });
  return list.length>0?list:null;
}

document.addEventListener('DOMContentLoaded',function(){
  if(typeof loadAccounts==='function')loadAccounts();
});

window.loadAccounts=loadAccounts;
window.openAccountForm=openAccountForm;
window.closeAccountForm=closeAccountForm;
window.saveAccount=saveAccount;
window.deleteAccount=deleteAccount;
window.switchAccount=switchAccount;
window.refreshAccountSelects=refreshAccountSelects;
window.refreshAccountSelectsForStages=refreshAccountSelectsForStages;
window.parseCookieString=parseCookieString;
window.switchRestore=switchRestore;
window.resetDefault=switchRestore;
window.addStage=addStage;
window.collectStages=collectStages;
})();