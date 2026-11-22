/** Web preview: no store billing. */
export const storeAvailable = () => false;
export function configureStore(_: string) {}
export interface StorePlan {
  id: string;
  plan: 'basic' | 'pro';
  period: 'monthly' | 'yearly';
  price: string;
  pkg: unknown;
}
export async function storePlans(): Promise<StorePlan[]> {
  return [];
}
export async function buy(_: StorePlan): Promise<boolean> {
  return false;
}
export async function restoreStore(): Promise<void> {}
