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
  subSensitive = false,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  big?: boolean;
  testId?: string;
  /** The line under the figure carries figures or names of its own, so it is
      hidden with them in privacy mode (#626). The figure itself always is. */
  subSensitive?: boolean;
}) {
  return (
    <div data-testid={testId}>
      <div className={classes.figureLabel}>{label}</div>
      <div
        className={classes.figure}
        data-big={big || undefined}
        data-cb-sensitive
        style={{ color }}
      >
        {value}
      </div>
      {sub && (
        <div className={classes.figureSub} data-cb-sensitive={subSensitive || undefined}>
          {sub}
        </div>
      )}
    </div>
  );
}
