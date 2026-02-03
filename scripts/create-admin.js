/* eslint-disable no-console */

require('dotenv').config();

const bcrypt = require('bcrypt');

const userRepo = require('../src/repositories/userRepo');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function usage() {
  console.log('Usage:');
  console.log('  node scripts/create-admin.js --username <u> --email <e> --password <p>');
  console.log('Optional:');
  console.log('  --phone <p> --address <a> --super');
  console.log('Notes:');
  console.log('  Admin rights are stored in the DB (users.is_admin / users.is_super_admin).');
  console.log('  ADMIN_USERNAMES/ADMIN_EMAILS are still supported as a bootstrap/recovery allowlist.');
}

async function main() {
  const username = getArg('--username');
  const email = getArg('--email');
  const password = getArg('--password');
  const phone = getArg('--phone') || '';
  const address = getArg('--address') || '';
  const isSuper = process.argv.includes('--super');

  if (!username || !email || !password) {
    usage();
    process.exit(2);
  }

  const existingU = userRepo.findByUsernameOrEmail(username);
  const existingE = userRepo.findByUsernameOrEmail(email);
  if (existingU || existingE) {
    console.log('User already exists (username or email).');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = userRepo.create({
    username,
    email,
    password_hash,
    phone,
    address,
    is_admin: 1,
    is_super_admin: isSuper ? 1 : 0,
  });

  console.log('Created user:');
  console.log(`  id: ${user.user_id}`);
  console.log(`  username: ${user.username}`);
  console.log(`  email: ${user.email}`);
  console.log(`  is_admin: ${user.is_admin}`);
  console.log(`  is_super_admin: ${user.is_super_admin}`);
  console.log('');
  console.log('Optional bootstrap/recovery: you can also allowlist in .env:');
  console.log(`  ADMIN_USERNAMES=${user.username}`);
  console.log('or');
  console.log(`  ADMIN_EMAILS=${user.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
