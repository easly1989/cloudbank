import type { ReactNode } from "react";

import classes from "./reports.module.css";

// The figures that answer a tab's question, above everything else on it: a
// label saying what the number is, the number, and a line of context under it.
export function Figures({ children }: { children: ReactNode }) {
  return <div className={classes.answer}>{children}</div>;
}

export function Figure({
  label,
  value,
  sub,
  color,
  big = false,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  big?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <div className={classes.figureLabel}>{label}</div>
      <div className={classes.figure} data-big={big || undefined} style={{ color }}>
        {value}
      </div>
      {sub && <div className={classes.figureSub}>{sub}</div>}
    </div>
  );
}
