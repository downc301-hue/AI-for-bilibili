(function(){
function closeTokenChart(){document.getElementById('token-modal').style.display='none'}
function renderTokenChart(data){
  var content=document.getElementById('token-chart-content');
  var W=720,H=280,PL=60,PR=20,PT=20,PB=40;
  var iw=W-PL-PR,ih=H-PT-PB;
  var maxVal=Math.max(...data.map(function(d){return Math.max(d.total||0,d.input||0,d.output||0)}),5000);
  var niceMax=Math.ceil(maxVal/5000)*5000;
  var n=data.length;
  var xStep=n>1?iw/(n-1):0;
  var xOf=function(i){return PL+i*xStep};
  var yOf=function(v){return PT+ih-(v/niceMax*ih)};
  var svg='<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="max-width:720px">';
  for(var i=0;i<=4;i++){
    var y=PT+ih/4*i;
    var v=Math.round(niceMax-niceMax/4*i);
    svg+='<line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#2a2d36" stroke-dasharray="3,3"/>';
    svg+='<text x="'+(PL-8)+'" y="'+(y+4)+'" text-anchor="end" fill="#889" font-size="12">'+(v>=1000?(v/1000).toFixed(0)+'k':v)+'</text>';
  }
  data.forEach(function(d,i){
    var x=xOf(i);
    var shortDate=d.date.slice(5);
    svg+='<text x="'+x+'" y="'+(H-PB+18)+'" text-anchor="middle" fill="#889" font-size="11">'+shortDate+'</text>';
  });
  var colors={input:'#38bdf8',output:'#ff9f43'};
  ['input','output'].forEach(function(key){
    var pts='';
    data.forEach(function(d,i){pts+=xOf(i)+','+yOf(d[key]||0)+' '});
    pts=pts.trim();
    svg+='<polyline points="'+pts+'" fill="none" stroke="'+colors[key]+'" stroke-width="2.5"/>';
    data.forEach(function(d,i){
      var v=d[key]||0;
      var label=key==='input'?'输入':'输出';
      svg+='<circle cx="'+xOf(i)+'" cy="'+yOf(v)+'" r="5" fill="'+colors[key]+'" stroke="#fff" stroke-width="1.5" style="cursor:pointer"><title>'+d.date+' '+label+': '+v.toLocaleString()+' tokens</title></circle>';
    });
  });
  var today=new Date().toLocaleDateString('sv-SE');
  var todayIdx=data.findIndex(function(d){return d.date===today});
  if(todayIdx>=0){
    var xs=xOf(todayIdx);
    var w=xStep||40;
    svg+='<rect x="'+(xs-w/2)+'" y="'+PT+'" width="'+w+'" height="'+ih+'" fill="#0ea5e9" opacity="0.08"/>';
  }
  svg+='</svg>';
  var tot=data.reduce(function(s,d){return s+(d.total||0)},0);
  var calls=data.reduce(function(s,d){return s+(d.apiCalls||0)},0);
  var avgDays=data.length;
  var avg=Math.round(tot/Math.max(avgDays,1));
  content.innerHTML='<div class="chart-summary">'+
    '<div class="mini-stat"><div class="ms-label">总消耗</div><div class="ms-value">'+tot.toLocaleString()+'</div></div>'+
    '<div class="mini-stat"><div class="ms-label">API 调用</div><div class="ms-value">'+calls+'</div></div>'+
    '<div class="mini-stat"><div class="ms-label">有效天数</div><div class="ms-value">'+avgDays+'</div></div>'+
    '<div class="mini-stat"><div class="ms-label">日均</div><div class="ms-value">'+avg.toLocaleString()+'</div></div>'+
    '</div>'+
    '<div class="chart-legend">'+
    '<span><i class="dot" style="background:#38bdf8"></i>输入 (prompt)</span>'+
    '<span><i class="dot" style="background:#ff9f43"></i>输出 (completion)</span>'+
    (todayIdx>=0?'<span style="color:#0ea5e9">▌今日高亮</span>':'')+
    '</div>'+svg;
}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeTokenChart()});

function testCreds(){
  var b=document.getElementById('btn-test-creds');
  var r=document.getElementById('creds-test-result');
  if(!b)return;
  b.disabled=true;b.textContent='测试中...';
  if(r){r.textContent='';r.style.color=''};
  fetch('/api/test-creds',{method:'POST'}).then(function(x){return x.json()}).then(function(d){
    var p=[];
    if(d.doubao)p.push('豆包: '+(d.doubao.ok?'✅':'❌')+' '+(d.doubao.message||'').split('（')[0]);
    if(d.bili)p.push('B站: '+(d.bili.ok?'✅':'❌')+' '+(d.bili.message||''));
    if(r){r.innerHTML=p.join('<br>');r.style.color=(d.doubao?.ok&&d.bili?.ok)?'#52c41a':'#ff4d4f'}
  }).catch(function(e){if(r){r.textContent='请求失败 '+e.message;r.style.color='#ff4d4f'}}).finally(function(){
    b.disabled=false;b.textContent='<span class="iconfont icon-feedback"></span> 测试凭据'
  });
}

async function abortAgent(){
  if(!(await confirmDialog('中止 AI','确定中止 AI？当前工具跑完后收工，不会中断正在执行的操作。','中止','取消',true)))return;
  try{
    await fetch('/api/abort',{method:'POST'});
    toast('中止信号已发送 ✓','ok');
  }catch(e){toast('发送失败','error');}
}

// --- 导出到全局 ---
window.testCreds = testCreds;
window.abortAgent = abortAgent;
window.renderTokenChart = renderTokenChart;
window.closeTokenChart = closeTokenChart;
})();