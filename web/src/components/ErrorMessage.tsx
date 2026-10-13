import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { errorText } from "../errorText";

/**
 * An error in the reader's words, with the server's own text underneath, small
 * and grey, when CloudBank has no sentence for its code (#613). For an Alert,
 * a notification or a line under a form.
 */
export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { message, detail } = errorText(error, t);
  return (
    <>
      {message}
      {detail && (
        <Text component="span" display="block" size="xs" c="dimmed" mt={4}>
          {t("errors.detail", { text: detail })}
        </Text>
      )}
    </>
  );
}
