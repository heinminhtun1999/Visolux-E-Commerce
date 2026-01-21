const { getDb } = require('../db/db');

function mapUser(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    phone: row.phone,
    address: row.address,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state: row.state,
    postcode: row.postcode,
    password_reset_token_hash: row.password_reset_token_hash,
    password_reset_expires_at: row.password_reset_expires_at,
    created_at: row.created_at,
  };
}

function getById(userId) {
  const db = getDb();
  return mapUser(db.prepare('SELECT * FROM users WHERE user_id=?').get(userId));
}

function findByUsernameOrEmail(identifier) {
  const db = getDb();
  const value = String(identifier || '').trim();
  if (!value) return null;
  return mapUser(
    db
      .prepare('SELECT * FROM users WHERE lower(username)=lower(?) OR lower(email)=lower(?)')
      .get(value, value)
  );
}

function create({ username, email, password_hash, phone, address, address_line1, address_line2, city, state, postcode }) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO users (username, email, password_hash, phone, address, address_line1, address_line2, city, state, postcode)
     VALUES (@username, @email, @password_hash, @phone, @address, @address_line1, @address_line2, @city, @state, @postcode)`
  );
  const result = stmt.run({
    username,
    email,
    password_hash,
    phone: phone || null,
    address: address || null,
    address_line1: address_line1 || null,
    address_line2: address_line2 || null,
    city: city || null,
    state: state || null,
    postcode: postcode || null,
  });
  return getById(result.lastInsertRowid);
}

function updateProfile(userId, { email, phone, address, address_line1, address_line2, city, state, postcode }) {
  const db = getDb();
  db.prepare(
    'UPDATE users SET email=@e, phone=@p, address=@a, address_line1=@l1, address_line2=@l2, city=@c, state=@s, postcode=@pc WHERE user_id=@id'
  ).run({
    id: userId,
    e: email,
    p: phone || null,
    a: address || null,
    l1: address_line1 || null,
    l2: address_line2 || null,
    c: city || null,
    s: state || null,
    pc: postcode || null,
  });
  return getById(userId);
}

function updatePassword(userId, password_hash) {
  const db = getDb();
  db.prepare('UPDATE users SET password_hash=? WHERE user_id=?').run(password_hash, userId);
  return getById(userId);
}

function setPasswordResetToken(userId, { tokenHash, ttlMinutes }) {
  const db = getDb();
  const minutes = Number(ttlMinutes || 0);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60;
  const mod = `+${safeMinutes} minutes`;

  db.prepare(
    `UPDATE users
     SET password_reset_token_hash=@h,
         password_reset_expires_at=datetime('now', @mod)
     WHERE user_id=@id`
  ).run({
    id: userId,
    h: tokenHash,
    mod,
  });

  return getById(userId);
}

function clearPasswordResetToken(userId) {
  const db = getDb();
  db.prepare(
    `UPDATE users
     SET password_reset_token_hash=NULL,
         password_reset_expires_at=NULL
     WHERE user_id=?`
  ).run(userId);
  return getById(userId);
}

function findByValidPasswordResetTokenHash(tokenHash) {
  const db = getDb();
  const hash = String(tokenHash || '').trim();
  if (!hash) return null;
  return mapUser(
    db
      .prepare(
        `SELECT * FROM users
         WHERE password_reset_token_hash=?
           AND password_reset_expires_at IS NOT NULL
           AND password_reset_expires_at > datetime('now')`
      )
      .get(hash)
  );
}

module.exports = {
  getById,
  findByUsernameOrEmail,
  create,
  updateProfile,
  updatePassword,
  setPasswordResetToken,
  clearPasswordResetToken,
  findByValidPasswordResetTokenHash,
};
