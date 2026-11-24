/**
 * The shop's own backup file ".kashiro" (Google Drive / Files / WhatsApp / e-mail) and restoring it WITHOUT our
 * server. Crypto + container: @daftarak/shared portableBackup.ts. Database steps: domain/backup/portable.ts.
 * Heavy work runs in slices that yield to the UI (same pipeline as the cloud backup).
 */
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { File, type Directory } from 'expo-file-system';
import {
  PORTABLE_BACKUP_KEY_ENTRY,
  PORTABLE_EXT,
  assertPortableSchema,
  base64urlDecode,
  base64urlEncode,
  openPortable,
  portableWriter,
  readPortableHeader,
  sealPortable,
  type AuthResponse,
  type PortableHeader,
} from '@daftarak/shared';
import { closeDatabase, getDb, openDatabase } from '../../db/client';
import { business } from '../../db/schema';
import { APP_VERSION } from '../../config/env';
import { api } from '../../api/client';
import { SECURE_KEYS, deleteSecret, getOrCreateBackupKey, getOrCreateDbKey, setSecret } from '../../lib/secure';
import { clearAccessToken, useAccessToken } from '../../lib/session';
import { getCurrentDevice, setMeta } from '../../domain/device';
import { attachDeviceRemote, BACKUP_KEY_MISSING_META, deviceInfo } from '../../domain/onboarding';
import { storeLicence, refreshLicenceState } from '../../domain/licence/service';
import { syncOwnerPassword } from '../../domain/auth/users';
import {
  currentLicenceRow,
  finishPortableRestore,
  hasDocuments,
  lastPortableExport,
  linkRestoredDevice,
  portableMeta,
  recordPortableExport,
  serverBusinessIdOf,
  type PortableRestoreMode,
} from '../../domain/backup/portable';
import { SCHEMA_VERSION, recordDone } from './service';
import { decryptBackupFile, installSnapshot, openSnapshot, writeBackupFile } from './files';
import { approveDataExport, type Actor } from '../approval/exportGate';
import { ApprovalError, type Approval } from '../../domain/auth/approval';
import { appendAudit } from '../../domain/audit/audit';
import { withTx } from '../../db/tx';
import { withLockHold } from '../../state/lockHold';

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type PortableStage = 'key' | 'build' | 'decrypt';

/** Build the passphrase-protected file and open the share sheet (the owner picks Drive / Files / WhatsApp …). */
export async function exportPortableBackup(passphrase: string, onProgress?: (p: number, stage: PortableStage) => void, approvedBy?: Approval | null): Promise<void> {
  await approveDataExport('export', 'portable', approvedBy);
  const db = getDb();
  const createdAt = Date.now();
  const meta = await portableMeta(db);
  const { header, dataKey } = await sealPortable(passphrase, { ...meta, createdAt, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION }, { onProgress: (p) => onProgress?.(p, 'key') });
  // The business backup key rides inside (encrypted) so cloud backups made later from a restored phone stay readable.
  const extras: [string, Uint8Array][] = [[PORTABLE_BACKUP_KEY_ENTRY, base64urlDecode(await getOrCreateBackupKey())]];
  const built = await writeBackupFile(portableWriter(dataKey, header), `kashiro-${ymd(createdAt)}.${PORTABLE_EXT}`, extras, (p) => onProgress?.(p, 'build'));
  dataKey.fill(0);
  await withLockHold(() => Sharing.shareAsync(built.file.uri, { mimeType: 'application/octet-stream', dialogTitle: built.file.name, UTI: 'public.data' }));
  await recordPortableExport(db, createdAt);
  await recordDone({ at: createdAt, size: built.size, id: null, kind: 'local' }, { cloudHead: false });
}

export const lastPortableBackup = () => lastPortableExport(getDb());

// ── restore from a file, no server ──

export interface PortablePick {
  file: File;
  fileName: string;
  header: PortableHeader;
}

/** Any file type is accepted; the header decides. Throws PortableError (not_backup / cloud_file / header / newer_schema). */
export async function pickPortableFile(): Promise<PortablePick | null> {
  const r = await withLockHold(() => DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false }));
  if (r.canceled || !r.assets?.[0]) return null;
  const asset = r.assets[0];
  const file = new File(asset.uri);
  const h = file.open();
  let first: Uint8Array;
  try {
    first = await h.readBytes(64 * 1024 + 8);
  } finally {
    h.close();
  }
  const header = readPortableHeader(first);
  assertPortableSchema(header, SCHEMA_VERSION);
  return { file, fileName: asset.name, header };
}

export interface PortablePreview {
  businessName: string;
  createdAt: number;
  counts: Record<string, number>;
  lastInvoice: string | null;
}

let staged: { snapshot: File; images: Directory; backupKey: Uint8Array | null; serverBusinessId: string | null } | null = null;

export function discardPortable() {
  if (!staged) return;
  if (staged.snapshot.exists) staged.snapshot.delete();
  if (staged.images.exists) staged.images.delete();
  staged = null;
}

/** Passphrase → unwrap the key → decrypt and verify every frame → preview from the decrypted data itself. */
export async function stagePortable(pick: PortablePick, passphrase: string, onProgress?: (p: number, stage: PortableStage) => void): Promise<PortablePreview> {
  discardPortable();
  const key = await openPortable(pick.header, passphrase, (p) => onProgress?.(p, 'key'));
  const out = await decryptBackupFile<PortableHeader>(pick.file, key, (p) => onProgress?.(p, 'decrypt'));
  key.fill(0);
  const conn = openSnapshot(out.snapshot);
  try {
    const b = conn.getFirstSync<{ name: string; server_business_id: string }>('SELECT name, server_business_id FROM business LIMIT 1');
    const last = conn.getFirstSync<{ number: string | null }>(`SELECT number FROM sales_docs WHERE type = 'INVOICE' AND status = 'POSTED' ORDER BY posted_at DESC LIMIT 1`)?.number ?? null;
    const bk = out.secrets[PORTABLE_BACKUP_KEY_ENTRY];
    staged = { snapshot: out.snapshot, images: out.images, backupKey: bk && bk.length === 32 ? bk : null, serverBusinessId: b?.server_business_id ?? null };
    return { businessName: b?.name ?? out.header.businessName, createdAt: out.header.createdAt, counts: out.header.counts, lastInvoice: last };
  } finally {
    conn.closeSync();
  }
}

/** Can the staged file replace this phone's data? Fresh install → yes; existing shop → only if empty and the same business. */
export async function portableTarget(): Promise<{ ok: true; mode: PortableRestoreMode } | { ok: false; reason: 'has_documents' | 'other_business' }> {
  const db = getDb();
  const b = (await db.select({ id: business.serverBusinessId }).from(business).limit(1))[0];
  if (!b) return { ok: true, mode: { kind: 'offline' } };
  if (await hasDocuments(db)) return { ok: false, reason: 'has_documents' };
  if (!staged || staged.serverBusinessId !== b.id) return { ok: false, reason: 'other_business' };
  const device = await getCurrentDevice(db);
  if (!device) return { ok: true, mode: { kind: 'offline' } };
  return { ok: true, mode: { kind: 'keep', device, licence: await currentLicenceRow(db) } };
}

/**
 * Replace the live database with the staged file. The caller re-runs boot() afterwards (→ lock screen).
 * On an existing shop (`keep`) the signed-in user (`actor`, captured before the screens unmount) must pass
 * «تأكيد المدير»; the approval is logged again in the restored audit chain (the old one is replaced).
 */
export async function applyPortable(mode: PortableRestoreMode, opts: { actor?: Actor | null; approvedBy?: Approval | null } = {}): Promise<void> {
  if (!staged) throw new Error('nothing staged');
  if (mode.kind === 'keep' && !opts.actor) throw new ApprovalError('approval_required', 'restore');
  const approverId = opts.actor ? await approveDataExport('restore', 'portable', opts.approvedBy, opts.actor) : null;
  const s = staged;
  // Taken out of `staged` first: the screen unmounts during the swap and its cleanup must not delete these files.
  staged = null;
  const dbKey = await getOrCreateDbKey();
  closeDatabase();
  try {
    installSnapshot(s.snapshot, dbKey, s.images);
  } finally {
    // installSnapshot consumes them on success; after a failure no plain copy may stay in the cache.
    if (s.snapshot.exists) s.snapshot.delete();
    if (s.images.exists) s.images.delete();
  }
  const db = await openDatabase();
  await finishPortableRestore(db, mode, { platform: platform() });
  if (approverId && opts.actor) {
    const actor = opts.actor;
    const deviceId = (await getCurrentDevice(db))?.id ?? actor.deviceId;
    await withTx(db, (tx) => appendAudit(tx, { action: 'approval.restore', entity: 'backup', entityId: 'portable', after: { for: actor.user.id }, userId: approverId, deviceId })).catch(() => undefined);
  }
  if (mode.kind === 'offline') {
    // No sign-in on this phone yet: the old phone's session is not carried over.
    await deleteSecret(SECURE_KEYS.refreshToken).catch(() => undefined);
    clearAccessToken();
    if (s.backupKey) await setSecret(SECURE_KEYS.backupKey, base64urlEncode(s.backupKey));
    // No key in the file: cloud backups stay off until the phone is linked (the server key is fetched then).
    await setMeta(db, BACKUP_KEY_MISSING_META, s.backupKey ? '0' : '1');
  }
  s.backupKey?.fill(0);
}

// ── later, online: link this restored phone to the account ──

export class LinkError extends Error {
  constructor(public readonly code: 'not_owner') {
    super(code);
    this.name = 'LinkError';
  }
}

/**
 * Owner signs in with the account password (step 1). The caller then asks for an SMS step-up on `auth.accessToken`
 * (taking the shop over from the old phone and releasing the backup key both need it) and calls `finishLinkThisPhone`.
 */
export async function linkThisPhoneLogin(phone: string, password: string): Promise<AuthResponse> {
  const db = getDb();
  const auth = await api.passwordLogin(phone, password, await deviceInfo());
  const sid = await serverBusinessIdOf(db);
  if (!sid || !auth.businesses.some((b) => b.id === sid)) throw new LinkError('not_owner');
  return auth;
}

/**
 * Step 2, after the step-up: the server registers this phone (the old phone becomes view-only) and sends its licence;
 * the business's server backup key replaces any local one. The provisional local device is retired.
 */
export async function finishLinkThisPhone(auth: AuthResponse, password: string): Promise<void> {
  const db = getDb();
  const sid = await serverBusinessIdOf(db);
  if (!sid) throw new LinkError('not_owner');
  const reg = await attachDeviceRemote(db, auth, sid);
  await linkRestoredDevice(db, reg.registration, { platform: platform() });
  await setSecret(SECURE_KEYS.refreshToken, auth.refreshToken);
  useAccessToken(auth.accessToken, auth.accessExpiresAt);
  await storeLicence(db, reg.registration.licence, reg.registration.serverTime);
  await refreshLicenceState(db);
  await syncOwnerPassword(db, password, reg.registration.deviceId);
  await setMeta(db, 'account.phone', auth.account.phone);
}
