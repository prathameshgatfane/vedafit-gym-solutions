import { create } from "zustand";

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
}

export type SessionStatus = "bootstrapping" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  /** Memory only — never localStorage. The refresh token is the httpOnly `platform_refresh` cookie. */
  accessToken: string | null;
  user: PlatformUser | null;
  setAccessToken: (token: string | null) => void;
  setSession: (user: PlatformUser) => void;
  markUnauthenticated: () => void;
  clear: () => void;
}

const empty = { accessToken: null as string | null, user: null as PlatformUser | null };

export const useSessionStore = create<SessionState>((set) => ({
  status: "bootstrapping",
  ...empty,
  setAccessToken: (token) => set({ accessToken: token }),
  setSession: (user) => set({ status: "authenticated", user }),
  markUnauthenticated: () => set({ status: "unauthenticated", ...empty }),
  clear: () => set({ status: "unauthenticated", ...empty }),
}));

export const sessionStore = {
  getAccessToken: () => useSessionStore.getState().accessToken,
  setAccessToken: (token: string | null) => useSessionStore.getState().setAccessToken(token),
  clear: () => useSessionStore.getState().clear(),
};
