const { getDb } = require('../db/db');

function mapProduct(row) {
  if (!row) return null;
  return {
    product_id: row.product_id,
    name: row.name,
    description: row.description,
    category: row.category,
    category_name: row.category_name || null,
    price: row.price,
    stock: row.stock,
    availability: Boolean(row.availability),
    visibility: Boolean(row.visibility),
    archived: Boolean(row.archived),
    product_image: row.product_image,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function countPublic({ q, category, availability, minPriceCents, maxPriceCents }) {
  const db = getDb();
  const where = ['i.archived=0', 'i.visibility=1', 'c.archived=0', 'c.visible=1'];
  const params = {};
  if (category) {
    where.push('i.category=@category');
    params.category = category;
  }
  if (q) {
    where.push('(i.name LIKE @q OR i.description LIKE @q)');
    params.q = `%${q}%`;
  }
  if (availability === 'IN_STOCK') {
    where.push('i.stock > 0');
  }
  if (availability === 'OUT_OF_STOCK') {
    where.push('i.stock <= 0');
  }
  if (Number.isFinite(minPriceCents) && minPriceCents !== null) {
    where.push('i.price >= @minPrice');
    params.minPrice = minPriceCents;
  }
  if (Number.isFinite(maxPriceCents) && maxPriceCents !== null) {
    where.push('i.price <= @maxPrice');
    params.maxPrice = maxPriceCents;
  }
  const stmt = db.prepare(
    `SELECT COUNT(*) as c
     FROM inventory i
     JOIN categories c ON c.slug = i.category
     WHERE ${where.join(' AND ')}`
  );
  return stmt.get(params).c;
}

function listPublic({ q, category, availability, minPriceCents, maxPriceCents, sort, limit, offset }) {
  const db = getDb();
  const where = ['i.archived=0', 'i.visibility=1', 'c.archived=0', 'c.visible=1'];
  const params = { limit, offset };
  if (category) {
    where.push('i.category=@category');
    params.category = category;
  }
  if (q) {
    where.push('(i.name LIKE @q OR i.description LIKE @q)');
    params.q = `%${q}%`;
  }
  if (availability === 'IN_STOCK') {
    where.push('i.stock > 0');
  }
  if (availability === 'OUT_OF_STOCK') {
    where.push('i.stock <= 0');
  }
  if (Number.isFinite(minPriceCents) && minPriceCents !== null) {
    where.push('i.price >= @minPrice');
    params.minPrice = minPriceCents;
  }
  if (Number.isFinite(maxPriceCents) && maxPriceCents !== null) {
    where.push('i.price <= @maxPrice');
    params.maxPrice = maxPriceCents;
  }

  let orderBy = 'created_at DESC';
  switch (String(sort || 'NEWEST')) {
    case 'PRICE_ASC':
      orderBy = 'i.price ASC, i.created_at DESC';
      break;
    case 'PRICE_DESC':
      orderBy = 'i.price DESC, i.created_at DESC';
      break;
    case 'NAME_ASC':
      orderBy = 'i.name ASC, i.created_at DESC';
      break;
    case 'NAME_DESC':
      orderBy = 'i.name DESC, i.created_at DESC';
      break;
    default:
      orderBy = 'i.created_at DESC';
  }

  const stmt = db.prepare(
    `SELECT i.*, c.name as category_name
     FROM inventory i
     JOIN categories c ON c.slug = i.category
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
  );
  return stmt.all(params).map(mapProduct);
}

function countAdmin({ q, includeArchived, archived, category, visibility, stock, minPriceCents, maxPriceCents }) {
  const db = getDb();
  const where = [];
  const params = {};

  const archivedMode = String(archived || (includeArchived ? 'ALL' : 'ACTIVE')).toUpperCase();
  if (archivedMode === 'ACTIVE') where.push('i.archived=0');
  if (archivedMode === 'ARCHIVED') where.push('i.archived=1');

  const visMode = String(visibility || 'ALL').toUpperCase();
  if (visMode === 'VISIBLE') where.push('i.visibility=1');
  if (visMode === 'HIDDEN') where.push('i.visibility=0');

  if (category) {
    where.push('i.category=@category');
    params.category = category;
  }

  const stockMode = String(stock || 'ALL').toUpperCase();
  if (stockMode === 'IN_STOCK') where.push('i.stock > 0');
  if (stockMode === 'OUT_OF_STOCK') where.push('i.stock <= 0');
  if (stockMode === 'LOW_STOCK') {
    where.push('i.stock > 0 AND i.stock <= @lowStock');
    params.lowStock = 5;
  }

  if (Number.isFinite(minPriceCents) && minPriceCents !== null) {
    where.push('i.price >= @minPrice');
    params.minPrice = minPriceCents;
  }
  if (Number.isFinite(maxPriceCents) && maxPriceCents !== null) {
    where.push('i.price <= @maxPrice');
    params.maxPrice = maxPriceCents;
  }

  if (q) {
    where.push('(i.name LIKE @q OR i.description LIKE @q)');
    params.q = `%${q}%`;
  }
  const sql = `SELECT COUNT(*) as c
               FROM inventory i
               LEFT JOIN categories c ON c.slug = i.category
               ${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).c;
}

function listAdmin({ q, includeArchived, archived, category, visibility, stock, minPriceCents, maxPriceCents, sort, limit, offset }) {
  const db = getDb();
  const where = [];
  const params = { limit, offset };

  const archivedMode = String(archived || (includeArchived ? 'ALL' : 'ACTIVE')).toUpperCase();
  if (archivedMode === 'ACTIVE') where.push('i.archived=0');
  if (archivedMode === 'ARCHIVED') where.push('i.archived=1');

  const visMode = String(visibility || 'ALL').toUpperCase();
  if (visMode === 'VISIBLE') where.push('i.visibility=1');
  if (visMode === 'HIDDEN') where.push('i.visibility=0');

  if (category) {
    where.push('i.category=@category');
    params.category = category;
  }

  const stockMode = String(stock || 'ALL').toUpperCase();
  if (stockMode === 'IN_STOCK') where.push('i.stock > 0');
  if (stockMode === 'OUT_OF_STOCK') where.push('i.stock <= 0');
  if (stockMode === 'LOW_STOCK') {
    where.push('i.stock > 0 AND i.stock <= @lowStock');
    params.lowStock = 5;
  }

  if (Number.isFinite(minPriceCents) && minPriceCents !== null) {
    where.push('i.price >= @minPrice');
    params.minPrice = minPriceCents;
  }
  if (Number.isFinite(maxPriceCents) && maxPriceCents !== null) {
    where.push('i.price <= @maxPrice');
    params.maxPrice = maxPriceCents;
  }

  if (q) {
    where.push('(i.name LIKE @q OR i.description LIKE @q)');
    params.q = `%${q}%`;
  }

  let orderBy = 'created_at DESC';
  switch (String(sort || 'NEWEST').toUpperCase()) {
    case 'OLDEST':
      orderBy = 'i.created_at ASC';
      break;
    case 'ID_ASC':
      orderBy = 'i.product_id ASC';
      break;
    case 'ID_DESC':
      orderBy = 'i.product_id DESC';
      break;
    case 'UPDATED_DESC':
      orderBy = 'i.updated_at DESC, i.created_at DESC';
      break;
    case 'UPDATED_ASC':
      orderBy = 'i.updated_at ASC, i.created_at DESC';
      break;
    case 'PRICE_ASC':
      orderBy = 'i.price ASC, i.created_at DESC';
      break;
    case 'PRICE_DESC':
      orderBy = 'i.price DESC, i.created_at DESC';
      break;
    case 'NAME_ASC':
      orderBy = 'i.name ASC, i.created_at DESC';
      break;
    case 'NAME_DESC':
      orderBy = 'i.name DESC, i.created_at DESC';
      break;
    case 'CATEGORY_ASC':
      orderBy = 'COALESCE(c.name, i.category) ASC, i.name ASC, i.created_at DESC';
      break;
    case 'CATEGORY_DESC':
      orderBy = 'COALESCE(c.name, i.category) DESC, i.name ASC, i.created_at DESC';
      break;
    case 'STOCK_ASC':
      orderBy = 'i.stock ASC, i.created_at DESC';
      break;
    case 'STOCK_DESC':
      orderBy = 'i.stock DESC, i.created_at DESC';
      break;
    case 'VISIBILITY_ASC':
      orderBy = 'i.visibility ASC, i.created_at DESC';
      break;
    case 'VISIBILITY_DESC':
      orderBy = 'i.visibility DESC, i.created_at DESC';
      break;
    case 'ARCHIVED_ASC':
      orderBy = 'i.archived ASC, i.created_at DESC';
      break;
    case 'ARCHIVED_DESC':
      orderBy = 'i.archived DESC, i.created_at DESC';
      break;
    default:
      orderBy = 'i.created_at DESC';
  }

  const sql = `SELECT i.*, c.name as category_name
               FROM inventory i
               LEFT JOIN categories c ON c.slug = i.category
               ${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
               ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params).map(mapProduct);
}

function getById(productId) {
  const db = getDb();
  return mapProduct(
    db
      .prepare(
        `SELECT i.*, c.name as category_name
         FROM inventory i
         LEFT JOIN categories c ON c.slug = i.category
         WHERE i.product_id=?`
      )
      .get(productId)
  );
}

function create({ name, description, category, price, stock, visibility, archived, product_image }) {
  const db = getDb();
  if (!Number.isFinite(Number(price)) || Number(price) < 100) {
    const err = new Error('Minimum product price is RM 1.00');
    err.status = 400;
    throw err;
  }
  const stmt = db.prepare(
    `INSERT INTO inventory (name, description, category, price, stock, visibility, archived, product_image)
     VALUES (@name, @description, @category, @price, @stock, @visibility, @archived, @product_image)`
  );
  const result = stmt.run({
    name,
    description: description || '',
    category,
    price,
    stock,
    visibility: visibility ? 1 : 0,
    archived: archived ? 1 : 0,
    product_image: product_image || null,
  });
  return getById(result.lastInsertRowid);
}

function update(productId, patch) {
  const db = getDb();
  const current = getById(productId);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
  };

  if (!Number.isFinite(Number(next.price)) || Number(next.price) < 100) {
    const err = new Error('Minimum product price is RM 1.00');
    err.status = 400;
    throw err;
  }

  db.prepare(
    `UPDATE inventory
     SET name=@name, description=@description, category=@category, price=@price, stock=@stock,
         visibility=@visibility, archived=@archived, product_image=@product_image
     WHERE product_id=@product_id`
  ).run({
    product_id: productId,
    name: next.name,
    description: next.description || '',
    category: next.category,
    price: next.price,
    stock: next.stock,
    visibility: next.visibility ? 1 : 0,
    archived: next.archived ? 1 : 0,
    product_image: next.product_image || null,
  });

  return getById(productId);
}

function updateCategorySlug(oldSlug, newSlug) {
  const db = getDb();
  const oldValue = String(oldSlug || '').trim();
  const nextValue = String(newSlug || '').trim();
  if (!oldValue || !nextValue || oldValue === nextValue) return;
  db.prepare('UPDATE inventory SET category=? WHERE category=?').run(nextValue, oldValue);
}

module.exports = {
  countPublic,
  listPublic,
  countAdmin,
  listAdmin,
  getById,
  create,
  update,
  updateCategorySlug,
};
