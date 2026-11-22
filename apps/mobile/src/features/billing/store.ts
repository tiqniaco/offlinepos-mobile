/**
 * Store billing through RevenueCat (PLAN.md §8): purchase / restore in the app; the RevenueCat webhook updates the
 * licence on our server; the next check-in brings the new licence. appUserID = the server business id, so the
 * subscription follows the business to a new phone. Web / missing keys → no in-app purchase (activation codes remain).
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';

const keys = ((Constants.expoConfig?.extra as { revenuecat?: { android: string; ios: string } } | undefined)?.revenuecat ?? { android: '', ios: '' });
const apiKey = Platform.OS === 'ios' ? keys.ios : Platform.OS === 'android' ? keys.android : '';
let configuredFor: string | null = null;

export const storeAvailable = () => !!apiKey;

export function configureStore(businessId: string) {
  if (!apiKey || configuredFor === businessId) return;
  if (!configuredFor) Purchases.configure({ apiKey, appUserID: businessId });
  else void Purchases.logIn(businessId);
  configuredFor = businessId;
}

export interface StorePlan {
  id: string;
  plan: 'basic' | 'pro';
  period: 'monthly' | 'yearly';
  price: string;
  pkg: PurchasesPackage;
}

export async function storePlans(): Promise<StorePlan[]> {
  if (!apiKey) return [];
  const o = await Purchases.getOfferings();
  const pkgs = o.current?.availablePackages ?? [];
  return pkgs
    .map((pkg) => {
      const id = pkg.product.identifier;
      const m = /(basic|pro)[._-]?(monthly|yearly|annual)?/i.exec(id);
      if (!m) return null;
      return { id, plan: m[1]!.toLowerCase() as 'basic' | 'pro', period: /year|annual/i.test(id) ? ('yearly' as const) : ('monthly' as const), price: pkg.product.priceString, pkg };
    })
    .filter((x): x is StorePlan => !!x);
}

export async function buy(p: StorePlan): Promise<boolean> {
  try {
    await Purchases.purchasePackage(p.pkg);
    return true;
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

export async function restoreStore(): Promise<void> {
  if (apiKey) await Purchases.restorePurchases();
}
