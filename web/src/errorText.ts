import type { TFunction } from "i18next";

import { ApiError } from "./api/core";
import { demoMessage } from "./demo/messages";
import i18n from "./i18n";

/**
 * What the reader is told about an error: a sentence in their language and,
 * when CloudBank has no sentence of its own for the server's code, the
 * server's English text as a detail underneath (#603, #613).
 */
export interface ErrorText {
  message: string;
  /** The server's own words, shown small and grey under the message. */
  detail?: string;
}

/**
 * The server's codes that have a sentence of their own, under errors.<code>.
 * Each is one a person meets in normal use; a code left out gets a fallback
 * by status, with the server's text as the detail.
 */
const TRANSLATED = new Set([
  "invalid_credentials",
  "username_taken",
  "invalid_password",
  "invalid_code",
  "token_invalid",
  "password_login_off",
  "unauthorized",
  "duplicate",
  "conflict",
  "in_use",
  "base_currency",
  "has_children",
  "scheduled",
  "goal_closed",
  "same_account",
  "split_mismatch",
  "invalid_regex",
  "consent_expired",
  "credentials_rejected",
  "provider_error",
  "not_configured",
  "ai_error",
  "ai_disabled",
  "no_data",
  "rate_limited",
  "hourly_limit",
  "too_large",
  "invalid_file",
  "restore_failed",
  "setup_done",
  "csrf",
  "stale_preferences",
  "demo_limit",
  "demo_full",
  "unavailable",
  "reauth",
  "flow_not_found",
  "login_refused",
  "mail_error",
  "microsoft_error",
  "host_not_public",
  "unreachable",
  "tls_failed",
  "ai_not_configured",
  "ai_no_vision",
]);

/**
 * Codes whose server text says what the sentence cannot: which provider, what
 * the AI answered, why the backup did not restore, what the mail server said. They keep it as a detail.
 */
const KEEP_DETAIL = new Set([
  "provider_error",
  "ai_error",
  "restore_failed",
  "login_refused",
  "mail_error",
  "microsoft_error",
  "unreachable",
  "tls_failed",
  "ai_no_vision",
]);

/** Turns any error into the words the reader sees. */
export function errorText(err: unknown, t: TFunction = i18n.t): ErrorText {
  if (err instanceof ApiError) {
    const code = err.code ?? "";
    if (__DEMO__) {
      const demo = demoMessage(err.status, code);
      if (demo) return { message: demo };
    }
    if (TRANSLATED.has(code)) {
      return {
        message: t(`errors.${code}`),
        detail: KEEP_DETAIL.has(code) && err.message ? err.message : undefined,
      };
    }
    const message =
      err.status === 404
        ? t("errors.fallback.notFound")
        : err.status >= 500
          ? t("errors.fallback.server")
          : t("errors.fallback.other");
    return { message, detail: err.message || undefined };
  }
  // fetch rejects with a TypeError when the server cannot be reached at all.
  if (err instanceof TypeError) return { message: t("errors.network") };
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  return { message: t("errors.fallback.other"), detail: detail || undefined };
}
