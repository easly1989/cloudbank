import { Text } from "@mantine/core";
import { Fragment, type ReactNode } from "react";

import { sensitive } from "../privacy";
import { splitAmounts } from "./insightsText";

/** A paragraph the AI wrote, its amounts in the money face and hidden in privacy mode. */
export function withAmounts(text: string): ReactNode[] {
  return splitAmounts(text).map((part, i) =>
    i % 2 ? (
      <Text
        key={i}
        span
        ff="monospace"
        fz="inherit"
        style={{ whiteSpace: "nowrap" }}
        {...sensitive}
      >
        {part}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
