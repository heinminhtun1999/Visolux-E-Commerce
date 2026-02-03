const path = require('path');
const ejs = require('ejs');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function logError(msg) {
  process.stderr.write(msg + '\n');
}

function getBaseLocals(overrides = {}) {
  return {
    // Common locals used across shared layout
    title: 'Smoke Test',
    currentPath: '/',
    currentUrl: '/',
    siteUrl: '',
    siteName: 'Visolux Store',
    siteLogoUrl: '',
    siteOgImageUrl: '',
    navCategories: [],
    breadcrumbs: [],
    flash: null,
    cartItemCount: 0,

    // Auth/admin
    currentUser: null,
    isAdmin: false,
    isSuperAdmin: false,
    adminUnreadNotificationCount: 0,
    adminUnreadContactMessageCount: 0,

    // Footer/contact
    contactInfo: {},
    footerTechnicianSupportUrl: '',
    footerCopyright: '',

    // CSRF
    csrfToken: 'smoke-test-token',

    ...overrides,
  };
}

async function renderTemplate(templateRelPath, locals) {
  const templateAbsPath = path.join(process.cwd(), templateRelPath);
  try {
    await ejs.renderFile(templateAbsPath, locals, {
      async: true,
      rmWhitespace: false,
    });
    log(`PASS render ${templateRelPath}`);
    return true;
  } catch (err) {
    logError(`FAIL render ${templateRelPath}`);
    logError(err && err.stack ? err.stack : String(err));
    return false;
  }
}

function requireModule(moduleRelPath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(path.join(process.cwd(), moduleRelPath));
    log(`PASS require ${moduleRelPath}`);
    return true;
  } catch (err) {
    logError(`FAIL require ${moduleRelPath}`);
    logError(err && err.stack ? err.stack : String(err));
    return false;
  }
}

async function main() {
  let ok = true;

  // Quick sanity: core modules load
  ok = requireModule('src/utils/logger.js') && ok;
  ok = requireModule('src/utils/money.js') && ok;
  ok = requireModule('src/services/payments/fiuu.js') && ok;
  ok = requireModule('src/services/fiuuAccountsService.js') && ok;

  // Shared layout templates
  ok = (await renderTemplate('views/shared/top.ejs', getBaseLocals())) && ok;
  ok = (await renderTemplate('views/shared/bottom.ejs', getBaseLocals())) && ok;
  ok = (await renderTemplate(
    'views/shared/error.ejs',
    getBaseLocals({
      title: 'Smoke Error Page',
      message: 'Smoke test error page render.',
    })
  )) && ok;

  // Admin templates touched recently
  ok = (await renderTemplate(
    'views/admin/settings.ejs',
    getBaseLocals({
      title: 'Admin – Settings',
      currentPath: '/admin/settings',
      currentUrl: '/admin/settings',
      isAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },

      // Admin email notifications
      adminNotifyTo: 'customerservice@arvending.com.my',
      adminNotifyCc: '',

      // Payment gateway (FIUU)
      fiuuAccounts: [],
      fiuuDefaultAccountId: '',
      fiuuCategories: [],
      fiuuCategoryAccountMap: {},
      fiuuEnvFallbackEnabled: false,
      fiuuEnvAccount: null,

      // Other settings sections (keep empty/non-crashing defaults)
      shippingZones: [],
      bankRecipients: [],
      offlineTransferBanks: [],
      offlineTransferDefaultBankId: '',
      offlineTransferEnabled: false,
      promos: [],

      lowStockThreshold: 5,

      technicianSupportUrl: '',
      contactPhone: '',
      contactWhatsapp: '',
      contactEmail: '',
      contactAddress: '',
      contactFacebookUrl: '',

      promosView: 'ACTIVE',
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/admin/payment_settings.ejs',
    getBaseLocals({
      title: 'Admin – Payment',
      currentPath: '/admin/settings/payment',
      currentUrl: '/admin/settings/payment',
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },

      offlineTransferBanks: [],
      fiuuAccounts: [],
      fiuuDefaultAccountId: '',
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/admin/admin_accounts.ejs',
    getBaseLocals({
      title: 'Admin – Admin accounts',
      currentPath: '/admin/admin-accounts',
      currentUrl: '/admin/admin-accounts',
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },

      q: '',
      page: 1,
      pageSize: 25,
      pageCount: 1,
      total: 0,
      admins: [],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/admin/activity.ejs',
    getBaseLocals({
      title: 'Admin – Activity',
      currentPath: '/admin/activity',
      currentUrl: '/admin/activity',
      isAdmin: true,
      isSuperAdmin: false,
      currentUser: { id: 2, email: 'subadmin@example.com', is_admin: 1 },

      q: '',
      method: '',
      actorUserId: '',
      page: 1,
      pageSize: 50,
      pageCount: 1,
      total: 0,
      events: [],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/admin/categories.ejs',
    getBaseLocals({
      title: 'Admin – Categories',
      currentPath: '/admin/categories',
      currentUrl: '/admin/categories',
      isAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },

      total: 0,
      archived: 'ACTIVE',
      categories: [],
      fiuuAccounts: [],
      fiuuSelectableAccounts: [],
      fiuuCategoryAccountMap: {},
    })
  )) && ok;

  if (!ok) {
    process.exitCode = 1;
    return;
  }

  log('Smoke test OK');
}

main().catch((e) => {
  logError(e && e.stack ? e.stack : String(e));
  process.exitCode = 1;
});
