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

// ───────────────────────────── Phase 2: products & inventory ─────────────────────────────

const master = { hlc: text('hlc').notNull(), deletedAt: integer('deleted_at') };

export const categories = sqliteTable(
  'categories',
  {
    ...base,
    ...master,
    name: text('name').notNull(),
    parentId: text('parent_id'),
    sort: integer('sort').notNull().default(0),
    color: text('color'),
  },
  (t) => [index('categories_name').on(t.name)],
);

export const units = sqliteTable('units', {
  ...base,
  ...master,
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  allowsFraction: integer('allows_fraction', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

/** Variants of one product (e.g. sizes/colours) share a group; each variant is its own product row (D-06). */
export const productGroups = sqliteTable('product_groups', {
  ...base,
  ...master,
  name: text('name').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    ...base,
    ...master,
    name: text('name').notNull(),
    nameEn: text('name_en'),
    sku: text('sku'),
    categoryId: text('category_id').references(() => categories.id),
    groupId: text('group_id').references(() => productGroups.id),
    variantLabel: text('variant_label'),
    baseUnitId: text('base_unit_id')
      .notNull()
      .references(() => units.id),
    /** Last purchase / entered cost per base unit (the moving average lives in stock_levels). */
    costMinor: integer('cost_minor').notNull().default(0),
    retailPriceMinor: integer('retail_price_minor').notNull().default(0),
    wholesalePriceMinor: integer('wholesale_price_minor').notNull().default(0),
    /** null = business default VAT rate. */
    taxRateBp: integer('tax_rate_bp'),
    trackStock: integer('track_stock', { mode: 'boolean' }).notNull().default(true),
    trackExpiry: integer('track_expiry', { mode: 'boolean' }).notNull().default(false),
    lowStockMilli: integer('low_stock_milli'),
    imagePath: text('image_path'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
  },
  (t) => [
    index('products_name').on(t.name),
    index('products_category').on(t.categoryId, t.name),
    index('products_group').on(t.groupId),
    index('products_deleted').on(t.deletedAt),
  ],
);

/** Units a product is sold/bought in. The base unit row has factor 1000 (= 1 base unit). */
export const productUnits = sqliteTable(
  'product_units',
  {
    ...base,
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    factorMilli: integer('factor_milli').notNull(),
    retailPriceMinor: integer('retail_price_minor'),
    wholesalePriceMinor: integer('wholesale_price_minor'),
    isBase: integer('is_base', { mode: 'boolean' }).notNull().default(false),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('product_units_product').on(t.productId)],
);

/** Scanning a carton barcode adds one carton (product_unit_id). Codes are unique among live rows. */
export const barcodes = sqliteTable(
  'barcodes',
  {
    ...base,
    code: text('code').notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: text('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('barcodes_code').on(t.code), index('barcodes_product').on(t.productId)],
);

export const batches = sqliteTable(
  'batches',
  {
    ...base,
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchNo: text('batch_no'),
    expiryDay: integer('expiry_day'),
  },
  (t) => [index('batches_product').on(t.productId), index('batches_expiry').on(t.expiryDay)],
);

export const warehouses = sqliteTable('warehouses', {
  ...base,
  ...master,
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

/** THE stock ledger (append-only; UPDATE/DELETE blocked by triggers). Quantities in base-unit milli. */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    ...base,
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    batchId: text('batch_id'),
    qtyMilli: integer('qty_milli').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    type: text('type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceLineId: text('source_line_id'),
    reason: text('reason'),
    businessDay: integer('business_day').notNull(),
    occurredAt: integer('occurred_at').notNull(),
  },
  (t) => [
    index('stock_mov_product').on(t.productId, t.warehouseId, t.occurredAt),
    index('stock_mov_source').on(t.sourceType, t.sourceId),
    index('stock_mov_day').on(t.businessDay),
  ],
);

/** Cache of Σ stock_movements, updated in the same transaction. Rebuildable at any time. */
export const stockLevels = sqliteTable(
  'stock_levels',
  {
    productId: text('product_id').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
    avgCostMinor: integer('avg_cost_minor').notNull(),
    valueMinor: integer('value_minor').notNull(),
    lastMovementAt: integer('last_movement_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.warehouseId] }), index('stock_levels_qty').on(t.qtyMilli)],
);

export const batchLevels = sqliteTable(
  'batch_levels',
  {
    batchId: text('batch_id').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.warehouseId] })],
);

/** Opening balances, adjustments and stock counts. Posted docs are immutable; hash-chain columns filled from Phase 3. */
export const inventoryDocs = sqliteTable(
  'inventory_docs',
  {
    ...base,
    type: text('type', { enum: ['OPENING', 'ADJUST', 'COUNT'] }).notNull(),
    status: text('status', { enum: ['DRAFT', 'POSTED'] }).notNull(),
    number: text('number'),
    warehouseId: text('warehouse_id').notNull(),
    reason: text('reason'),
    note: text('note'),
    postedAt: integer('posted_at'),
    businessDay: integer('business_day'),
    hash: text('hash'),
    prevHash: text('prev_hash'),
    chainSeq: integer('chain_seq'),
  },
  (t) => [index('inventory_docs_status').on(t.type, t.status)],
);

export const inventoryLines = sqliteTable(
  'inventory_lines',
  {
    ...base,
    docId: text('doc_id')
      .notNull()
      .references(() => inventoryDocs.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchId: text('batch_id'),
    expectedMilli: integer('expected_milli'),
    countedMilli: integer('counted_milli'),
    deltaMilli: integer('delta_milli').notNull(),
    unitCostMinor: integer('unit_cost_minor'),
  },
  (t) => [index('inventory_lines_doc').on(t.docId), index('inventory_lines_product').on(t.productId)],
);
