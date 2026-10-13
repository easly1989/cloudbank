import { notifications } from "@mantine/notifications";

import { ErrorMessage } from "./components/ErrorMessage";

/** Shows an error as a red notification, in the reader's words (#613). */
export function notifyError(err: unknown): void {
  notifications.show({ color: "red", message: <ErrorMessage error={err} /> });
}
