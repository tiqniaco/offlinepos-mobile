#!/usr/bin/env node
// Creates a super-admin: prints the SQL to run with wrangler and the TOTP setup URI.
// Usage: node scripts/create-admin.mjs admin@example.com 'long password'
//   then: npx wrangler d1 execute daftarak --remote --command "<printed SQL>"
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error('usage: create-admin.mjs <email> <password (12+ chars)>');
  process.exit(1);
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = (buf) => {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100_000, 32, 'sha256').toString('hex');
const totp = base32(randomBytes(20));
const sql = `INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES ('${randomUUID()}', '${email.toLowerCase().replace(/'/g, "''")}', '${hash}', '${salt}', '${totp}', ${Date.now()});`;
console.log('\nSQL:\n' + sql);
console.log('\nAdd this to your authenticator app (scan as QR or type the secret):');
console.log(`otpauth://totp/Kashiro%20Admin:${encodeURIComponent(email)}?secret=${totp}&issuer=Kashiro%20Admin&algorithm=SHA1&digits=6&period=30`);
console.log(`secret: ${totp}\n`);
