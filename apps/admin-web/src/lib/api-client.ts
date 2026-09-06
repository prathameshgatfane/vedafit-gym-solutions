import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { getEnv } from "./env";
import { sessionStore } from "../stores/session.store";

/** Standard API envelopes (DEVELOPMENT_PLAN.md Section 6). */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiPaginated<T> extends ApiSuccess<T[]> {
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

/** Routes where a 401 is the answer, not a recoverable "token went stale" signal. */
const NON_REFRESHABLE_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];

type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

export const apiClient: AxiosInstance = axios.create({
  baseURL: getEnv().VITE_API_URL,
  // Required for the httpOnly refresh cookie to travel with /auth/* requests.
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * The in-flight refresh, shared by every caller.
 *
 * This is a correctness requirement, not an optimization. The API revokes an entire refresh-token
 * family when a spent token is replayed (Phase 2). Two parallel refreshes both send the same
 * cookie: the first rotates it, the second presents a token that is now revoked, and the API
 * — correctly — kills the family and logs the user out. React 18's StrictMode double-invokes
 * effects in development, so without this the app would sign developers out on most cold loads.
 *
 * Cleared once settled, so a later 401 can refresh again.
 */
let inFlightRefresh: Promise<string> | null = null;

/**
 * Trades the httpOnly refresh cookie for a new access token and stores it.
 * Rejects if the cookie is missing, expired, or has been revoked.
 */
export function refreshAccessToken(): Promise<string> {
  inFlightRefresh ??= (async () => {
    try {
      // A bare axios call, not `apiClient`: this must not pass back through the response
      // interceptor, or a failing refresh would try to refresh itself.
      const response = await axios.post<ApiSuccess<{ accessToken: string }>>(
        `${getEnv().VITE_API_URL}/auth/refresh`,
        {},
        { withCredentials: true, headers: { "Content-Type": "application/json" } },
      );

      const token = response.data.data.accessToken;
      sessionStore.setAccessToken(token);
      return token;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

/** Test-only reset, so one test's pending refresh can't leak into the next. */
export function __resetRefreshStateForTests(): void {
  inFlightRefresh = null;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? "";

    const isRefreshable =
      status === 401 &&
      config !== undefined &&
      !config._retried &&
      !NON_REFRESHABLE_PATHS.some((path) => url.includes(path));

    if (!isRefreshable) {
      return Promise.reject(error);
    }

    // Marked before awaiting, so the replay can never itself be replayed.
    config._retried = true;

    try {
      const token = await refreshAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return await apiClient.request(config);
    } catch {
      // The refresh cookie is gone, expired, or its family was revoked — nothing left to try.
      // Clearing the store is the whole redirect: `ProtectedRoute` watches `status` and sends the
      // user to /login the moment it flips to `unauthenticated`. Doing it that way keeps the
      // navigation inside the router (no full page reload) and keeps this module free of any
      // dependency on `window.location`.
      sessionStore.clear();
      return Promise.reject(error);
    }
  },
);

/** Pulls the API's `error.message` out of an Axios failure, with a sane fallback. */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (!error.response) return "Could not reach the server. Is the API running?";
  }
  return fallback;
}

/** Pulls the API's machine-readable `error.code`, for callers that branch on it. */
export function apiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    return body?.error?.code ?? null;
  }
  return null;
}
