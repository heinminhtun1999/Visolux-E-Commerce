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

    // CSP nonce (required for inline scripts)
    cspNonce: 'smoke-test-nonce',

    // View helpers (normally provided via app locals)
    icon: () => '',
    formatMoney: (value) => {
      const n = Number(value || 0);
      const safe = Number.isFinite(n) ? n : 0;
      return `RM ${safe.toFixed(2)}`;
    },
    formatDateTime: (value) => {
      const d = value ? new Date(value) : null;
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toISOString();
    },

    paymentMethodLabel: (method) => (
      String(method || '').toUpperCase() === 'OFFLINE_TRANSFER' ? 'Offline bank transfer' : 'Online payment'
    ),
    paymentChannelLabel: (order) => {
      if (!order || String(order.payment_method || '').toUpperCase() === 'OFFLINE_TRANSFER') return '';
      return String(order.payment_channel || '').trim();
    },
    paymentSummaryLabel: (order) => {
      if (!order) return '';
      const method = String(order.payment_method || '').toUpperCase();
      if (method === 'OFFLINE_TRANSFER') return 'Offline bank transfer';
      const ch = String(order.payment_channel || '').trim();
      return ch ? `Online payment (${ch})` : 'Online payment';
    },
    sanitizeStatusHistoryNote: (note) => String(note || ''),

    // Backups
    backupsDir: '',
    backups: [],
    backupsError: null,
    backupsRetentionDays: 7,

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

  // Generic site pages (privacy/terms/data deletion all use this template)
  ok = (await renderTemplate(
    'views/site/page.ejs',
    getBaseLocals({
      title: 'Site Page',
      currentPath: '/privacy',
      currentUrl: '/privacy',
      pageTitle: 'Privacy',
      html: '<p>Smoke test page.</p>',
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
      isSuperAdmin: true,
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

      // Backups
      backupsDir: '',
      backups: [],
      backupsError: null,
      backupsRetentionDays: 7,
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/admin/backups.ejs',
    getBaseLocals({
      title: 'Admin – Backups',
      currentPath: '/admin/backups',
      currentUrl: '/admin/backups',
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },

      backupsDir: 'backups',
      backups: [],
      backupsError: null,
      backupsRetentionDays: 7,
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

  ok = (await renderTemplate(
    'views/admin/product_form.ejs',
    getBaseLocals({
      title: 'Edit product',
      currentPath: '/admin/products/1/edit',
      currentUrl: '/admin/products/1/edit',
      isAdmin: true,
      currentUser: { id: 1, email: 'admin@example.com', is_admin: 1 },
      product: {
        product_id: 1,
        name: 'Test product',
        description: 'Test description',
        description_html: '',
        category: 'lighting',
        price: 1234,
        cost_price: null,
        stock: 5,
        weight_kg: null,
        height_cm: null,
        length_cm: null,
        width_cm: null,
        visibility: 1,
        archived: 0,
        product_image: '/public/placeholder.svg',
      },
      categories: [{ slug: 'lighting', name: 'Lighting' }],
      images: [],
      variants: [
        { variant_id: 10, product_id: 1, type_key: 'SHOPEE', label: 'Shopee', price: 1500, stock: 3, image_url: '/public/placeholder.svg', active: true, sort_order: 0 },
      ],
    })
  )) && ok;

  // Storefront templates (UI redesign targets)
  ok = (await renderTemplate(
    'views/home.ejs',
    getBaseLocals({
      title: 'Home',
      currentPath: '/',
      currentUrl: '/',
      categories: [
        { slug: 'lighting', name: 'Lighting', image_url: '' },
        { slug: 'electronics', name: 'Electronics', image_url: '' },
      ],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/shop/products.ejs',
    getBaseLocals({
      title: 'Products',
      currentPath: '/products',
      currentUrl: '/products',

      q: '',
      category: '',
      availability: '',
      min_price: '',
      max_price: '',
      sort: '',
      pageSize: 12,
      page: 1,
      pageCount: 1,
      total: 1,

      categories: [{ slug: 'lighting', name: 'Lighting' }],
      categorySections: [],

      products: [
        {
          product_id: 1,
          name: 'Test product',
          category: 'lighting',
          category_name: 'Lighting',
          price: 12.34,
          product_image: '/public/placeholder.svg',
          stock: 5,
          available_stock: 5,
        },
      ],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/shop/product.ejs',
    getBaseLocals({
      title: 'Product',
      currentPath: '/products/1',
      currentUrl: '/products/1',

      product: {
        product_id: 1,
        name: 'Test product',
        category: 'lighting',
        category_name: 'Lighting',
        price: 12.34,
        description: 'Test description',
        description_html: '',
        product_image: '/public/placeholder.svg',
        stock: 5,
        available_stock: 5,
      },
      images: [],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/shop/cart.ejs',
    getBaseLocals({
      title: 'Cart',
      currentPath: '/cart',
      currentUrl: '/cart',

      cart: {
        items: [
          {
            quantity: 1,
            subtotal: 12.34,
            available_stock: 5,
            key: 'p:1',
            product: {
              product_id: 1,
              name: 'Test product',
              category: 'lighting',
              category_name: 'Lighting',
              price: 12.34,
            },
          },
        ],
        total: 12.34,
      },
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/orders/checkout.ejs',
    getBaseLocals({
      title: 'Checkout',
      currentPath: '/checkout',
      currentUrl: '/checkout',

      cart: {
        items: [
          {
            quantity: 1,
            subtotal: 12.34,
            product: {
              name: 'Test product',
              price: 12.34,
              weight_kg: 0.5,
            },
          },
        ],
        total: 12.34,
      },

      malaysiaStates: ['Selangor'],
      prefill: {
        customer_name: 'Test User',
        phone: '0123456789',
        email: 'test@example.com',
        address_line1: '123 Test Street',
        address_line2: '',
        city: 'Shah Alam',
        state: 'Selangor',
        postcode: '40100',
      },

      canOnlinePay: true,
      offlineTransferBanks: [],
      prefillShippingFee: 0,
      prefillShippingLabel: 'West Malaysia',
      totalWeightKg: 0.5,
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/orders/detail.ejs',
    getBaseLocals({
      title: 'Order ORD-1',
      currentPath: '/orders/1',
      currentUrl: '/orders/1',

      order: {
        order_id: 1,
        order_code: 'ORD-1',
        payment_method: 'ONLINE',
        payment_channel: 'Visa',
        payment_status: 'PAID',
        fulfilment_status: 'PROCESSING',
        total_amount: 12345,
        created_at: new Date().toISOString(),
        name: 'Smoke Customer',
        email: 'customer@example.com',
        phone: '0123456789',
        address: 'Test address',
        items: [],
      },
      promo: null,
      offline: null,
      statusHistory: [],
      itemRefunds: [],
      extraRefunds: [],
    })
  )) && ok;

  ok = (await renderTemplate(
    'views/orders/receipt.ejs',
    getBaseLocals({
      title: 'Receipt ORD-1',
      currentPath: '/orders/1/receipt',
      currentUrl: '/orders/1/receipt',

      order: {
        order_id: 1,
        order_code: 'ORD-1',
        payment_method: 'OFFLINE_TRANSFER',
        payment_channel: null,
        payment_status: 'PENDING',
        fulfilment_status: 'NEW',
        total_amount: 12345,
        created_at: new Date().toISOString(),
        name: 'Smoke Customer',
        email: 'customer@example.com',
        items: [],
      },
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
