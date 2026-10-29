// === 应用入口 ===
// 功能模块独立在 app.*.js 中，此文件只做版本号加载 + 启动初始化
// 修改某功能时直接编辑对应模块文件即可，不会影响其他模块

(function(){
  document.addEventListener('DOMContentLoaded', function(){
    if (typeof loadAccounts === 'function') loadAccounts();
    if (typeof loadAtMe === 'function') loadAtMe();
    if (typeof loadDiary === 'function') loadDiary();
    if (typeof loadBiliStats === 'function') loadBiliStats();
    if (typeof loadStatsHistory === 'function') loadStatsHistory();

    // 定时刷新运营数据和 @我
    setInterval(function(){
      if (typeof loadBiliStats === 'function') loadBiliStats();
      if (typeof loadAtMe === 'function') loadAtMe();
    }, 120000);
  });
})();