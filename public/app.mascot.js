(function(){
(function(){
  var MASCOTS = [
    {id:'doubao',name:'豆包',src:'/mascot/doubao.png'},
    {id:'gpt',name:'GPT',src:'/mascot/gpt.png'},
    {id:'claude',name:'Claude',src:'/mascot/claud.png'},
    {id:'gemini',name:'Gemini',src:'/mascot/gemini.png'},
    {id:'kimi',name:'Kimi',src:'/mascot/kimi.png'},
    {id:'qwen',name:'通义',src:'/mascot/qwen.png'},
    {id:'deepseek',name:'DeepSeek',src:'/mascot/deepseek.png'},
    {id:'yuanbao',name:'元宝',src:'/mascot/yuanbao.png'},
    {id:'hunyuan',name:'混元',src:'/mascot/hunyuan.png'},
    {id:'mistral',name:'Mistral',src:'/mascot/mistral.png'},
    {id:'minimax',name:'MiniMax',src:'/mascot/minimax.png'},
    {id:'gork',name:'Gork',src:'/mascot/gork.png'},
    {id:'xiaomi',name:'小米',src:'/mascot/xiaomi.png'},
    {id:'wxyy',name:'文心',src:'/mascot/wxyy.png'},
    {id:'rwkv',name:'RWKV',src:'/mascot/RWKV.png'}
  ];

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('mascot_cfg') || '{}'); } catch(e) {}
  var cfg = Object.assign({ mascot:'doubao', pos:'sidebar', scale:100, offset:0, x:0, opacity:100 }, saved);

  var mascotEl = document.getElementById('sb-mascot');
  var panel = document.getElementById('mascot-panel');
  var setBtn = document.getElementById('btn-mascot-set');

  function applyMascot() {
    if (!mascotEl) return;
    var m = MASCOTS.find(function(x){return x.id===cfg.mascot}) || MASCOTS[0];
    mascotEl.src = m.src;

    mascotEl.style.transform = 'scale('+(cfg.scale/100)+')';
    mascotEl.style.opacity = cfg.opacity/100;

    if (cfg.pos === 'sidebar') {
      mascotEl.style.position = '';
      mascotEl.style.right = '';
      mascotEl.style.left = '';
      mascotEl.style.top = '';
      mascotEl.style.display = '';
      mascotEl.style.transform = 'translateX(calc(-50% + '+(cfg.x||0)+'px)) translateY('+(cfg.offset||0)+'px) scale('+(cfg.scale/100)+')';
    } else if (cfg.pos === 'float') {
      mascotEl.style.position = 'fixed';
      mascotEl.style.right = (20 + (cfg.x||0)) + 'px';
      mascotEl.style.bottom = (20 + (cfg.offset||0)) + 'px';
      mascotEl.style.left = '';
      mascotEl.style.top = '';
      mascotEl.style.display = '';
      mascotEl.style.zIndex = 999;
      mascotEl.style.transform = 'scale('+(cfg.scale/100)+')';
    } else {
      mascotEl.style.display = 'none';
    }
  }

  function saveCfg() {
    localStorage.setItem('mascot_cfg', JSON.stringify(cfg));
  }

  function renderGrid() {
    var grid = document.getElementById('mp-grid');
    if (!grid) return;
    grid.innerHTML = '';
    MASCOTS.forEach(function(m){
      var div = document.createElement('div');
      div.className = 'mp-item' + (cfg.mascot===m.id?' active':'');
      div.style.cssText = 'border:2px solid '+(cfg.mascot===m.id?'#0ea5e9':'var(--c-border)')+';border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--c-bg2);transition:all .15s;padding:2px';
      div.title = m.name;
      div.innerHTML = '<img src="'+m.src+'" style="width:100%;height:100%;object-fit:contain">';
      div.onclick = function(){ cfg.mascot = m.id; saveCfg(); applyMascot(); renderGrid(); };
      grid.appendChild(div);
    });
  }

  function renderPos() {
    var posEl = document.getElementById('mp-pos');
    if (!posEl) return;
    posEl.querySelectorAll('button').forEach(function(b){
      b.style.background = b.dataset.pos === cfg.pos ? '#1677ff' : '#333';
      b.style.color = b.dataset.pos === cfg.pos ? '#fff' : '#aaa';
    });
  }

  function updateSliderLabels() {
    var sv = document.getElementById('mp-scale-val'); if(sv) sv.textContent = cfg.scale + '%';
    var ov = document.getElementById('mp-offset-val'); if(ov) ov.textContent = cfg.offset + 'px';
    var xv = document.getElementById('mp-x-val'); if(xv) xv.textContent = cfg.x + 'px';
    var pv = document.getElementById('mp-opacity-val'); if(pv) pv.textContent = cfg.opacity + '%';
  }

  if (setBtn) {
    setBtn.onclick = function(e) {
      e.stopPropagation();
      if (!panel) return;
      var hidden = panel.style.display === 'none';
      panel.style.display = hidden ? 'block' : 'none';
      if (hidden) { renderGrid(); renderPos(); updateSliderLabels(); }
    };
  }

  document.addEventListener('click', function(e) {
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(e.target) || (setBtn && setBtn.contains(e.target))) return;
    panel.style.display = 'none';
  });

  document.getElementById('mp-pos')?.querySelectorAll('button').forEach(function(b){
    b.onclick = function(){ cfg.pos = b.dataset.pos; saveCfg(); applyMascot(); renderPos(); };
  });

  ['mp-scale','mp-offset','mp-x','mp-opacity'].forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    var map = { 'mp-scale':'scale', 'mp-offset':'offset', 'mp-x':'x', 'mp-opacity':'opacity' };
    el.value = cfg[map[id]];
    el.oninput = function(){ cfg[map[id]] = parseInt(el.value,10); saveCfg(); applyMascot(); updateSliderLabels(); };
  });

  applyMascot();
})();
})();