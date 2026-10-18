import { api } from "./core";

// --- The notification centre (#685) ---

export type NotificationKind = "mail_stopped" | "mail_unrecognized" | "bills";
export type NotificationChannel = "inapp" | "push";

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
