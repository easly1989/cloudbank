import { useQuery } from "@tanstack/react-query";

import { getVersion } from "./api/client";

// AGPL-3.0 requires offering the running program's source. The footer links to
// it from every page, and Settings › About (#513) does too, so it stays in
// reach for a reader who hides the footer.
export const SOURCE_URL = "https://github.com/easly1989/cloudbank";
// The donation page lists every method (Buy Me a Coffee / PayPal / Liberapay / …).
export const DONATE_URL = "https://easly1989.github.io/donate.html";
// The user guides live with the code; the link is to main, since the guides
// are newer than some releases still running (#522).
export const GUIDE_URL = "https://github.com/easly1989/cloudbank/blob/main/docs/README.md";
export const HOMEBANK_URL = "http://homebank.free.fr";
export const API_DOCS_URL = "/api/docs";

/** The running build's version: one query wherever it is shown. */
export function useVersion(): string | undefined {
  const { data } = useQuery({ queryKey: ["version"], queryFn: getVersion, staleTime: Infinity });
  return data?.version;
}
