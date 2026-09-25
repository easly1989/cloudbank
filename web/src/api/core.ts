// Minimal fetch wrapper for the CloudBank JSON API. All requests are
// same-origin and send cookies (session auth, added in a later milestone).

import { demoMessage } from "../demo/messages";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** The server's error code (e.g. "demo_limit"), when it sent one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    // statusText is empty over HTTP/2, and a proxy/CDN error (e.g. a 502 while a
    // slow upstream request is in flight) has an HTML body, not our JSON — so fall
    // back to a non-empty message rather than showing an empty error toast.
    let message = res.statusText || `Request failed (HTTP ${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body?.error?.message) message = body.error.message;
      code = body?.error?.code;
    } catch {
      // non-JSON error body; keep the fallback
    }
    if (__DEMO__) message = demoMessage(res.status, code) ?? message;
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, headers }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface Health {
  status: "ok" | "unhealthy";
  error?: string;
}

export const getHealth = () => api.get<Health>("/healthz");

export const getVersion = () => api.get<{ version: string }>("/api/v1/version");

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
