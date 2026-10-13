import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import {
  ApiError,
  getAuthConfig,
  getMe,
  isTotpChallenge,
  login as apiLogin,
  logout as apiLogout,
  postSetup,
  recoveryLogin,
  type Credentials,
  type User,
} from "../api/client";
import { followOtherTabs } from "../api/preferences";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // A save in another tab reaches this one as it happens (#576).
  useEffect(() => followOtherTabs(qc), [qc]);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<User | null> => {
      try {
        return await getMe();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const value: AuthContextValue = {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: Credentials) => apiLogin(creds),
    // A totp challenge is not a completed login — leave the user unset so the
    // form can prompt for the second factor.
    onSuccess: (result) => {
      if (!isTotpChallenge(result)) qc.setQueryData(["me"], result);
    },
  });
}

/** How this server signs in: the SSO button, and whether there is a password
 *  form at all (#620). Read by the login and setup pages before anyone is in. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthConfig() {
  return useQuery({ queryKey: ["authConfig"], queryFn: getAuthConfig, staleTime: Infinity });
}

/** SSO-only servers: sign in with a username and one access recovery code. */
// eslint-disable-next-line react-refresh/only-export-components
export function useRecoveryLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, code }: { username: string; code: string }) =>
      recoveryLogin(username, code),
    onSuccess: (result) => qc.setQueryData(["me"], result.user),
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: Credentials) => postSetup(creds),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      void qc.invalidateQueries({ queryKey: ["setup-status"] });
    },
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiLogout(),
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}
