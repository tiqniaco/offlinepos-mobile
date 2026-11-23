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
    /** 'pin' (staff, 4–6 digits) or 'password' (the account owner: same password as phone + password login). */
    secretKind: text('secret_kind', { enum: ['pin', 'password'] }).notNull().default('pin'),
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
    /** DISCARDED = a stock count cancelled before posting (kept for the count report; never touched stock). */
    status: text('status', { enum: ['DRAFT', 'POSTED', 'DISCARDED'] }).notNull(),
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

// ───────────────────────────── Phase 3: sales, payments, journal, integrity ─────────────────────────────

/** Minimal customer record (full forms, statements and limits UI in Phase 4). */
export const customers = sqliteTable(
  'customers',
  {
    ...base,
    ...master,
    name: text('name').notNull(),
    mobile: text('mobile'),
    address: text('address'),
    email: text('email'),
    taxNumber: text('tax_number'),
    creditLimitMinor: integer('credit_limit_minor'),
    priceTier: text('price_tier', { enum: ['retail', 'wholesale'] }).notNull().default('retail'),
    notes: text('notes'),
  },
  (t) => [index('customers_name').on(t.name), index('customers_mobile').on(t.mobile)],
);

/**
 * Sales documents: INVOICE, RETURN, QUOTATION. Status: DRAFT (editable), PARKED (held cart), POSTED,
 * VOIDED, CONVERTED (quotation turned into an invoice). Posted/voided rows are immutable (triggers),
 * except print counters and the POSTED→VOIDED flip.
 */
export const salesDocs = sqliteTable(
  'sales_docs',
  {
    ...base,
    type: text('type', { enum: ['INVOICE', 'RETURN', 'QUOTATION'] }).notNull(),
    status: text('status', { enum: ['DRAFT', 'PARKED', 'POSTED', 'VOIDED', 'CONVERTED'] }).notNull(),
    number: text('number'),
    customerId: text('customer_id'),
    customerName: text('customer_name'),
    priceTier: text('price_tier', { enum: ['retail', 'wholesale'] }).notNull().default('retail'),
    originalDocId: text('original_doc_id'),
    shiftId: text('shift_id'),
    cashierId: text('cashier_id'),
    issuedAt: integer('issued_at'),
    businessDay: integer('business_day'),
    pricesIncludeVat: integer('prices_include_vat', { mode: 'boolean' }).notNull(),
    invoiceDiscountJson: text('invoice_discount_json'),
    grossMinor: integer('gross_minor').notNull().default(0),
    lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
    invoiceDiscountMinor: integer('invoice_discount_minor').notNull().default(0),
    netMinor: integer('net_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    roundingMinor: integer('rounding_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    paidMinor: integer('paid_minor').notNull().default(0),
    creditMinor: integer('credit_minor').notNull().default(0),
    changeMinor: integer('change_minor').notNull().default(0),
    cashTenderedMinor: integer('cash_tendered_minor').notNull().default(0),
    note: text('note'),
    approvedBy: text('approved_by'),
    hash: text('hash'),
    prevHash: text('prev_hash'),
    chainSeq: integer('chain_seq'),
    postedAt: integer('posted_at'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: integer('voided_at'),
    printCount: integer('print_count').notNull().default(0),
    lastPrintedAt: integer('last_printed_at'),
    /** Phase 5: automatic offers and coupon. */
    offerDiscountMinor: integer('offer_discount_minor').notNull().default(0),
    couponCode: text('coupon_code'),
    couponOfferId: text('coupon_offer_id'),
    couponDiscountMinor: integer('coupon_discount_minor').notNull().default(0),
  },
  (t) => [
    index('sales_docs_type_status_day').on(t.type, t.status, t.businessDay),
    index('sales_docs_customer_day').on(t.customerId, t.businessDay),
    index('sales_docs_original').on(t.originalDocId),
    index('sales_docs_posted').on(t.postedAt),
  ],
);

export const salesLines = sqliteTable(
  'sales_lines',
  {
    ...base,
    docId: text('doc_id')
      .notNull()
      .references(() => salesDocs.id),
    lineNo: integer('line_no').notNull(),
    productId: text('product_id').notNull(),
    productUnitId: text('product_unit_id').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitNameSnapshot: text('unit_name_snapshot').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
    factorMilli: integer('factor_milli').notNull(),
    baseQtyMilli: integer('base_qty_milli').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    catalogPriceMinor: integer('catalog_price_minor').notNull(),
    discountJson: text('discount_json'),
    grossMinor: integer('gross_minor').notNull(),
    lineDiscountMinor: integer('line_discount_minor').notNull(),
    invoiceDiscountMinor: integer('invoice_discount_minor').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull(),
    netMinor: integer('net_minor').notNull(),
    taxMinor: integer('tax_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    /** Cost per BASE unit at posting time (moving average) — for profit reports. */
    unitCostMinor: integer('unit_cost_minor'),
    originalLineId: text('original_line_id'),
    businessDay: integer('business_day'),
    offerId: text('offer_id'),
    offerDiscountMinor: integer('offer_discount_minor').notNull().default(0),
  },
  (t) => [index('sales_lines_doc').on(t.docId), index('sales_lines_product_day').on(t.productId, t.businessDay), index('sales_lines_day').on(t.businessDay), index('sales_lines_original').on(t.originalLineId)],
);

/** Money in/out. Sale payments reference their invoice; on-account receipts arrive in Phase 4. */
export const payments = sqliteTable(
  'payments',
  {
    ...base,
    kind: text('kind', { enum: ['SALE', 'REFUND', 'RECEIPT', 'PURCHASE', 'SUPPLIER_PAYMENT', 'SUPPLIER_REFUND', 'EXPENSE', 'CASH_IN', 'CASH_OUT'] }).notNull(),
    direction: text('direction', { enum: ['IN', 'OUT'] }).notNull(),
    method: text('method', { enum: ['cash', 'card', 'wallet', 'bank', 'credit'] }).notNull(),
    label: text('label'),
    amountMinor: integer('amount_minor').notNull(),
    partyType: text('party_type', { enum: ['C', 'S'] }),
    partyId: text('party_id'),
    docType: text('doc_type'),
    docId: text('doc_id'),
    shiftId: text('shift_id'),
    businessDay: integer('business_day').notNull(),
    postedAt: integer('posted_at').notNull(),
    voided: integer('voided', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('payments_day_method').on(t.businessDay, t.method), index('payments_doc').on(t.docType, t.docId), index('payments_party').on(t.partyType, t.partyId, t.businessDay), index('payments_shift').on(t.shiftId)],
);

/** Customer/supplier sub-ledger (append-only). Balance = Σ debit − Σ credit. */
export const partyLedger = sqliteTable(
  'party_ledger',
  {
    ...base,
    partyType: text('party_type', { enum: ['C', 'S'] }).notNull(),
    partyId: text('party_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    debitMinor: integer('debit_minor').notNull(),
    creditMinor: integer('credit_minor').notNull(),
    businessDay: integer('business_day').notNull(),
    dueDay: integer('due_day'),
  },
  (t) => [index('party_ledger_party_day').on(t.partyType, t.partyId, t.businessDay)],
);

export const partyBalances = sqliteTable(
  'party_balances',
  {
    partyType: text('party_type').notNull(),
    partyId: text('party_id').notNull(),
    balanceMinor: integer('balance_minor').notNull(),
    lastActivityAt: integer('last_activity_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.partyType, t.partyId] })],
);

/** Background double-entry journal (SPEC §4). Not an accounting UI — reports read it. */
export const accounts = sqliteTable('accounts', {
  ...base,
  code: text('code').notNull(),
  systemKey: text('system_key'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  type: text('type', { enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] }).notNull(),
});

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    ...base,
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    businessDay: integer('business_day').notNull(),
    memo: text('memo'),
  },
  (t) => [index('journal_entries_source').on(t.sourceType, t.sourceId), index('journal_entries_day').on(t.businessDay)],
);

export const journalLines = sqliteTable(
  'journal_lines',
  {
    ...base,
    entryId: text('entry_id').notNull(),
    accountId: text('account_id').notNull(),
    debitMinor: integer('debit_minor').notNull(),
    creditMinor: integer('credit_minor').notNull(),
    partyType: text('party_type'),
    partyId: text('party_id'),
    businessDay: integer('business_day').notNull(),
  },
  (t) => [index('journal_lines_account_day').on(t.accountId, t.businessDay), index('journal_lines_entry').on(t.entryId)],
);

/** Per-device hash chain of every posted document (PLAN.md §7.3). Append-only. */
export const integrityChain = sqliteTable(
  'integrity_chain',
  {
    deviceId: text('device_id').notNull(),
    chainSeq: integer('chain_seq').notNull(),
    docType: text('doc_type').notNull(),
    docId: text('doc_id').notNull(),
    hash: text('hash').notNull(),
    prevHash: text('prev_hash').notNull(),
    postedAt: integer('posted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.chainSeq] }), index('integrity_chain_doc').on(t.docId)],
);

// ─────────────────────────── Phase 4: suppliers, purchases, vouchers, expenses, shifts ───────────────────────────

export const suppliers = sqliteTable(
  'suppliers',
  {
    ...base,
    ...master,
    name: text('name').notNull(),
    mobile: text('mobile'),
    address: text('address'),
    email: text('email'),
    taxNumber: text('tax_number'),
    notes: text('notes'),
  },
  (t) => [index('suppliers_name').on(t.name), index('suppliers_mobile').on(t.mobile)],
);

/**
 * Purchase invoices and purchase returns. Default: unpaid (credit with the supplier). Posted rows are
 * immutable (triggers) except the POSTED → VOIDED flip.
 */
export const purchaseDocs = sqliteTable(
  'purchase_docs',
  {
    ...base,
    type: text('type', { enum: ['PURCHASE', 'PURCHASE_RETURN'] }).notNull(),
    status: text('status', { enum: ['DRAFT', 'POSTED', 'VOIDED'] }).notNull(),
    number: text('number'),
    supplierId: text('supplier_id'),
    supplierName: text('supplier_name'),
    supplierRef: text('supplier_ref'),
    originalDocId: text('original_doc_id'),
    issuedAt: integer('issued_at'),
    businessDay: integer('business_day'),
    dueDay: integer('due_day'),
    pricesIncludeVat: integer('prices_include_vat', { mode: 'boolean' }).notNull(),
    grossMinor: integer('gross_minor').notNull().default(0),
    discountMinor: integer('discount_minor').notNull().default(0),
    netMinor: integer('net_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    paidMinor: integer('paid_minor').notNull().default(0),
    creditMinor: integer('credit_minor').notNull().default(0),
    note: text('note'),
    shiftId: text('shift_id'),
    hash: text('hash'),
    prevHash: text('prev_hash'),
    chainSeq: integer('chain_seq'),
    postedAt: integer('posted_at'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: integer('voided_at'),
  },
  (t) => [index('purchase_docs_type_status_day').on(t.type, t.status, t.businessDay), index('purchase_docs_supplier_day').on(t.supplierId, t.businessDay), index('purchase_docs_original').on(t.originalDocId)],
);

export const purchaseLines = sqliteTable(
  'purchase_lines',
  {
    ...base,
    docId: text('doc_id')
      .notNull()
      .references(() => purchaseDocs.id),
    lineNo: integer('line_no').notNull(),
    productId: text('product_id').notNull(),
    productUnitId: text('product_unit_id').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitNameSnapshot: text('unit_name_snapshot').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
    factorMilli: integer('factor_milli').notNull(),
    baseQtyMilli: integer('base_qty_milli').notNull(),
    /** Price per purchase unit as entered (incl./excl. VAT per the document flag). */
    unitCostMinor: integer('unit_cost_minor').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull(),
    netMinor: integer('net_minor').notNull(),
    taxMinor: integer('tax_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    /** Net cost per ONE base unit (excl. recoverable VAT) — what goes into the stock ledger. */
    baseUnitCostMinor: integer('base_unit_cost_minor').notNull(),
    originalLineId: text('original_line_id'),
    businessDay: integer('business_day'),
  },
  (t) => [index('purchase_lines_doc').on(t.docId), index('purchase_lines_product').on(t.productId, t.businessDay), index('purchase_lines_original').on(t.originalLineId)],
);

export const expenseCategories = sqliteTable('expense_categories', {
  ...base,
  ...master,
  name: text('name').notNull(),
  color: text('color'),
});

/**
 * Money documents (سندات): customer receipts, supplier payments, refunds, expenses, cash in/out of the
 * drawer, and party opening balances. Immutable once posted (only the POSTED → VOIDED flip).
 */
export const vouchers = sqliteTable(
  'vouchers',
  {
    ...base,
    type: text('type', { enum: ['RECEIPT', 'PAYMENT', 'CUSTOMER_REFUND', 'SUPPLIER_REFUND', 'EXPENSE', 'CASH_IN', 'CASH_OUT', 'OPENING_BALANCE'] }).notNull(),
    status: text('status', { enum: ['POSTED', 'VOIDED'] }).notNull(),
    number: text('number').notNull(),
    partyType: text('party_type', { enum: ['C', 'S'] }),
    partyId: text('party_id'),
    partyName: text('party_name'),
    categoryId: text('category_id'),
    categoryName: text('category_name'),
    method: text('method', { enum: ['cash', 'card', 'wallet', 'bank', 'credit'] }).notNull(),
    label: text('label'),
    amountMinor: integer('amount_minor').notNull(),
    /** OPENING_BALANCE only: +1 = party owes us / we owe the supplier (normal side), −1 = the other way. */
    sign: integer('sign').notNull().default(1),
    note: text('note'),
    businessDay: integer('business_day').notNull(),
    shiftId: text('shift_id'),
    postedAt: integer('posted_at').notNull(),
    hash: text('hash'),
    prevHash: text('prev_hash'),
    chainSeq: integer('chain_seq'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: integer('voided_at'),
  },
  (t) => [index('vouchers_type_day').on(t.type, t.businessDay), index('vouchers_party').on(t.partyType, t.partyId, t.businessDay), index('vouchers_shift').on(t.shiftId), uniqueIndex('vouchers_number').on(t.number)],
);

/** Cash shifts (ورديات): open with a float, close with the counted cash; difference → over/short. */
export const shifts = sqliteTable(
  'shifts',
  {
    ...base,
    number: text('number').notNull(),
    status: text('status', { enum: ['OPEN', 'CLOSED'] }).notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    openedAt: integer('opened_at').notNull(),
    openingFloatMinor: integer('opening_float_minor').notNull(),
    closedAt: integer('closed_at'),
    closedBy: text('closed_by'),
    expectedCashMinor: integer('expected_cash_minor'),
    countedCashMinor: integer('counted_cash_minor'),
    differenceMinor: integer('difference_minor'),
    summaryJson: text('summary_json'),
    note: text('note'),
    businessDay: integer('business_day').notNull(),
    hash: text('hash'),
    prevHash: text('prev_hash'),
    chainSeq: integer('chain_seq'),
  },
  (t) => [index('shifts_status').on(t.status, t.deviceId), uniqueIndex('shifts_number').on(t.number)],
);

// ─────────────────────────── Phase 5: offers ───────────────────────────

/** Offers & coupons (SPEC §5 Offers). Rules are evaluated by the shared engine (applyOffers). */
export const offers = sqliteTable(
  'offers',
  {
    ...base,
    ...master,
    name: text('name').notNull(),
    type: text('type', { enum: ['PERCENT', 'FIXED', 'BUY_X_GET_Y', 'QTY_PRICE', 'COUPON'] }).notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    startsDay: integer('starts_day'),
    endsDay: integer('ends_day'),
    priority: integer('priority').notNull().default(0),
    scopeJson: text('scope_json').notNull().default('{"all":true}'),
    valueBp: integer('value_bp'),
    valueMinor: integer('value_minor'),
    minQtyMilli: integer('min_qty_milli'),
    buyQtyMilli: integer('buy_qty_milli'),
    getQtyMilli: integer('get_qty_milli'),
    getProductId: text('get_product_id'),
    tiersJson: text('tiers_json'),
    couponCode: text('coupon_code'),
    minTotalMinor: integer('min_total_minor'),
    maxUses: integer('max_uses'),
  },
  (t) => [index('offers_active').on(t.active, t.type), uniqueIndex('offers_coupon').on(t.couponCode)],
);

/**
 * Monthly sales roll-up per product (P), customer (C), cashier (U) and day (D, key = YYYYMMDD), kept in the posting transaction.
 * Long-range reports read whole months from here and only scan lines for the partial edge months.
 * Rebuildable from sales_lines at any time (rebuildRollup); a test checks rollup == recompute.
 */
export const salesRollup = sqliteTable(
  'sales_rollup',
  {
    month: integer('month').notNull(),
    dim: text('dim', { enum: ['P', 'C', 'U', 'D'] }).notNull(),
    key: text('key').notNull(),
    invoices: integer('invoices').notNull().default(0),
    qtyMilli: integer('qty_milli').notNull().default(0),
    salesMinor: integer('sales_minor').notNull().default(0),
    netMinor: integer('net_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    discMinor: integer('disc_minor').notNull().default(0),
    retsMinor: integer('rets_minor').notNull().default(0),
    /** Σ unit_cost × base_qty (milli) — divide by 1000 for minor units. */
    costMilli: integer('cost_milli').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.dim, t.key, t.month] }), index('sales_rollup_month').on(t.dim, t.month)],
);

/** Server-signed receipts of our chain heads (daily anchors, PLAN.md §7.5). Proof that history up to here existed. */
export const anchorReceipts = sqliteTable(
  'anchor_receipts',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    chainSeq: integer('chain_seq').notNull(),
    chainHead: text('chain_head').notNull(),
    auditSeq: integer('audit_seq').notNull(),
    auditHead: text('audit_head').notNull(),
    serverTime: integer('server_time').notNull(),
    sig: text('sig').notNull(),
  },
  (t) => [index('anchor_receipts_device').on(t.deviceId, t.chainSeq)],
);

/** Messages from Daftarak (super-admin announcements), delivered with the daily check-in or by push. */
export const inbox = sqliteTable(
  'inbox',
  {
    id: text('id').primaryKey(),
    titleAr: text('title_ar').notNull(),
    bodyAr: text('body_ar').notNull(),
    titleEn: text('title_en'),
    bodyEn: text('body_en'),
    url: text('url'),
    at: integer('at').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [index('inbox_at').on(t.at)],
);
