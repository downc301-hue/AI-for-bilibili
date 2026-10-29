(function(){
var _dataView = 'self';
function setDataView(v) {
  _dataView = v;
  document.querySelectorAll('#data-account .seg-btn').forEach(function(b){
    b.classList.toggle('active', b.dataset.acc === v);
  });
  document.querySelectorAll('#eco-tabs .eco-tab').forEach(function(b){
    b.classList.toggle('active', b.dataset.eco === v);
  });
  loadBiliStats();
  loadStatsHistory();
}

function loadSidebarUser(d) {
  var active = d.self || {};
  var unameEl = document.getElementById('bili-uname');
  if (unameEl) {
    if (active.name && active.mid) unameEl.textContent = active.name + ' (UID ' + active.mid + ')';
    else if (active.name) unameEl.textContent = active.name;
    else unameEl.textContent = d.ok ? '' : '未登录';
  }
  var faceEl = document.getElementById('bili-face');
  if (faceEl && active.face) {
    faceEl.referrerPolicy = 'no-referrer';
    faceEl.src = active.face;
    faceEl.onerror = function(){
      if (faceEl.src !== active.face + '?x=' + Date.now()) {
        faceEl.src = active.face + '?x=' + Date.now();
      } else {
        faceEl.src = '/doubao.svg';
      }
    };
  } else if (faceEl) {
    faceEl.src = '/doubao.svg';
  }
  var descEl = document.getElementById('bili-desc');
  if (descEl) {
    if (d.cookieLogin) descEl.textContent = '分身 · 养号中';
    else descEl.textContent = '未登录';
  }
}

async function loadLikeLog(){
  var box=document.getElementById('like-log');
  if(!box)return;
  try{
    var r=await fetch('/api/like-log?days=7').then(function(r){return r.json()});
    var sub=document.getElementById('like-log-sub');
    if(sub)sub.textContent='今日 '+(r.todayCount||0)+' 条（成功 '+(r.todayOk||0)+'）· 近7天 '+(r.totalCount||0);
    var items=r.items||[];
    if(!items.length){box.innerHTML='<div class="empty-tip">暂无点赞记录</div>';return}
    box.innerHTML='';
    var today=new Date();today.setHours(0,0,0,0);
    items.forEach(function(it,i){
      var t=new Date(it.t);
      var isToday=t>=today;
      var hh=String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
      var shortNote=(it.note||'').slice(0,60);
      var node=document.getElementById('tpl-like-item').content.firstElementChild.cloneNode(true);
      node.dataset.href=it.link||'#';
      if(it.success===false){node.classList.add('evt-fail')}
      node.querySelector('.evt-time').textContent=hh;
      var targetEl=node.querySelector('.evt-target');
      targetEl.textContent=it.target||'';
      if(!it.target){targetEl.style.display='none'}
      node.querySelector('.evt-note').textContent=shortNote;
      var dot=node.querySelector('.evt-dot');
      if(isToday){dot.style.display='';dot.textContent='今日'}else{dot.style.display='none'}
      box.appendChild(node);
    });
  }catch(e){box.textContent='加载失败';}
}

function loadBiliStats() {
  fetch('/api/bili-stats').then(function(r){return r.json()}).then(function(d){
    loadSidebarUser(d);
    var cur = _dataView === 'owner' ? d.owner : d.self;
    if (!cur) cur = d.self || d.owner || {};
    var statMap = {
      following: cur.following || 0,
      follower: cur.follower || 0,
      likes: cur.likes || 0,
      at: (cur.unread?.at ?? d.unread?.at) || 0,
      reply: (cur.unread?.reply ?? d.unread?.reply) || 0,
      likeReply: (cur.unread?.likeReply ?? d.unread?.likeReply) || 0,
      coin: cur.coin ?? 0,
      level: cur.level ?? 0,
    };
    Object.keys(statMap).forEach(function(role){
      var card = document.querySelector('.mini-stat[data-role="'+role+'"]');
      if (!card) return;
      var numEl = card.querySelector('.mini-num');
      if (role === 'coin') {
        numEl.textContent = Number(statMap[role]).toFixed(1);
      } else {
        animateNumber(numEl, statMap[role], 1000);
      }
      card.style.display = '';
    });
  }).catch(function(){});
}

function loadStatsHistory() {
  fetch('/api/stats-history').then(function(r){return r.json()}).then(function(d){
    var rows = d.data || [];
    if (!rows.length) return;
    var series = rows.map(function(r){ var side = _dataView === 'owner' ? r.owner : r.self; return { date: r.date, ts: r.ts, s: side || {} }; });
    drawLineChart('chart-follower',  series.map(function(x){return {date:x.date, v:x.s.follower  || 0}}), '#FF6B9D', '#FFE4EC');
    drawLineChart('chart-following', series.map(function(x){return {date:x.date, v:x.s.following || 0}}), '#4ECDC4', '#E0F7F5');
    drawLineChart('chart-likes',     series.map(function(x){return {date:x.date, v:x.s.likes    || 0}}), '#FFB84D', '#FFF1DC');
    var latest = series[series.length - 1].s;
    var summary = document.getElementById('data-summary');
    if (summary && latest) {
      summary.innerHTML = '<span style="color:#999">当前 ' + (_dataView === 'owner' ? '主号' : '分身') + ' 最新数据 →</span>' +
        '<b style="color:#FF6B9D;margin:0 10px">粉丝 ' + (latest.follower || 0) + '</b>' +
        '<b style="color:#4ECDC4;margin:0 10px">关注 ' + (latest.following || 0) + '</b>' +
        '<b style="color:#FFB84D;margin:0 10px">点赞 ' + (latest.likes || 0) + '</b>';
    }
  }).catch(function(){});
}

function drawLineChart(svgId, points, strokeColor, fillColor) {
  var svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';
  if (!points || points.length === 0) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#bbb" font-size="14">暂无历史数据</text>';
    return;
  }
  var W = 600, H = 220;
  var pad = { t: 18, r: 16, b: 30, l: 36 };
  var innerW = W - pad.l - pad.r;
  var innerH = H - pad.t - pad.b;
  var vals = points.map(function(p){ return p.v; });
  var maxV = Math.max.apply(null, vals);
  var minV = Math.min.apply(null, vals);
  if (maxV === minV) { maxV = minV + 1; }
  var yRange = maxV - minV;
  var stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

  function x(i) { return pad.l + i * stepX; }
  function y(v) { return pad.t + innerH - ((v - minV) / yRange) * innerH; }

  var yTicks = 4;
  for (var t = 0; t <= yTicks; t++) {
    var tv = minV + (yRange * t / yTicks);
    var ty = y(tv);
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pad.l); line.setAttribute('x2', W - pad.r);
    line.setAttribute('y1', ty); line.setAttribute('y2', ty);
    line.setAttribute('stroke', '#f0f0f0'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    var lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbl.setAttribute('x', pad.l - 6); lbl.setAttribute('y', ty + 4);
    lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('fill', '#999'); lbl.setAttribute('font-size', '11');
    lbl.textContent = Math.round(tv);
    svg.appendChild(lbl);
  }

  var grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', 'grad-' + svgId);
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  var stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0'); stop1.setAttribute('stop-color', fillColor); stop1.setAttribute('stop-opacity', '0.7');
  grad.appendChild(stop1);
  var stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '1'); stop2.setAttribute('stop-color', fillColor); stop2.setAttribute('stop-opacity', '0.05');
  grad.appendChild(stop2);
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.appendChild(grad); svg.appendChild(defs);

  var pathD = '';
  for (var i = 0; i < points.length; i++) {
    var cx = x(i), cy = y(points[i].v);
    pathD += (i === 0 ? 'M' : 'L') + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ';
  }
  var areaPath = pathD + 'L' + x(points.length - 1).toFixed(1) + ' ' + (H - pad.b) + ' L' + pad.l + ' ' + (H - pad.b) + ' Z';
  var area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('fill', 'url(#grad-' + svgId + ')');
  svg.appendChild(area);

  var linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linePath.setAttribute('d', pathD.trim());
  linePath.setAttribute('fill', 'none');
  linePath.setAttribute('stroke', strokeColor);
  linePath.setAttribute('stroke-width', '2.5');
  linePath.setAttribute('stroke-linecap', 'round');
  linePath.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(linePath);

  for (var i = 0; i < points.length; i++) {
    var cx2 = x(i), cy2 = y(points[i].v);
    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', cx2); dot.setAttribute('cy', cy2);
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', '#fff');
    dot.setAttribute('stroke', strokeColor);
    dot.setAttribute('stroke-width', '2');
    svg.appendChild(dot);

    var valLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    valLbl.setAttribute('x', cx2); valLbl.setAttribute('y', cy2 - 10);
    valLbl.setAttribute('text-anchor', 'middle');
    valLbl.setAttribute('fill', '#333');
    valLbl.setAttribute('font-size', '11');
    valLbl.setAttribute('font-weight', '600');
    valLbl.textContent = points[i].v;
    svg.appendChild(valLbl);

    var dateLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    dateLbl.setAttribute('x', cx2); dateLbl.setAttribute('y', H - pad.b + 16);
    dateLbl.setAttribute('text-anchor', 'middle');
    dateLbl.setAttribute('fill', '#999');
    dateLbl.setAttribute('font-size', '10');
    var dtxt = points[i].date || '';
    if (dtxt.indexOf('/') >= 0) dtxt = dtxt.split('/').slice(1).join('/');
    else if (dtxt.indexOf('-') >= 0) dtxt = dtxt.split('-').slice(1).join('/');
    dateLbl.textContent = dtxt;
    svg.appendChild(dateLbl);
  }
}loadBiliStats();
loadStatsHistory();
loadLikeLog();
if(typeof loadDailyReport==='function')loadDailyReport();
if(typeof loadDailyReport==='function')setInterval(loadDailyReport, 60000);
setInterval(loadBiliStats, 120000);
setInterval(loadStatsHistory, 120000);
setInterval(loadLikeLog, 120000);
document.addEventListener('click', function(e){
  var btn = e.target.closest('#data-account .seg-btn');
  if (btn) { setDataView(btn.dataset.acc); return; }
  var etab = e.target.closest('#eco-tabs .eco-tab');
  if (etab) { setDataView(etab.dataset.eco); return; }
});
document.querySelectorAll('#eco-tabs .eco-tab[data-eco]').forEach(function(b){
  b.classList.toggle('active', b.dataset.eco === _dataView);
});

// ===== 账号管理 =====

// --- 导出到全局 ---
window.setDataView = setDataView;
window.loadBiliStats = loadBiliStats;
window.loadStatsHistory = loadStatsHistory;
window.drawLineChart = drawLineChart;
})();