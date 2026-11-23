# Messages from Daftarak (super-admin → users)

**Admin:** sidebar → **الإشعارات** (or «إرسال إشعار» inside a business).

| Field | Notes |
| --- | --- |
| Audience | everyone · by country (EG/SA), plan (free/basic/pro), status (trial/active/past due/suspended) · one business |
| Title and body | Arabic is required (80 and 500 characters). English is optional and shown to users who chose English. |
| Opens screen | subscription, backup, printers, reports, offers, sell, products, customers, or the store (update). The list is fixed (`ANNOUNCE_URLS`). |
| Visible for | 1–60 days. A phone that checks in later inside this window still receives the message. |
| Instant push | on by default. |

Before sending, the page shows the reach: businesses, phones, and how many of those can get an instant push. History shows push sent/failed and in-app deliveries, and you can **withdraw** a message.

## How it arrives

1. **Push** (`apps/api/src/announce/announce.ts → sendExpoPush`) goes to every device with a push token, through the Expo Push API in batches of 100. Optional secret: `EXPO_ACCESS_TOKEN`.
2. **Check-in:** `/v1/checkin` returns `announcements` created after the device's last delivered one, still live, and matching the business. A new phone only gets messages from the last 14 days before it was activated.
3. **Phone** (`domain/inbox`) stores each message once by id: push and check-in never duplicate it. Only allow-listed links are kept, and the 100 newest are retained. If the phone has no push token, a message that arrives with the check-in is shown as a local notification.
4. **UI:** a bell with an unread badge on the home header, a banner for the newest unread message, and More → «رسائل دفترك».

The push token is sent in the check-in only when it changes. Push needs `EAS_PROJECT_ID` at build time (`getExpoPushTokenAsync`). Without it, only the check-in path works.
