import { api } from "./core";

// --- Web Push subscription management ---

export const getPushPublicKey = () => api.get<{ publicKey: string }>("/api/v1/push/publickey");

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const pushSubscribe = (sub: PushSubscriptionJSON) =>
  api.post<void>("/api/v1/push/subscribe", sub);

export const pushUnsubscribe = (endpoint: string) =>
  api.post<void>("/api/v1/push/unsubscribe", { endpoint });
