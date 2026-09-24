import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import { TourButton } from "../onboarding/TourButton";
import { usePageTour } from "../onboarding/tourContext";
import type { TourId } from "../onboarding/tours";

// The one page header in the app: what the page is called, optionally a line
// saying what it is for, and the page's own actions on the right.
//
// It exists because the alternative had grown into sixteen slightly different
// headers — the hint above the buttons on one page and below them on the next,
// the title alone on a third — and a reader moving between pages pays for every
// one of those differences without ever being told why.
//
// On a narrow screen the whole action block drops under the title, and the
// buttons inside it wrap among themselves. Both are needed: the register's
// header carries an account picker and five buttons, and a block that only
// moved down as one piece would still be 400px wider than a phone.
export function PageHeader({
  title,
  hint,
  actions,
  prominent = false,
  tour,
}: {
  /** Usually the page's name; the register passes a control, because there the
      name of the account *is* the title and switching it is one click. */
  title: ReactNode;
  /** One line on what the page is for. Skip it when the title already says. */
  hint?: ReactNode;
  /** Buttons, switches, anything that acts on the page as a whole. */
  actions?: ReactNode;
  /** The register and the overview: the two screens the app is used from. The
      boards give their header buttons 44px and every other page's 40, with a
      13px primary instead of 14 — the difference between a page you work in
      and one you visit. The sizes themselves are in app.css (#465). */
  prominent?: boolean;
  /** The page's tour: offered the first time the page is opened, and replayed
      from a ? at the head of the actions (#421). */
  tour?: TourId;
}) {
  usePageTour(tour);
  return (
    <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
      <Stack gap={2} style={{ minWidth: 0, flex: "1 1 auto" }}>
        <Title order={2}>{title}</Title>
        {hint && (
          <Text c="dimmed" size="sm" maw={680}>
            {hint}
          </Text>
        )}
      </Stack>
      {(actions || tour) && (
        <Group
          className="cb-page-actions"
          data-prominent={prominent || undefined}
          gap="xs"
          wrap="wrap"
          justify="flex-end"
          style={{ minWidth: 0 }}
        >
          {tour && <TourButton id={tour} size={prominent ? 44 : 40} />}
          {actions}
        </Group>
      )}
    </Group>
  );
}
