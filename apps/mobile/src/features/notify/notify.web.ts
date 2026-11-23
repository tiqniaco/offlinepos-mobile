export async function planNotifications(_: { ask?: boolean } = {}) {}
export async function pushToken(): Promise<string | undefined> {
  return undefined;
}
export async function showAnnouncements(_: unknown[]) {}
export function openNotificationUrl(url: string | null | undefined, go: (url: string) => void) {
  if (url && url !== 'store') go(url);
}
export function onNotificationTap(_: (url: string) => void) {
  return () => undefined;
}
