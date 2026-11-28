import { Button, Stack, Text } from "@mantine/core";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * One dashboard widget whose data did not load (queryClient.ts, #804) says so
 * inside its own card, and the rest of the dashboard stays: a widget is one of
 * many, so it does not take the page down the way a page's own query does.
 */
export function WidgetErrorBoundary({ children }: { children: ReactNode }) {
  const { reset } = useQueryErrorResetBoundary();
  return <Boundary onReset={reset}>{children}</Boundary>;
}

class Boundary extends Component<
  { children: ReactNode; onReset: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <WidgetError
        onRetry={() => {
          this.props.onReset();
          this.setState({ failed: false });
        }}
      />
    );
  }
}

function WidgetError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Stack role="alert" gap={8} align="flex-start" p="md">
      <Text size="sm" c="red">
        {t("dashboard.widgetError")}
      </Text>
      <Button size="xs" variant="default" onClick={onRetry}>
        {t("dashboard.widgetRetry")}
      </Button>
    </Stack>
  );
}
