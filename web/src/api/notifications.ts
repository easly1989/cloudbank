import { api } from "./core";

// --- The notification centre (#685) ---

export type NotificationKind =
  | "new_device"
  | "two_factor_off"
  | "new_api_token"
  | "bank_sync_failed"
  | "consent_expiring"
  | "mail_stopped"
  | "mail_unrecognized"
  | "review_waiting"
  | "bills"
  | "large_transaction"
  | "low_balance"
  | "budget"
  | "goal"
  | "summary_weekly"
  | "summary_monthly"
  | "ai_report"
  | "ai_proposal"
  | "unusual_transaction"
  | "new_version";
export type NotificationChannel = "inapp" | "push" | AddressedChannel;
export type AddressedChannel =
  "email" | "matrix" | "telegram" | "discord" | "slack" | "ntfy" | "gotify" | "webhook";

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  /** The page inside the app it opens. */
  url: string;
  /** The wallet it is about, if any. */
  walletId: number | null;
  /** RFC3339. */
  createdAt: string;
  read: boolean;
}

export interface NotificationList {
  items: AppNotification[];
  unread: number;
}

export interface NotificationPreference {
  kind: NotificationKind;
  /** Security always reaches the bell; admin is listed for administrators only. */
  group: "security" | "problems" | "bills" | "money" | "summaries" | "ai" | "admin";
  channels: Record<NotificationChannel, boolean>;
  /** Collected in the daily digest outside the app (#692). */
  digest: boolean;
}

export const listNotifications = () => api.get<NotificationList>("/api/v1/notifications");

// --- The money events' settings (#691) ---

export interface NotificationSettings {
  /** Amounts reach the channels outside the app; the bell always has them. */
  amountsOutside: boolean;
  /** When things reach the reader outside the app (#692): their browser's zone, local "HH:MM"s. */
  timezone: string;
  digestAt: string;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  /** Days a transaction may wait on the Review page before it is announced. */
  reviewDays: 1 | 3 | 7 | 14;
}

/** Minor units in the account's currency; null is no threshold. */
export interface NotificationThreshold {
  accountId: number;
  largeOver: number | null;
  lowUnder: number | null;
}

export interface WalletNotificationSettings {
  included: boolean;
  thresholds: NotificationThreshold[];
}

export const getNotificationSettings = () =>
  api.get<NotificationSettings>("/api/v1/notifications/settings");
/** Only the fields sent change. */
export const setNotificationSettings = (s: Partial<NotificationSettings>) =>
  api.put<NotificationSettings>("/api/v1/notifications/settings", s);
export const getWalletNotifications = (walletId: number) =>
  api.get<WalletNotificationSettings>(`/api/v1/wallets/${walletId}/notifications`);
export const setWalletNotificationsIncluded = (walletId: number, included: boolean) =>
  api.put<WalletNotificationSettings>(`/api/v1/wallets/${walletId}/notifications`, { included });
export const setNotificationThreshold = (walletId: number, t: NotificationThreshold) =>
  api.put<NotificationThreshold>(
    `/api/v1/wallets/${walletId}/notifications/thresholds/${t.accountId}`,
    { largeOver: t.largeOver, lowUnder: t.lowUnder },
  );
export const markNotificationRead = (id: number) =>
  api.post<void>(`/api/v1/notifications/${id}/read`);
export const markAllNotificationsRead = () => api.post<void>("/api/v1/notifications/read-all");
export const getNotificationPreferences = () =>
  api.get<{ events: NotificationPreference[] }>("/api/v1/notifications/preferences");
export const setNotificationPreference = (
  kind: NotificationKind,
  channel: NotificationChannel,
  enabled: boolean,
) => api.put<void>("/api/v1/notifications/preferences", { kind, channel, enabled });
export const setNotificationDigest = (kind: NotificationKind, digest: boolean) =>
  api.put<void>("/api/v1/notifications/digest", { kind, digest });

/** The query keys of the settings and of the events' choices, shared by the settings pages. */
export const NOTIFICATION_SETTINGS_KEY = ["notification-settings"] as const;
export const NOTIFICATION_PREFERENCES_KEY = ["notification-preferences"] as const;

/** The query key of the channels below, shared by the overview and the channel pages. */
export const NOTIFICATION_CHANNELS_KEY = ["notification-channels"] as const;

export interface NotificationChannelOptions {
  topic?: number;
  silent?: boolean;
}

/** A channel set up with the reader's own address (#686–#688). */
export interface NotificationChannelState {
  channel: AddressedChannel;
  /** False when this installation cannot send on it (email with no mail server). */
  available: boolean;
  configured: boolean;
  /** The email address, the Matrix room, the Telegram chat, or only a webhook's host. */
  target: string;
  hasSecret: boolean;
  /** The reader's own Matrix homeserver (empty for the shared bot), or ntfy or Gotify server. */
  server: string;
  /** The installation has a shared Matrix or Telegram bot, and this is its ID when known. */
  shared: boolean;
  bot: string;
  /** Telegram's topic and sound; empty elsewhere. */
  options: NotificationChannelOptions;
  /** The address waits for its confirmation code and gets nothing until then (#716). */
  pending: boolean;
  /** Telegram's shared bot while pending: the links that start it with the code. */
  link?: string;
  groupLink?: string;
  /** Empty after a success; else the status or the reason of the last failure. */
  lastError: string;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export const listNotificationChannels = () =>
  api.get<{ channels: NotificationChannelState[] }>("/api/v1/notifications/channels");
/** Omit a field to keep the stored value; "" removes a secret or a server. */
export const saveNotificationChannel = (
  channel: AddressedChannel,
  body: { target?: string; secret?: string; server?: string; options?: NotificationChannelOptions },
) => api.put<void>(`/api/v1/notifications/channels/${channel}`, body);
export const deleteNotificationChannel = (channel: AddressedChannel) =>
  api.del<void>(`/api/v1/notifications/channels/${channel}`);
export const testNotificationChannel = (channel: "push" | AddressedChannel) =>
  api.post<{ ok: boolean; error?: string }>(`/api/v1/notifications/channels/${channel}/test`);
/** A new code for a pending channel: mailed, posted in the room, or a new Telegram link. */
export const resendNotificationCode = (channel: "email" | "matrix" | "telegram") =>
  api.post<void>(`/api/v1/notifications/channels/${channel}/code`);
export const confirmNotificationChannel = (channel: "email" | "matrix", code: string) =>
  api.post<void>(`/api/v1/notifications/channels/${channel}/confirm`, { code });
