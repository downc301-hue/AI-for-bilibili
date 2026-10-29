(function(){
(function(){
  function setFS(s){
    var m={sm:'15',md:'19',lg:'24'};
    var p=m[s]||'19';
    localStorage.setItem('fs',p);
    document.documentElement.style.setProperty('--fs-base',p+'px');
    document.querySelectorAll('#btn-fs-sm,#btn-fs-md,#btn-fs-lg').forEach(function(b){b.classList.remove('active')});
    var mp={sm:'btn-fs-sm',md:'btn-fs-md',lg:'btn-fs-lg'};
    var el=document.getElementById(mp[s]);
    if(el)el.classList.add('active');
  }
  function setTheme(t){
    localStorage.setItem('theme',t);
    document.documentElement.setAttribute('data-theme',t);
    var b=document.getElementById('btn-theme');
    if(b)b.innerHTML=t==='light'?'<span class="iconfont icon-night" style="font-size:14px"></span>':'<span class="iconfont icon-sun" style="font-size:14px"></span>';
  }
  var c=localStorage.getItem('fs')||'19';
  if(c==='15')setFS('sm');else if(c==='24')setFS('lg');else setFS('md');
  setTheme(localStorage.getItem('theme')||'dark');
  var s1=document.getElementById('btn-fs-sm');if(s1)s1.onclick=function(){setFS('sm')};
  var s2=document.getElementById('btn-fs-md');if(s2)s2.onclick=function(){setFS('md')};
  var s3=document.getElementById('btn-fs-lg');if(s3)s3.onclick=function(){setFS('lg')};
  var s4=document.getElementById('btn-theme');if(s4)s4.onclick=function(){var n=document.documentElement.getAttribute('data-theme')||'dark';setTheme(n==='dark'?'light':'dark')};
})();
})();