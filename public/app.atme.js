(function(){
function _cloneTpl(id){return document.getElementById(id).content.firstElementChild.cloneNode(true)}

async function loadAtMe(){
  var listEl=document.getElementById('at-me-list');
  var badge=document.getElementById('at-me-badge');
  if(!listEl)return;
  listEl.textContent='加载中...';
  if(badge){badge.className='tag offline';badge.textContent='加载中'}
  try{
    var d=await fetch('/api/at-me').then(function(r){return r.json()});
    if(d.error){listEl.innerHTML='<div class="atme-err">'+d.error+'</div>';return}
    var items=d.items||[];
    if(badge){badge.className='tag '+(items.length>0?'online':'offline');badge.textContent=items.length>0?('🐾 '+items.length+' 条未回'):'没有主人的新牵挂'}
    if(items.length===0){listEl.innerHTML='<div class="atme-empty">好钢用在刀刃上——目前没有主人的未处理牵挂</div>';return}
    listEl.innerHTML='';
    var defaultFace='https://i0.hdslb.com/bfs/face/member/noface.jpg';
    items.forEach(function(it){
      var time=new Date(it.at_time*1000);
      var timeStr=time.toLocaleString('zh-CN',{hour12:false});
      var node=_cloneTpl('tpl-atme-card');
      node.dataset.id=it.id;
      var nick=node.querySelector('.atme-nick');
      nick.href='https://www.bilibili.com/video/'+it.bvid;
      nick.textContent=it.nickname;
      node.querySelector('.atme-time').textContent=timeStr;
      var avatarImg=node.querySelector('.atme-avatar');
      var face=it.avatar||defaultFace;
      avatarImg.src='/api/face?url='+encodeURIComponent(face);
      avatarImg.onerror=function(){this.src=defaultFace};
      avatarImg.title=it.nickname||'';
      node.querySelector('.atme-content').textContent=it.content||'(无内容)';
      node.querySelector('.atme-video-link').href='https://www.bilibili.com/video/'+it.bvid+'#reply'+it.source_id;
      var replyBtn=node.querySelector('[data-act="reply"]');
      replyBtn.onclick=function(){replyAtEvent(it.id)};
      replyBtn.id='reply-btn-'+it.id;
      var resBox=document.createElement('div');resBox.id='reply-result-'+it.id;
      node.querySelector('.atme-result').appendChild(resBox);
      listEl.appendChild(node);
    });
  }catch(e){listEl.innerHTML='<div class="atme-err">加载失败: '+e.message+'</div>'}
}

async function replyAtEvent(id){
  var btn=document.getElementById('reply-btn-'+id);
  var resEl=document.getElementById('reply-result-'+id);
  if(!btn)return;
  btn.disabled=true;btn.textContent='生成中...';
  if(resEl)resEl.innerHTML='';
  try{
    var r=await fetch('/api/reply-at',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:String(id)})});
    var d=await r.json();
    if(d.error){if(resEl)resEl.innerHTML='<div class="atme-result-box atme-result-err">❌ '+d.error+'</div>';btn.disabled=false;btn.innerHTML='<span class="iconfont icon-edit-pen"></span> ✨ 一键回复';return}
    if(resEl){
      resEl.innerHTML='<div class="atme-result-box atme-result-ok"><div class="atme-result-head">✅ 已发出：</div><div class="atme-result-msg">'+(d.message||'')+'</div></div>';
    }
    btn.disabled=true;btn.innerHTML='<span class="iconfont icon-done"></span> ✅ 已回复';
    setTimeout(loadAtMe,1500);
  }catch(e){
    if(resEl)resEl.innerHTML='<div class="atme-result-box atme-result-err">❌ '+e.message+'</div>';
    btn.disabled=false;btn.innerHTML='<span class="iconfont icon-edit-pen"></span> ✨ 一键回复';
  }
}

window.loadAtMe = loadAtMe;
window.replyAtEvent = replyAtEvent;
})();