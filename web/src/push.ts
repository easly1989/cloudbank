// Browser Web Push helpers: subscribe/unsubscribe against the service worker's
// PushManager and sync the subscription with the server.
import { getPushPublicKey, pushSubscribe, pushUnsubscribe } from "./api/client";

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export type EnableResult = "granted" | "denied" | "unsupported";

// enablePush requests notification permission, subscribes via the SW's
// PushManager, and registers the subscription with the server.
export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await getPushPublicKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    // Cast: the DOM lib types applicationServerKey as BufferSource; a Uint8Array
    // satisfies it at runtime (the generic-buffer typing just needs a nudge).
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  await pushSubscribe({
    endpoint: json.endpoint ?? "",
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  });
  return "granted";
}

// disablePush removes the browser subscription and tells the server to forget it.
export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
