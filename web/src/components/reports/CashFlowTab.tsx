import type { ReportContext } from "./reportContext";

// The tab itself comes with #491; the frame (#489) only needs its name.
export function CashFlowTab({ ctx }: { ctx: ReportContext }) {
  void ctx;
  return null;
}
