import { create } from "zustand";

/** Shape of `GET /api/v1/auth/me`'s `data` payload. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  branchId: string | null;
  role: { id: string; name: string; permissions: string[] };
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  /**
   * IANA zone. The clock the gym runs on, which is not necessarily the browser's — attendance
   * times and the register's "today" are read in this zone (Locked Decision 1.17.4).
   */
  timezone: string;
}

export interface SessionBranch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface SessionSnapshot {
  user: SessionUser;
  organization: SessionOrganization;
  branches: SessionBranch[];
}

/**
 * `bootstrapping` is the state on every cold load, while the app trades the httpOnly refresh
 * cookie for an access token. It exists so `ProtectedRoute` can tell "not logged in" apart from
 * "don't know yet" — without it, every page reload flashes the login screen before bouncing back.
 */
export type SessionStatus = "bootstrapping" | "authenticated" | "unauthenticated";

interface SessionState {
  status: SessionStatus;
  /**
   * Held in memory only — deliberately never localStorage/sessionStorage. Phase 2 went to the
   * trouble of putting the refresh token in an httpOnly cookie precisely so that a XSS foothold
   * can't walk away with a session; parking the access token somewhere script-readable would
   * hand most of that back. The cost is one `POST /auth/refresh` per cold load.
   * See DEVELOPMENT_PLAN.md Section 9 (2026-09-06).
   */
  accessToken: string | null;
  user: SessionUser | null;
  organization: SessionOrganization | null;
  branches: SessionBranch[];
  /** Which branch the UI is currently scoped to. Null for org-wide roles viewing everything. */
  activeBranchId: string | null;

  setAccessToken: (token: string | null) => void;
  setSession: (snapshot: SessionSnapshot) => void;
  setActiveBranch: (branchId: string | null) => void;
  markUnauthenticated: () => void;
  clear: () => void;
  hasPermission: (key: string) => boolean;
}

const emptySession = {
  accessToken: null,
  user: null,
  organization: null,
  branches: [] as SessionBranch[],
  activeBranchId: null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  status: "bootstrapping",
  ...emptySession,

  setAccessToken: (token) => set({ accessToken: token }),

  setSession: ({ user, organization, branches }) =>
    set({
      status: "authenticated",
      user,
      organization,
      branches,
      // A branch-scoped user is pinned to their own branch; an org-wide user starts unscoped
      // (meaning "all branches") rather than being silently locked to the first one.
      activeBranchId: user.branchId,
    }),

  setActiveBranch: (branchId) => set({ activeBranchId: branchId }),

  markUnauthenticated: () => set({ status: "unauthenticated", ...emptySession }),

  clear: () => set({ status: "unauthenticated", ...emptySession }),

  hasPermission: (key) => get().user?.role.permissions.includes(key) ?? false,
}));

/**
 * Non-React accessors. `api-client.ts` runs outside the component tree and needs to read the
 * current token and clear the session on an unrecoverable 401, which hooks can't do.
 */
export const sessionStore = {
  getAccessToken: () => useSessionStore.getState().accessToken,
  setAccessToken: (token: string | null) => useSessionStore.getState().setAccessToken(token),
  clear: () => useSessionStore.getState().clear(),
};
