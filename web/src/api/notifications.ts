import { api } from "./core";

// --- The notification centre (#685) ---

export type NotificationKind = "mail_stopped" | "mail_unrecognized" | "bills";
export type NotificationChannel = "inapp" | "push" | "email" | "webhook";
export type AddressedChannel = "email" | "webhook";

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

/** The query key of the channels below, shared by the cards and the events table. */
export const NOTIFICATION_CHANNELS_KEY = ["notification-channels"] as const;

/** A channel set up with the reader's own address (#686). */
export interface NotificationChannelState {
  channel: AddressedChannel;
  /** False when this installation cannot send on it (email with no mail server). */
  available: boolean;
  configured: boolean;
  /** The email address, or only the webhook's host. */
  target: string;
  hasSecret: boolean;
  /** Empty after a success; else the status or the reason of the last failure. */
  lastError: string;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export const listNotificationChannels = () =>
  api.get<{ channels: NotificationChannelState[] }>("/api/v1/notifications/channels");
/** Omit target to keep the stored one; omit secret to keep it, "" removes it. */
export const saveNotificationChannel = (
  channel: AddressedChannel,
  body: { target?: string; secret?: string },
) => api.put<void>(`/api/v1/notifications/channels/${channel}`, body);
export const deleteNotificationChannel = (channel: AddressedChannel) =>
  api.del<void>(`/api/v1/notifications/channels/${channel}`);
export const testNotificationChannel = (channel: "push" | AddressedChannel) =>
  api.post<{ ok: boolean; error?: string }>(`/api/v1/notifications/channels/${channel}/test`);
