/**
 * Onboarding (SPEC §5): phone + OTP → business → country → type → VAT? → owner PIN → home.
 * The server call (create business / attach device) happens first; then ONE local transaction writes
 * the business, settings from the country/type profile, device, roles, owner user, licence and audit.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { buildInitialSettings, COUNTRY_PROFILES, uuidv7, type AuthResponse, type CreateBusinessResponse, type DeviceInfo } from '@daftarak/shared';
import type { Db as AppDb } from '../db/types';
import { withTx } from '../db/tx';
import { business, devices, docSequences } from '../db/schema';
import { integrityToken } from '../features/integrity/integrity';
import { api } from '../api/client';
import { APP_VERSION } from '../config/env';
import { SECURE_KEYS, getOrCreateBackupKey, getOrCreateInstallId, setSecret } from '../lib/secure';
import { appendAudit } from './audit/audit';
import { seedSystemRoles, insertUser } from './auth/users';
import { setMeta } from './device';
import { ensureInventorySeed } from './inventory/seed';
import { writeSettings } from './settings/settings';
import { storeLicence, refreshLicenceState } from './licence/service';

export async function deviceInfo(): Promise<DeviceInfo> {
  return {
    installId: await getOrCreateInstallId(),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    model: Device.modelName ?? undefined,
    appVersion: APP_VERSION,
  };
}

export interface BusinessForm {
  name: string;
  country: 'EG' | 'SA';
  type: 'shop' | 'trading';
  vatRegistered: boolean;
  vatNumber: string | null;
}

export interface OwnerForm {
  name: string;
  pin: string;
}

/** Document prefixes per device; numbers look like INV-A-000123 (SPEC §4). */
const DOC_PREFIXES: Record<string, string> = {
  SALES_INVOICE: 'INV',
  SALES_RETURN: 'RET',
  QUOTATION: 'QUO',
  PURCHASE_INVOICE: 'PUR',
  PURCHASE_RETURN: 'PRT',
  RECEIPT: 'RCV',
  PAYMENT: 'PAY',
  EXPENSE: 'EXP',
  INVENTORY: 'STK',
  SHIFT: 'SHF',
};

async function writeLocal(db: AppDb, auth: AuthResponse, reg: CreateBusinessResponse, form: BusinessForm, owner: OwnerForm) {
  const now = Date.now();
  const { registration } = reg;
  const deviceId = registration.deviceId;
  const deviceCode = registration.deviceCode;
  const profile = COUNTRY_PROFILES[form.country];
  const plat = Platform.OS === 'ios' ? 'ios' : 'android';
  await withTx(db, async (tx) => {
    await setMeta(tx, 'device_id', deviceId);
    await setMeta(tx, 'device_code', deviceCode);
    await setMeta(tx, 'account_phone', auth.account.phone);
    await tx.insert(devices).values({ id: deviceId, code: deviceCode, platform: plat, isCurrent: true, activatedAt: now, createdAt: now, updatedAt: now, deviceId });
    await tx.insert(business).values({
      id: uuidv7(now),
      serverBusinessId: registration.businessId,
      name: form.name.trim(),
      country: form.country,
      type: form.type,
      currency: profile.currency,
      vatRegistered: form.vatRegistered,
      vatNumber: form.vatRegistered ? form.vatNumber : null,
      timezone: profile.timezone,
      phonesJson: JSON.stringify([auth.account.phone]),
      createdAt: now,
      updatedAt: now,
      deviceId,
    });
    await writeSettings(
      tx,
      { ...buildInitialSettings({ country: form.country, type: form.type, vatRegistered: form.vatRegistered, vatNumber: form.vatNumber }), language: 'ar' },
      now,
    );
    for (const [docType, prefix] of Object.entries(DOC_PREFIXES)) {
      await tx.insert(docSequences).values({ deviceId, docType, prefix, nextSeq: 1 });
    }
    const roleIds = await seedSystemRoles(tx, { deviceId, deviceCode, now });
    await appendAudit(tx, { action: 'business.create', entity: 'business', entityId: registration.businessId, after: form, deviceId, at: now });
    await appendAudit(tx, { action: 'device.register', entity: 'devices', entityId: deviceId, after: { code: deviceCode }, deviceId, at: now });
    await insertUser(tx, { name: owner.name, pin: owner.pin, roleId: roleIds.owner, createdBy: null, deviceId, deviceCode, now, colorIndex: 0 });
  });
  await ensureInventorySeed(db, { id: deviceId, code: deviceCode }, now);
  await setSecret(SECURE_KEYS.refreshToken, auth.refreshToken);
  await storeLicence(db, registration.licence, registration.serverTime);
  await refreshLicenceState(db);
}

/** New business on this phone. */
export async function createBusinessOnline(db: AppDb, auth: AuthResponse, form: BusinessForm, owner: OwnerForm) {
  const reg = await api.createBusiness(auth.accessToken, {
    name: form.name.trim(),
    country: form.country,
    type: form.type,
    vatRegistered: form.vatRegistered,
    backupKey: await getOrCreateBackupKey(),
    device: await deviceInfo(),
    integrity: await integrityToken('signup'),
  });
  await writeLocal(db, auth, reg, form, owner);
}

/**
 * Existing business, new/empty phone. The old phone is deactivated by the server.
 * Until backup/restore ships (Phase 6) this starts with empty data — the UI says so clearly first.
 */
export async function attachExistingBusiness(db: AppDb, auth: AuthResponse, businessId: string, owner: OwnerForm, vatNumber: string | null) {
  const reg = await api.attachDevice(auth.accessToken, businessId, await deviceInfo(), await integrityToken('attach'));
  const b = reg.business;
  await writeLocal(db, auth, reg, { name: b.name, country: b.country, type: b.type, vatRegistered: vatNumber != null, vatNumber }, owner);
}
