/**
 * Permission keys and the three system roles (SPEC §5 "Users on one device").
 * Checks happen in domain services (not only by hiding buttons).
 */

export const PERMISSIONS = [
  'sales.create',
  'sales.return',
  'price.change',
  'doc.void',
  'cost.view',
  'profit.view',
  'products.manage',
  'stock.adjust',
  'parties.manage',
  'purchases.manage',
  'expenses.manage',
  'shift.manage',
  'reports.view',
  'settings.manage',
  'users.manage',
  'backup.manage',
  'subscription.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey = 'owner' | 'manager' | 'cashier';

export interface RoleDefinition {
  key: SystemRoleKey;
  nameAr: string;
  nameEn: string;
  permissions: Permission[];
  /** Discount caps in basis points (10000 = 100%). */
  maxItemDiscountBp: number;
  maxInvoiceDiscountBp: number;
}

const ALL = [...PERMISSIONS];

export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    key: 'owner',
    nameAr: 'المالك',
    nameEn: 'Owner',
    permissions: ALL,
    maxItemDiscountBp: 10_000,
    maxInvoiceDiscountBp: 10_000,
  },
  {
    key: 'manager',
    nameAr: 'مدير',
    nameEn: 'Manager',
    permissions: ALL.filter((p) => !['users.manage', 'subscription.manage', 'backup.manage'].includes(p)),
    maxItemDiscountBp: 3_000,
    maxInvoiceDiscountBp: 2_000,
  },
  {
    key: 'cashier',
    nameAr: 'كاشير',
    nameEn: 'Cashier',
    // Cashier can't change prices, can't void, can't see cost/profit (SPEC §5).
    permissions: ['sales.create', 'sales.return', 'parties.manage'],
    maxItemDiscountBp: 500,
    maxInvoiceDiscountBp: 500,
  },
];

export function roleHas(permissions: readonly string[], p: Permission): boolean {
  return permissions.includes(p);
}
