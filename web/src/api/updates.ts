import { api } from "./core";

/** The new-version check (#582), as the server last answered it. */
export interface UpdateStatus {
  /** The admin's choice; on unless turned off. */
  enabled: boolean;
  /** False when CB_UPDATE_CHECK=false turns the check off for the installation. */
  allowed: boolean;
  /** Read from the build's version; empty for a local build, never checked. */
  channel: "stable" | "nightly" | "";
  current: string;
  latest?: string;
  available: boolean;
  /** RFC3339. */
  published?: string;
  releaseUrl?: string;
  /** RFC3339. */
  checkedAt?: string;
  error?: string;
}

export const getUpdateStatus = () => api.get<UpdateStatus>("/api/v1/admin/updates");
export const setUpdateCheck = (enabled: boolean) =>
  api.put<UpdateStatus>("/api/v1/admin/updates", { enabled });
export const checkForUpdates = () => api.post<UpdateStatus>("/api/v1/admin/updates/check");
