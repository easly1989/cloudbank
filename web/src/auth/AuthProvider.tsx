import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import {
  ApiError,
  getMe,
  login as apiLogin,
  logout as apiLogout,
  postSetup,
  type Credentials,
  type User,
} from "../api/client";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
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
    onSuccess: (user) => qc.setQueryData(["me"], user),
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
