import type { ReportContext } from "./reportContext";

// The tab itself comes with #490; the frame (#489) only needs its name.
export function SpendingTab({ ctx }: { ctx: ReportContext }) {
  void ctx;
  return null;
}
