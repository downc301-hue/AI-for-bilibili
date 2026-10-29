(function(){
  var LOGOS = [
    {id:'doubao',name:'豆包',src:'/logo/doubao.png'},
    {id:'gpt',name:'GPT',src:'/logo/gpt.png'},
    {id:'claude',name:'Claude',src:'/logo/claude.png'},
    {id:'gemini',name:'Gemini',src:'/logo/gemini.png'},
    {id:'kimi',name:'Kimi',src:'/logo/kimi.png'},
    {id:'qwen',name:'通义千问',src:'/logo/qwen.png'},
    {id:'deepseek',name:'DeepSeek',src:'/logo/deepseek.png'},
    {id:'meta',name:'Meta',src:'/logo/meta.png'},
    {id:'hunyuan',name:'腾讯混元',src:'/logo/hunyuan.png'},
    {id:'mistral',name:'Mistral',src:'/logo/mistral.png'},
    {id:'minimax',name:'MiniMax',src:'/logo/minimax.png'},
    {id:'grok',name:'Grok',src:'/logo/grok.png'},
    {id:'xiaomi',name:'小米',src:'/logo/xiaomi.png'},
    {id:'wxyy',name:'文心一言',src:'/logo/wxyy.png'},
    {id:'rwkv',name:'RWKV',src:'/logo/rwkv.png'}
  ];

  var DEFAULTS = { name: '豆包 B站分身', logo: '/doubao.svg' };

  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('brand_cfg') || '{}'); } catch(e) {}
  cfg = Object.assign({ name: DEFAULTS.name, logo: DEFAULTS.logo }, cfg);

  var sbLogo = document.getElementById('sb-logo');
  var sbName = document.getElementById('sb-name');
  var brandPanel = document.getElementById('brand-panel');
  var brandBtn = document.getElementById('btn-brand-set');
  var nameInput = document.getElementById('brand-name-input');
  var logoImg = document.getElementById('brand-logo-img');
  var logoPlaceholder = document.getElementById('brand-logo-placeholder');
  var logoGrid = document.getElementById('brand-logo-grid');
  var logoUpload = document.getElementById('brand-logo-upload');
  var logoReset = document.getElementById('brand-logo-reset');
  var logoSelected = document.getElementById('brand-logo-selected');

  var obOverlay = document.getElementById('brand-onboarding');
  var obClose = document.getElementById('brand-onboarding-close');
  var obNameInput = document.getElementById('ob-name-input');
  var obNamePreview = document.getElementById('ob-name-preview');
  var obLogoImg = document.getElementById('ob-logo-img');
  var obLogoDefault = document.getElementById('ob-logo-default');
  var obLogoGrid = document.getElementById('ob-logo-grid');
  var obLogoUpload = document.getElementById('ob-logo-upload');
  var obLogoReset = document.getElementById('ob-logo-reset');
  var obBtnDone = document.getElementById('ob-btn-done');
  var obBtnLater = document.getElementById('ob-btn-later');
  var heroChip = document.getElementById('hero-brand-chip');
  var cfgBrandLogo = document.getElementById('cfg-brand-logo');
  var cfgBrandName = document.getElementById('cfg-brand-name');
  var cfgBrandHint = document.getElementById('cfg-brand-hint');
  var btnBrandOnboarding = document.getElementById('btn-brand-onboarding');

  function apply() {
    if (sbLogo) sbLogo.src = cfg.logo || DEFAULTS.logo;
    if (sbName) sbName.textContent = cfg.name || DEFAULTS.name;
    try { document.title = (cfg.name || DEFAULTS.name) + ' · 控制台'; } catch(e) {}
    var isDefault = !cfg.logo || cfg.logo === DEFAULTS.logo;
    if (cfgBrandLogo) {
      cfgBrandLogo.style.display = isDefault ? 'none' : '';
      if (!isDefault) cfgBrandLogo.src = cfg.logo;
    }
    if (cfgBrandName) cfgBrandName.textContent = cfg.name || DEFAULTS.name;
    if (cfgBrandHint) cfgBrandHint.textContent = isDefault ? '当前：默认品牌' : '当前：自定义品牌';
  }

  function save() {
    localStorage.setItem('brand_cfg', JSON.stringify(cfg));
    apply();
  }

  function renderLogoPreview() {
    if (!logoImg || !logoPlaceholder) return;
    var isDefault = !cfg.logo || cfg.logo === DEFAULTS.logo;
    logoImg.style.display = isDefault ? 'none' : '';
    logoPlaceholder.style.display = isDefault ? '' : 'none';
    if (!isDefault) logoImg.src = cfg.logo;
    if (nameInput && nameInput.value !== (cfg.name || '')) nameInput.value = cfg.name || '';
  }

  function renderLogoGrid() {
    if (!logoGrid) return;
    logoGrid.innerHTML = '';
    LOGOS.forEach(function(m){
      var selected = cfg.logo === m.src;
      var div = document.createElement('div');
      div.style.cssText = 'width:36px;height:36px;border:2px solid ' + (selected ? '#0ea5e9' : 'var(--c-border)') + ';border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--c-bg2);transition:all .15s';
      div.title = m.name;
      div.innerHTML = '<img src="' + m.src + '" style="width:100%;height:100%;object-fit:contain">';
      div.onclick = function(){ cfg.logo = m.src; renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save(); };
      logoGrid.appendChild(div);
    });
  }

  function openPanel() {
    if (!brandPanel) return;
    brandPanel.style.display = 'block';
    renderLogoPreview();
    renderLogoGrid();
  }

  function closePanel() {
    if (!brandPanel) return;
    brandPanel.style.display = 'none';
  }

  if (brandBtn) {
    brandBtn.onclick = function(e) {
      e.stopPropagation();
      if (brandPanel && brandPanel.style.display === 'block') closePanel();
      else {
        var mp = document.getElementById('mascot-panel');
        if (mp) mp.style.display = 'none';
        openPanel();
      }
    };
  }

  document.addEventListener('click', function(e) {
    if (!brandPanel || brandPanel.style.display !== 'block') return;
    if (brandPanel.contains(e.target)) return;
    if (brandBtn && brandBtn.contains(e.target)) return;
    closePanel();
  });

  if (nameInput) {
    nameInput.oninput = function() {
      cfg.name = nameInput.value.trim() || DEFAULTS.name;
      save();
      renderObPreview();
    };
  }

  if (logoReset) {
    logoReset.onclick = function() {
      cfg.logo = DEFAULTS.logo;
      renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save();
    };
  }

  if (logoUpload) {
    logoUpload.onchange = function(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 500 * 1024) { alert('图片超过 500KB，请压缩后再上传'); return; }
      var reader = new FileReader();
      reader.onload = function(ev) {
        cfg.logo = ev.target.result;
        renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save();
      };
      reader.readAsDataURL(file);
      logoUpload.value = '';
    };
  }

  function renderObPreview() {
    if (!obLogoImg || !obLogoDefault || !obNamePreview) return;
    var isDefault = !cfg.logo || cfg.logo === DEFAULTS.logo;
    obLogoImg.style.display = isDefault ? 'none' : '';
    obLogoDefault.style.display = isDefault ? '' : 'none';
    if (!isDefault) obLogoImg.src = cfg.logo;
    obNamePreview.textContent = cfg.name || DEFAULTS.name;
    if (obNameInput && obNameInput.value !== (cfg.name || '')) obNameInput.value = cfg.name || '';
  }

  function renderObGrid() {
    if (!obLogoGrid) return;
    obLogoGrid.innerHTML = '';
    LOGOS.forEach(function(m){
      var selected = cfg.logo === m.src;
      var div = document.createElement('div');
      div.style.cssText = 'aspect-ratio:1;border:2px solid ' + (selected ? '#0ea5e9' : 'var(--c-border)') + ';border-radius:10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--c-bg3);transition:all .15s;padding:4px';
      div.title = m.name;
      div.innerHTML = '<img src="' + m.src + '" style="width:60%;height:55%;object-fit:contain"><div style="font-size:11px;color:var(--c-text-dim);text-align:center;margin-top:6px;line-height:1.1">' + m.name + '</div>';
      div.onclick = function(){ cfg.logo = m.src; renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save(); };
      obLogoGrid.appendChild(div);
    });
  }

  function openOnboarding() {
    if (!obOverlay) return;
    renderObPreview();
    renderObGrid();
    renderLogoGrid();
    renderLogoPreview();
    obOverlay.style.display = 'flex';
  }

  function closeOnboarding() {
    if (!obOverlay) return;
    obOverlay.style.display = 'none';
  }

  function markOnboardingDone() {
    localStorage.setItem('brand_onboarding_done', '1');
  }

  if (obClose) obClose.onclick = function() { markOnboardingDone(); closeOnboarding(); };
  if (obBtnLater) obBtnLater.onclick = function() { markOnboardingDone(); closeOnboarding(); };
  if (obBtnDone) obBtnDone.onclick = function() {
    cfg.name = (obNameInput && obNameInput.value.trim()) || cfg.name || DEFAULTS.name;
    save();
    markOnboardingDone();
    closeOnboarding();
  };

  if (obNameInput) {
    obNameInput.oninput = function() {
      cfg.name = obNameInput.value.trim() || DEFAULTS.name;
      obNamePreview.textContent = cfg.name;
      save();
    };
  }

  if (obLogoReset) obLogoReset.onclick = function() {
    cfg.logo = DEFAULTS.logo;
    renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save();
  };

  if (obLogoUpload) {
    obLogoUpload.onchange = function(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 500 * 1024) { alert('图片超过 500KB，请压缩后再上传'); return; }
      var reader = new FileReader();
      reader.onload = function(ev) {
        cfg.logo = ev.target.result;
        renderLogoGrid(); renderLogoPreview(); renderObPreview(); renderObGrid(); save();
      };
      reader.readAsDataURL(file);
      obLogoUpload.value = '';
    };
  }

  document.addEventListener('click', function(e) {
    if (!obOverlay || obOverlay.style.display !== 'flex') return;
    if (e.target === obOverlay) { markOnboardingDone(); closeOnboarding(); }
  });

  if (heroChip) heroChip.onclick = function() { openOnboarding(); };
  if (btnBrandOnboarding) btnBrandOnboarding.onclick = function() { openOnboarding(); };

  apply();

  window.addEventListener('load', function() {
    var done = localStorage.getItem('brand_onboarding_done');
    if (!done) {
      var hasCustom = localStorage.getItem('brand_cfg');
      if (!hasCustom) {
        setTimeout(openOnboarding, 600);
      } else {
        localStorage.setItem('brand_onboarding_done', '1');
      }
    }
  });
})();