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
  console.log('  --phone <p> --address <a>');
  console.log('Notes:');
  console.log('  Admin rights are controlled by ADMIN_USERNAMES/ADMIN_EMAILS in .env');
}

async function main() {
  const username = getArg('--username');
  const email = getArg('--email');
  const password = getArg('--password');
  const phone = getArg('--phone') || '';
  const address = getArg('--address') || '';

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
  const user = userRepo.create({ username, email, password_hash, phone, address });

  console.log('Created user:');
  console.log(`  id: ${user.user_id}`);
  console.log(`  username: ${user.username}`);
  console.log(`  email: ${user.email}`);
  console.log('');
  console.log('To grant admin access, add one of these to your .env:');
  console.log(`  ADMIN_USERNAMES=${user.username}`);
  console.log('or');
  console.log(`  ADMIN_EMAILS=${user.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
