(function () {
  const key = 'visolux:adminSidebarCollapsed';
  const btn = document.querySelector('[data-admin-sidebar-toggle]');
  if (!btn) return;

  function setCollapsed(collapsed) {
    document.documentElement.classList.toggle('admin-sidebar-collapsed', collapsed);
    try {
      window.localStorage.setItem(key, collapsed ? '1' : '0');
    } catch (_) {
      // ignore
    }
  }

  function getCollapsed() {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch (_) {
      return false;
    }
  }

  setCollapsed(getCollapsed());

  btn.addEventListener('click', function () {
    setCollapsed(!document.documentElement.classList.contains('admin-sidebar-collapsed'));
  });
})();
