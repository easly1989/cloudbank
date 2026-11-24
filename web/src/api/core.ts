// Minimal fetch wrapper for the CloudBank JSON API. All requests are
// same-origin and send cookies (session auth, added in a later milestone).

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

/** The query parameter the service worker lets through to the network. */
export const REAUTH_PARAM = "reauth";
const REAUTH_AT = "cb-proxy-reauth";

/**
 * A sign-in proxy in front of CloudBank (Authelia forward-auth, #774) answers
 * the API with its own 401 once its session ends. The service worker serves
 * every page from its cache, so the browser would never visit the proxy's
 * portal again. Reload the page through the network instead, with a marker
 * the service worker skips, and let the proxy send it to the portal. At most
 * once every 30 seconds, so a proxy that keeps refusing shows the error
 * instead of reloading forever.
 */
export function reauthAtProxy(win: Window = window, now = () => Date.now()): boolean {
  try {
    const last = Number(win.sessionStorage.getItem(REAUTH_AT) ?? 0);
    if (now() - last < 30_000) return false;
    win.sessionStorage.setItem(REAUTH_AT, String(now()));
  } catch {
    return false;
  }
  const url = new URL(win.location.href);
  url.searchParams.set(REAUTH_PARAM, String(now()));
  win.location.assign(url.toString());
  return true;
}

/** Back from the proxy: drop the marker from the address bar. */
export function dropReauthParam(win: Window = window) {
  const url = new URL(win.location.href);
  if (!url.searchParams.has(REAUTH_PARAM)) return;
  url.searchParams.delete(REAUTH_PARAM);
  win.history.replaceState(win.history.state, "", url.toString());
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      // A form sets its own multipart type, with the boundary.
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
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
    // Every 401 CloudBank sends carries a code; one without came from the proxy.
    if (res.status === 401 && !code) reauthAtProxy();
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
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
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
