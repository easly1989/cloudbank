import i18n from "../i18n";

/**
 * The reader's words for the demo's own refusals, which the server sends in
 * English. Undefined leaves the server's message as it is.
 */
export function demoMessage(status: number, code: string | undefined): string | undefined {
  if (code === "demo_limit") return i18n.t("demo.limit");
  if (status === 413 || code === "too_large") return i18n.t("demo.tooLarge");
  return undefined;
}
