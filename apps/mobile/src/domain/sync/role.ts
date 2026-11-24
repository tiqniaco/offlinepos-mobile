/**
 * Which kind of phone this is for the shop: 'main' (the shop's phone: all data, all screens) or 'cashier'
 * (joined by QR: sells, its sales go to the main phone). Kept in kv_meta; mirrored here for the domain code.
 */
import type { Permission } from '@daftarak/shared';
import type { Db } from '../../db/types';
import { getMeta, setMeta } from '../device';

export type PhoneRole = 'main' | 'cashier';
let role: PhoneRole = 'main';

export const phoneRole = () => role;
export const isCashierPhone = () => role === 'cashier';
/** Tests / boot. */
export function setPhoneRole(r: PhoneRole) {
  role = r;
}

export async function loadPhoneRole(db: Db): Promise<PhoneRole> {
  role = (await getMeta(db, 'sync.role')) === 'cashier' ? 'cashier' : 'main';
  return role;
}
export async function savePhoneRole(db: Db, r: PhoneRole) {
  await setMeta(db, 'sync.role', r);
  role = r;
}

/** What anyone can do on a cashier phone (whatever their role): sell (with their own price/discount rights). */
export const CASHIER_PHONE_PERMISSIONS: readonly Permission[] = ['sales.create', 'price.change'];

export function phonePermissions(perms: Permission[]): Permission[] {
  return role === 'cashier' ? perms.filter((p) => CASHIER_PHONE_PERMISSIONS.includes(p)) : perms;
}
