/**
 * Local database schema (SQLCipher-encrypted SQLite). Phase 1 tables only; later phases add their own
 * tables in new migrations. Conventions (PLAN.md §4.1): UUIDv7 text ids, epoch-ms integers,
 * money in minor units, quantities in milli-units, rates in basis points.
 *
 * After editing this file run `pnpm db:generate` to create a new numbered migration.
 * Never edit a migration that has shipped.
 */
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  createdBy: text('created_by'),
  deviceId: text('device_id'),
};

/** Exactly one row: the business this phone runs. */
export const business = sqliteTable('business', {
  ...base,
  serverBusinessId: text('server_business_id').notNull(),
  name: text('name').notNull(),
  country: text('country', { enum: ['EG', 'SA'] }).notNull(),
  type: text('type', { enum: ['shop', 'trading'] }).notNull(),
  currency: text('currency', { enum: ['EGP', 'SAR'] }).notNull(),
  vatRegistered: integer('vat_registered', { mode: 'boolean' }).notNull(),
  vatNumber: text('vat_number'),
  crNumber: text('cr_number'),
  address: text('address'),
  phonesJson: text('phones_json').notNull().default('[]'),
  logoPath: text('logo_path'),
  timezone: text('timezone').notNull(),
});

/** Key/value business settings (values are JSON). Seeded from the country/type profile. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const devices = sqliteTable('devices', {
  ...base,
  code: text('code').notNull(),
  name: text('name'),
  platform: text('platform').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull(),
  activatedAt: integer('activated_at').notNull(),
  deactivatedAt: integer('deactivated_at'),
});

export const docSequences = sqliteTable(
  'doc_sequences',
  {
    deviceId: text('device_id').notNull(),
    docType: text('doc_type').notNull(),
    prefix: text('prefix').notNull(),
    nextSeq: integer('next_seq').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.docType] })],
);

export const roles = sqliteTable('roles', {
  ...base,
  key: text('key'), // 'owner' | 'manager' | 'cashier' for system roles, null for custom
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull(),
  permissionsJson: text('permissions_json').notNull(),
  maxItemDiscountBp: integer('max_item_discount_bp').notNull(),
  maxInvoiceDiscountBp: integer('max_invoice_discount_bp').notNull(),
  hlc: text('hlc').notNull(),
  deletedAt: integer('deleted_at'),
});

export const users = sqliteTable(
  'users',
  {
    ...base,
    name: text('name').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    pinHash: text('pin_hash').notNull(),
    pinSalt: text('pin_salt').notNull(),
    pinParams: text('pin_params').notNull(),
    biometricEnabled: integer('biometric_enabled', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    failedPinAttempts: integer('failed_pin_attempts').notNull().default(0),
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    color: text('color').notNull(),
    hlc: text('hlc').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('users_role').on(t.roleId)],
);

/** Single row with the current licence token and clock guard (PLAN.md §8). */
export const licenceState = sqliteTable('licence_state', {
  id: integer('id').primaryKey(),
  token: text('token'),
  lastCheckinAt: integer('last_checkin_at'),
  lastServerTime: integer('last_server_time'),
  maxSeenTime: integer('max_seen_time').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const kvMeta = sqliteTable('kv_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Append-only, hash-chained audit log (PLAN.md §7.4). UPDATE/DELETE blocked by triggers. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    seq: integer('seq').notNull(),
    at: integer('at').notNull(),
    userId: text('user_id'),
    deviceId: text('device_id').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    reason: text('reason'),
    hash: text('hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (t) => [uniqueIndex('audit_seq').on(t.seq), index('audit_entity').on(t.entity, t.entityId)],
);
