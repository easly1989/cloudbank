import { api } from "./core";

// --- The notification centre (#685) ---

export type NotificationKind = "mail_stopped" | "mail_unrecognized" | "bills";
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
  group: "problems" | "bills";
  channels: Record<NotificationChannel, boolean>;
}

export const listNotifications = () => api.get<NotificationList>("/api/v1/notifications");
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
