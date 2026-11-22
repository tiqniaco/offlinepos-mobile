/**
 * Users & roles on one device (SPEC §5). Quick switch with a 4–6 digit PIN.
 * Every change is audit-logged in the same transaction.
 */
import { and, asc, eq, isNull, count } from 'drizzle-orm';
import { HybridLogicalClock, SYSTEM_ROLES, uuidv7, roleHas, type Permission } from '@daftarak/shared';
import type { AppDb } from '../../db/client';
import { roles, users } from '../../db/schema';
import { appendAudit } from '../audit/audit';
import { assertCanWrite, assertWithinLimit } from '../licence/guard';
import { checkPin, hashPin, isValidPin, isWeakPin, lockoutAfterFailure } from './pin';

export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;

export interface SessionUser {
  id: string;
  name: string;
  color: string;
  roleId: string;
  roleKey: string | null;
  roleName: string;
  permissions: Permission[];
  maxItemDiscountBp: number;
  maxInvoiceDiscountBp: number;
  biometricEnabled: boolean;
}

export class PinError extends Error {
  constructor(public readonly code: 'wrong' | 'locked' | 'invalid' | 'weak', public readonly lockedUntil?: number) {
    super(code);
  }
}

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`missing permission ${permission}`);
  }
}

const USER_COLORS = ['#18A999', '#F2A93B', '#3B82C4', '#D9534A', '#3F9D4B', '#B17016', '#0B6B63'];

let hlc: HybridLogicalClock | null = null;
export function hlcFor(deviceCode: string) {
  if (!hlc) hlc = new HybridLogicalClock(deviceCode);
  return hlc;
}

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** Seed the three system roles. Called once during onboarding. Returns role ids by key. */
export async function seedSystemRoles(tx: Tx, ctx: { deviceId: string; deviceCode: string; now: number }) {
  const ids: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const id = uuidv7(ctx.now);
    ids[r.key] = id;
    await tx.insert(roles).values({
      id,
      key: r.key,
      name: r.nameAr,
      isSystem: true,
      permissionsJson: JSON.stringify(r.permissions),
      maxItemDiscountBp: r.maxItemDiscountBp,
      maxInvoiceDiscountBp: r.maxInvoiceDiscountBp,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      deviceId: ctx.deviceId,
      hlc: hlcFor(ctx.deviceCode).tick(),
    });
  }
  return ids as Record<'owner' | 'manager' | 'cashier', string>;
}

export async function insertUser(
  tx: Tx,
  input: { name: string; pin: string; roleId: string; createdBy: string | null; deviceId: string; deviceCode: string; now: number; colorIndex: number },
): Promise<string> {
  if (!isValidPin(input.pin)) throw new PinError('invalid');
  if (isWeakPin(input.pin)) throw new PinError('weak');
  const h = await hashPin(input.pin);
  const id = uuidv7(input.now);
  await tx.insert(users).values({
    id,
    name: input.name.trim(),
    roleId: input.roleId,
    pinHash: h.hash,
    pinSalt: h.salt,
    pinParams: h.params,
    color: USER_COLORS[input.colorIndex % USER_COLORS.length]!,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.createdBy,
    deviceId: input.deviceId,
    hlc: hlcFor(input.deviceCode).tick(),
  });
  await appendAudit(tx, {
    action: 'user.create',
    entity: 'users',
    entityId: id,
    after: { name: input.name.trim(), roleId: input.roleId },
    userId: input.createdBy,
    deviceId: input.deviceId,
    at: input.now,
  });
  return id;
}

export async function listActiveUsers(db: AppDb) {
  return db
    .select({ id: users.id, name: users.name, color: users.color, roleName: roles.name, roleKey: roles.key, biometricEnabled: users.biometricEnabled, lockedUntil: users.lockedUntil })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.isActive, true), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt));
}

export async function listRoles(db: AppDb) {
  return db.select().from(roles).where(isNull(roles.deletedAt)).orderBy(asc(roles.createdAt));
}

async function toSessionUser(db: AppDb, userId: string): Promise<SessionUser> {
  const r = await db.select().from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId)).limit(1);
  const row = r[0]!;
  return {
    id: row.users.id,
    name: row.users.name,
    color: row.users.color,
    roleId: row.roles.id,
    roleKey: row.roles.key,
    roleName: row.roles.name,
    permissions: JSON.parse(row.roles.permissionsJson) as Permission[],
    maxItemDiscountBp: row.roles.maxItemDiscountBp,
    maxInvoiceDiscountBp: row.roles.maxInvoiceDiscountBp,
    biometricEnabled: row.users.biometricEnabled,
  };
}

/** PIN unlock with lock-out. Works in every licence mode (reading is always allowed). */
export async function unlockWithPin(db: AppDb, userId: string, pin: string, now = Date.now()): Promise<SessionUser> {
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!u || !u.isActive) throw new PinError('invalid');
  if (u.lockedUntil && u.lockedUntil > now) throw new PinError('locked', u.lockedUntil);
  if (!(await checkPin(pin, u))) {
    const failed = u.failedPinAttempts + 1;
    const lockedUntil = lockoutAfterFailure(failed, now);
    await db.update(users).set({ failedPinAttempts: failed, lockedUntil }).where(eq(users.id, userId));
    if (lockedUntil) throw new PinError('locked', lockedUntil);
    throw new PinError('wrong');
  }
  await db.update(users).set({ failedPinAttempts: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, userId));
  return toSessionUser(db, userId);
}

/** Biometric unlock (only for users who enabled it). The OS prompt is shown by the caller. */
export async function unlockWithBiometric(db: AppDb, userId: string): Promise<SessionUser> {
  const s = await toSessionUser(db, userId);
  if (!s.biometricEnabled) throw new PinError('invalid');
  await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, userId));
  return s;
}

export function requirePermission(user: SessionUser, p: Permission): void {
  if (!roleHas(user.permissions, p)) throw new PermissionError(p);
}

export async function addUser(
  db: AppDb,
  actor: SessionUser,
  input: { name: string; pin: string; roleId: string },
  device: { id: string; code: string },
): Promise<string> {
  requirePermission(actor, 'users.manage');
  const [{ n }] = (await db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt)))) as [{ n: number }];
  assertWithinLimit('users', n);
  const now = Date.now();
  return db.transaction((tx) =>
    insertUser(tx, { ...input, createdBy: actor.id, deviceId: device.id, deviceCode: device.code, now, colorIndex: n }),
  );
}

export async function updateUser(
  db: AppDb,
  actor: SessionUser,
  userId: string,
  patch: { name?: string; roleId?: string; isActive?: boolean; pin?: string; biometricEnabled?: boolean },
  device: { id: string; code: string },
): Promise<void> {
  const self = actor.id === userId;
  // Everyone may change their own PIN / biometric; anything else needs users.manage.
  const onlySelfFields = self && patch.name === undefined && patch.roleId === undefined && patch.isActive === undefined;
  if (!onlySelfFields) requirePermission(actor, 'users.manage');
  assertCanWrite();
  const now = Date.now();
  await db.transaction(async (tx) => {
    const before = (await tx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!before) throw new Error('user not found');
    const set: Partial<typeof users.$inferInsert> = { updatedAt: now, hlc: hlcFor(device.code).tick() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.roleId !== undefined) set.roleId = patch.roleId;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (patch.biometricEnabled !== undefined) set.biometricEnabled = patch.biometricEnabled;
    if (patch.pin !== undefined) {
      if (!isValidPin(patch.pin)) throw new PinError('invalid');
      if (isWeakPin(patch.pin)) throw new PinError('weak');
      const h = await hashPin(patch.pin);
      Object.assign(set, { pinHash: h.hash, pinSalt: h.salt, pinParams: h.params, failedPinAttempts: 0, lockedUntil: null });
    }
    // Never leave the business without an active owner.
    if ((patch.isActive === false || patch.roleId !== undefined) && before.roleId) {
      const ownerRole = (await tx.select().from(roles).where(eq(roles.key, 'owner')).limit(1))[0]!;
      if (before.roleId === ownerRole.id && patch.roleId !== ownerRole.id) {
        const owners = await tx.select({ id: users.id }).from(users).where(and(eq(users.roleId, ownerRole.id), eq(users.isActive, true)));
        if (owners.length <= 1) throw new Error('last_owner');
      }
    }
    await tx.update(users).set(set).where(eq(users.id, userId));
    const action = patch.pin !== undefined ? 'user.pin_change' : patch.isActive === false ? 'user.disable' : 'user.update';
    await appendAudit(tx, {
      action,
      entity: 'users',
      entityId: userId,
      before: { name: before.name, roleId: before.roleId, isActive: before.isActive, biometricEnabled: before.biometricEnabled },
      after: { name: patch.name, roleId: patch.roleId, isActive: patch.isActive, biometricEnabled: patch.biometricEnabled, pinChanged: patch.pin !== undefined },
      userId: actor.id,
      deviceId: device.id,
      at: now,
    });
  });
}

export async function activeUserCount(db: AppDb): Promise<number> {
  const r = await db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt)));
  return r[0]?.n ?? 0;
}
