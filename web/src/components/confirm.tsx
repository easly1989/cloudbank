import { Button, Group, Modal, Stack, Text, getDefaultZIndex } from "@mantine/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { ConfirmContext, type Ask, type ConfirmOptions } from "./confirmContext";
import { useTranslation } from "react-i18next";

// A confirmation is, by definition, asked on top of something: the drawer whose
// edits it is about to throw away, the modal whose row it is about to delete.
// So it sits one step above every modal and drawer instead of level with them.
//
// Level with them is not a tie it can win. Mantine renders every portal into
// one shared node and gives each modal its place there when it MOUNTS, not
// when it opens — and this one mounts with the app, before any page's drawer.
// At equal z-index the later place paints on top, so the confirmation came up
// underneath the entry drawer with its Discard button covered (#462).
const CONFIRM_Z_INDEX = getDefaultZIndex("modal") + 1;

// Asking before something irreversible.
//
// This is the one job a modal is good at: stopping you to decide something you
// cannot undo. Everything else — entering a transaction, editing one, importing
// — is work you do beside the ledger, and that belongs in a side sheet where the
// rows stay visible.
//
// The hook keeps call sites as short as the `window.confirm` they replace:
//
//   if (await confirm({ title, body, confirmLabel, danger: true })) remove();
//
// but the result is a real dialog: focus-trapped, escapable, translated, and
// able to say what will actually happen rather than showing a browser chrome
// string nobody can style or translate.

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // A second question arriving while one is open replaces it, and the one
        // being replaced answers "no" on its way out. Without that its caller
        // waits forever on a promise nothing will ever settle — which, for a
        // form asking whether to discard your edits, means a panel that can no
        // longer be closed.
        setPending((prev) => {
          prev?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  // Closing by any route — the button, Escape, the overlay — is a "no". A
  // dialog that treats dismissal as consent is how people delete things they
  // did not mean to.
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        opened={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title}
        centered
        size="sm"
        zIndex={CONFIRM_Z_INDEX}
      >
        <Stack>
          {pending?.body && <Text size="sm">{pending.body}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button
              color={pending?.danger ? "red" : undefined}
              onClick={() => settle(true)}
              data-autofocus
            >
              {pending?.confirmLabel ?? t("common.confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </ConfirmContext.Provider>
  );
}
