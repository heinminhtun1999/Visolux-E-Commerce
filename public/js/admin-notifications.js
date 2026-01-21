(function () {
  const bell = document.querySelector('[data-admin-notification-bell]');
  if (!bell) return;

  // If the admin opens a notification then navigates back, browsers may show a cached
  // version of the notifications list (so it still looks unread). Force a refresh.
  if (window.location && window.location.pathname === '/admin/notifications') {
    window.addEventListener('pageshow', function (e) {
      if (e && e.persisted) window.location.reload();
    });

    const table = document.querySelector('table.table');
    if (table) {
      table.addEventListener('click', function (e) {
        const target = e.target;
        if (!(target instanceof Element)) return;

        // Let normal interactions behave normally.
        if (target.closest('a, button, input, select, textarea, label, form')) return;

        const row = target.closest('tr[data-open-url]');
        if (!row) return;

        const openUrl = row.getAttribute('data-open-url');
        if (openUrl) window.location.href = openUrl;
      });
    }
  }

  const enableBtn = document.querySelector('[data-enable-desktop-notifications]');
  const storageKey = 'visolux:lastNotifiedAdminNotificationId';

  function getLastNotifiedId() {
    const raw = window.localStorage ? window.localStorage.getItem(storageKey) : null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function setLastNotifiedId(id) {
    if (!window.localStorage) return;
    window.localStorage.setItem(storageKey, String(id));
  }

  function canUseNotifications() {
    return typeof window.Notification !== 'undefined';
  }

  async function ensurePermissionFromUserGesture() {
    if (!canUseNotifications()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const p = await Notification.requestPermission();
      return p;
    } catch (_) {
      return Notification.permission;
    }
  }

  function setCount(unreadCount) {
    const n = Number(unreadCount);
    const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

    let badge = bell.querySelector('.btn-badge');
    if (count <= 0) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'btn-badge';
      bell.appendChild(badge);
    }
    badge.textContent = String(count);
    badge.setAttribute('aria-label', `${count} unread`);
  }

  async function refresh() {
    try {
      const res = await fetch('/admin/notifications/poll.json', {
        headers: { 'accept': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();

      const unreadCount = data && data.unreadCount;
      setCount(unreadCount);

      const latest = data && data.latest;
      if (!latest || !latest.id) return;
      if (!canUseNotifications() || Notification.permission !== 'granted') return;

      const lastNotified = getLastNotifiedId();
      if (Number(latest.id) <= lastNotified) return;

      const n = new Notification(latest.title || 'New notification', {
        body: latest.body || '',
      });

      n.onclick = function () {
        try {
          window.focus();
        } catch (_) {
          // ignore
        }
        if (latest.openUrl) window.location.href = latest.openUrl;
        else if (latest.link) window.location.href = latest.link;
      };

      setLastNotifiedId(Number(latest.id));
    } catch (_) {
      // ignore
    }
  }

  refresh();
  window.setInterval(refresh, 15000);

  if (enableBtn) {
    enableBtn.addEventListener('click', async function () {
      const p = await ensurePermissionFromUserGesture();
      if (p === 'granted') {
        try {
          new Notification('Desktop notifications enabled', { body: 'You will be notified for new orders while this admin page is open.' });
        } catch (_) {
          // ignore
        }
        refresh();
      }
    });
  }
})();
