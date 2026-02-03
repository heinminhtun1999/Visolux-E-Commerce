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
      const v = window.localStorage.getItem(key);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (_) {
      // ignore
    }

    // Default behavior when there's no saved preference:
    // collapse the sidebar on small screens for a clean mobile layout.
    try {
      return Boolean(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
    } catch (_) {
      return false;
    }
  }

  setCollapsed(getCollapsed());

  btn.addEventListener('click', function () {
    setCollapsed(!document.documentElement.classList.contains('admin-sidebar-collapsed'));
  });
})();
