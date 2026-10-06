import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getUpdateStatus, savePreferences, type UpdateStatus } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";

const HOUR = 60 * 60 * 1000;
/** A closed card about a nightly comes back after this long, not the next day. */
export const NIGHTLY_QUIET_MS = 7 * 24 * HOUR;

type Dismissed = { version: string; at: string } | undefined;

/**
 * Whether the sidebar card shows (#582): a newer version is out, the check is
 * on, and the admin has not closed the card for it. A stable release closed
 * stays closed until the next one; a nightly, for a week, since a new one is
 * published almost every day.
 */
export function showUpdateCard(
  st: UpdateStatus | undefined,
  dismissed: Dismissed,
  now = Date.now(),
) {
  if (!st?.available || !st.enabled || !st.allowed || !st.latest) return false;
  if (!dismissed) return true;
  if (st.channel === "nightly") return now - Date.parse(dismissed.at) >= NIGHTLY_QUIET_MS;
  return dismissed.version !== st.latest;
}

/** The check, for admins only: they are the ones who can update the server. */
export function useUpdateStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["updates"],
    queryFn: getUpdateStatus,
    enabled: !__DEMO__ && !!user?.isAdmin,
    staleTime: HOUR,
    refetchInterval: HOUR,
  });
}

/** The card's state and the way to close it. */
export function useUpdateCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useUpdateStatus();
  const dismissed = user?.preferences?.updateDismissed;
  const dismiss = useMutation({
    mutationFn: (version: string) =>
      savePreferences(qc, { updateDismissed: { version, at: new Date().toISOString() } }),
  });
  return {
    status: data,
    visible: showUpdateCard(data, dismissed),
    dismiss: () => data?.latest && dismiss.mutate(data.latest),
  };
}
