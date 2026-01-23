(function () {
  const bell = document.querySelector('[data-admin-notification-bell]');
  if (!bell) return;

  const baseTitle = document.title;
  let currentUnreadCount = 0;
  let titleFlashTimer = null;
  let titleFlashStopTimer = null;

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
  const toastStorageKey = 'visolux:lastToastedAdminNotificationId';

  function getLastToastedId() {
    const raw = window.localStorage ? window.localStorage.getItem(toastStorageKey) : null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function setLastToastedId(id) {
    if (!window.localStorage) return;
    window.localStorage.setItem(toastStorageKey, String(id));
  }

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

  function setTitleForCount(count) {
    currentUnreadCount = count;
    if (titleFlashTimer) return;
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }

  function stopTitleFlash() {
    if (titleFlashTimer) window.clearInterval(titleFlashTimer);
    if (titleFlashStopTimer) window.clearTimeout(titleFlashStopTimer);
    titleFlashTimer = null;
    titleFlashStopTimer = null;
    setTitleForCount(currentUnreadCount);
  }

  function startTitleFlash(count) {
    if (count <= 0) return;
    stopTitleFlash();
    const a = `(${count}) ${baseTitle}`;
    const b = baseTitle;
    let i = 0;
    document.title = a;
    titleFlashTimer = window.setInterval(function () {
      i = (i + 1) % 2;
      document.title = i === 0 ? a : b;
    }, 800);
    titleFlashStopTimer = window.setTimeout(stopTitleFlash, 12000);
  }

  window.addEventListener('focus', stopTitleFlash);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) stopTitleFlash();
  });

  let toastEl = null;

  function removeToast() {
    if (toastEl) toastEl.remove();
    toastEl = null;
  }

  function showToast(latest) {
    if (!latest || !latest.id) return;

    removeToast();

    const root = document.createElement('div');
    root.className = 'flash info admin-notify-toast';
    root.setAttribute('role', 'status');
    root.tabIndex = 0;

    const row = document.createElement('div');
    row.className = 'flash__row';

    const msg = document.createElement('div');
    msg.className = 'flash__msg';

    const title = document.createElement('div');
    title.textContent = latest.title || 'New notification';
    msg.appendChild(title);

    const body = document.createElement('div');
    body.className = 'admin-notify-toast__body';
    body.textContent = latest.body || '';
    if (body.textContent) msg.appendChild(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'flash__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '\u00D7';
    close.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeToast();
    });

    row.appendChild(msg);
    row.appendChild(close);
    root.appendChild(row);

    const openUrl = latest.openUrl || latest.link;
    if (openUrl) {
      root.classList.add('is-clickable');
      root.addEventListener('click', function (e) {
        if (e.target === close) return;
        window.location.href = openUrl;
      });
      root.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          removeToast();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.href = openUrl;
        }
      });
    } else {
      root.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          removeToast();
        }
      });
    }

    document.body.appendChild(root);
    toastEl = root;
  }

  function applyPollData(data) {
    const unreadCountRaw = data && data.unreadCount;
    const unreadNum = Number(unreadCountRaw);
    const unreadCount = Number.isFinite(unreadNum) && unreadNum > 0 ? Math.floor(unreadNum) : 0;
    setCount(unreadCount);
    setTitleForCount(unreadCount);

    const latest = data && data.latest;
    if (!latest || !latest.id) return;

    const lastToasted = getLastToastedId();
    if (Number(latest.id) > lastToasted) {
      showToast(latest);
      startTitleFlash(unreadCount);
      setLastToastedId(Number(latest.id));
    }

    if (!canUseNotifications() || Notification.permission !== 'granted') return;

    const lastNotified = getLastNotifiedId();
    if (Number(latest.id) <= lastNotified) return;

    const notif = new Notification(latest.title || 'New notification', {
      body: latest.body || '',
    });

    notif.onclick = function () {
      try {
        window.focus();
      } catch (_) {
        // ignore
      }
      if (latest.openUrl) window.location.href = latest.openUrl;
      else if (latest.link) window.location.href = latest.link;
    };

    setLastNotifiedId(Number(latest.id));
  }

  async function refresh() {
    try {
      const res = await fetch('/admin/notifications/poll.json', {
        headers: { 'accept': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      applyPollData(data);
    } catch (_) {
      // ignore
    }
  }

  let pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    refresh();
    pollTimer = window.setInterval(refresh, 15000);
  }

  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function startLiveStream() {
    if (typeof window.EventSource === 'undefined') return false;

    try {
      const es = new EventSource('/admin/notifications/stream');

      es.onmessage = function (e) {
        if (!e || !e.data) return;
        try {
          const data = JSON.parse(e.data);
          applyPollData(data);
        } catch (_) {
          // ignore
        }
      };

      es.onerror = function () {
        try {
          es.close();
        } catch (_) {
          // ignore
        }
        startPolling();
      };

      // Stream gives initial state; polling not needed.
      stopPolling();
      return true;
    } catch (_) {
      return false;
    }
  }

  if (!startLiveStream()) startPolling();

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
