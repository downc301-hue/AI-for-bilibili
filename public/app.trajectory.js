(function(){
var _trajTimer=null;
function _bjTime(s){if(!s)return '';if(typeof s==='string'&&(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)||/^\d{2}:\d{2}:\d{2}$/.test(s)))return s;try{return new Date(s).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}).slice(0,8)}catch{return s||''}}
function _renderTrajectory(d){
  var el=document.getElementById('trajectory-panel');
  if(!el)return;
  var h='';
  var cs=d.currentStatus||{};
  var dot=cs.status==='running'?'<span style="display:inline-block;width:8px;height:8px;background:#52c41a;border-radius:50%;animation:pulse 1s infinite"></span>':'<span style="display:inline-block;width:8px;height:8px;background:#888;border-radius:50%"></span>';
  h+='<div style="padding:10px 14px;background:#16212f;border-bottom:1px solid #333">';
  h+='  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
  h+='    <span style="color:#fff;font-weight:600">'+dot+' 当前状态</span>';
  h+='    <span style="color:#aaa;font-size:11px">'+_bjTime(cs.lastAt)+'</span>';
  h+='  </div>';
  h+='  <div style="color:#38bdf8;font-size:13px">'+(cs.status==='running'?'<span class="iconfont icon-dot" style="color:#52c41a"></span> 在忙 · '+cs.activity:'<span class="iconfont icon-dot" style="color:#888"></span> 空闲中 · 上一次 '+cs.activity||'无记录')+'</div>';
  h+='  <div style="color:#888;font-size:11px;margin-top:3px">'+(cs.detail||'')+'</div>';
  h+='</div>';
  h+='<div style="padding:8px 14px;background:'+(d.followRunning?'#0d2818':'#2a1010')+';border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center">';
  h+='  <span style="font-size:12px;color:'+(d.followRunning?'#52c41a':'#ff7875')+'">'+(d.followRunning?'<span class="iconfont icon-dot" style="color:#52c41a"></span> 关注守望运行中':'<span class="iconfont icon-dot" style="color:#ff4d4f"></span> 关注守望已停止')+'</span>';
  h+='  <span class="iconfont icon-doubao" style="font-size:10px;margin-right:3px;color:#ff6b35"></span><span style="font-size:11px;color:#888">'+(d.whaleMtime?'日记文件最后更新: '+d.whaleMtime:'无日记文件')+'</span>';
  h+='</div>';
  h+='<div style="padding:12px;font-size:12.5px;font-family:monospace;color:#d0d4dc;line-height:1.75">';
  if(d.runs&&d.runs.length){
    h+='<div style="font-weight:700;margin:6px 0 6px;color:#fff"><span class="iconfont icon-trajectory"></span> 活动流水 ('+d.runs.length+')</div>';
    d.runs.slice(-30).reverse().forEach(function(r){
      var t=_bjTime(r.time);
      var ic=r.event==='start'?'<span class="iconfont icon-play"></span>':r.event==='round'?'<span class="iconfont icon-refresh"></span>':r.event==='tool'?'<span class="iconfont icon-settings"></span>':r.event==='done'?'<span class="iconfont icon-done"></span>':r.event==='aborted'?'<span class="iconfont icon-x"></span>':r.event==='api_error'?'<span class="iconfont icon-report"></span>':r.event==='forced'?'<span class="iconfont icon-x"></span>':r.event==='wake'?'<span class="iconfont icon-bell"></span>':r.event==='thought'?'<span class="iconfont icon-message"></span>':r.event==='comment'?'<span class="iconfont icon-edit-pen"></span>':r.event==='feeling'?'<span class="iconfont icon-qa"></span>':r.event==='summary'?'<span class="iconfont icon-history"></span>':'<span class="iconfont icon-plus-circle"></span>';
      var col=r.event==='tool'?'#38bdf8':r.event==='api_error'?'#ff4d4f':r.event==='done'?'#52c41a':r.event==='comment'?'#95de64':r.event==='summary'?'#ffd666':r.event==='wake'?'#36cfc9':'#c9d1d9';
      var detail='';
      if(r.event==='thought'||r.event==='event'||r.event==='summary'){
        detail=r.content||r.note||r.summary||'';
      }else if(r.usage){detail=' usage:'+r.usage.total}
      else if(r.tool){detail=' '+r.tool+' '+(r.args?JSON.stringify(r.args).slice(0,60):'')}
      var _detail=detail||''; if(r.link&&r.target){_detail=_detail.replace(r.target,'<a href="'+r.link+'" target="_blank" style="color:#40a9ff;text-decoration:none">'+r.target+'</a>')} h+='<div style="color:'+col+';margin:2px 0">'+t+' '+ic+' '+_detail+'</div>';
    });
  }
  if(d.tools&&d.tools.length){
    h+='<div style="font-weight:700;margin:12px 0 6px;color:#fff"><span class="iconfont icon-settings"></span> 工具调用</div>';
    d.tools.slice(-15).reverse().forEach(function(t){
      var ti=_bjTime(t.time);
      var col=t.status==='ok'?'#52c41a':t.status==='warn'?'#faad14':'#ff4d4f';
      var _lbl=t.label; if(t.link&&t.target){_lbl=_lbl.replace(t.target,'<a href="'+t.link+'" target="_blank" style="color:#40a9ff;text-decoration:none;font-weight:600">'+t.target+'</a>')} h+='<div style="color:'+col+';margin:2px 0">'+ti+' ['+t.status+'] '+_lbl+': '+t.resultSize+'chars '+t.durationMs+'ms</div>';
    });
  }
  if(!d.runs?.length&&!d.tools?.length)h+='<div style="color:#888">暂无数据</div>';
  h+='</div>';
  el.querySelector('.traj-body').innerHTML=h;
}
function showTrajectory(){
  var el=document.getElementById('trajectory-panel');
  if(!el){
    el=document.createElement('div');
    el.id='trajectory-panel';
    el.style.cssText='position:fixed;right:20px;bottom:20px;width:560px;max-height:720px;background:#1a1b1f;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);z-index:9999;border:1px solid #333;overflow:hidden;display:flex;flex-direction:column;display:none';
    el.innerHTML='<div class="traj-head" style="padding:10px 14px;background:#16212f;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center"><strong style="color:#fff;font-weight:600;font-size:14px"><span class="iconfont icon-track" style="color:#38bdf8;margin-right:6px"></span>AI活动轨迹</strong><button type="button" class="traj-close" onclick="closeTrajectory()" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1;padding:0 4px">×</button></div><div class="traj-body"></div>';
    document.body.appendChild(el);
  }
  el.style.display='flex';
  function load(){
    fetch('/api/trajectory').then(function(x){return x.json()}).then(_renderTrajectory).catch(function(e){var b=el.querySelector('.traj-body');if(b)b.innerHTML='<div style="padding:20px;color:#ff4d4f">加载失败 '+e.message+'</div>'});
  }
  load();
  if(_trajTimer)clearInterval(_trajTimer);
  _trajTimer=setInterval(load,10000);
}
function closeTrajectory(){
  if(_trajTimer){clearInterval(_trajTimer);_trajTimer=null}
  var el=document.getElementById('trajectory-panel');
  if(el)el.style.display='none';
}

fetch('/api/version').then(function(x){return x.json()}).then(function(d){var el=document.getElementById('ver-badge');if(el)el.textContent='v'+(d.version||'?')}).catch(function(){});

// --- 导出到全局 ---
window.showTrajectory = showTrajectory;
window.closeTrajectory = closeTrajectory;
})();