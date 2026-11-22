#!/usr/bin/env node
// Generates an Ed25519 key pair for licence signing.
// Secret → `wrangler secret put LICENCE_SIGNING_KEY`; public → apps/mobile/src/config/licenceKeys.ts
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const sk = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex');
const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
console.log(`LICENCE_SIGNING_KEY (secret, keep private): ${sk}`);
console.log(`public key (embed in the app):            ${pk}`);
