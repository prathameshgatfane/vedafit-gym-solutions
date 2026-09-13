import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { getEnv } from "./env";
import { sessionStore } from "../stores/session.store";

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

const NON_REFRESHABLE_PATHS = [
  "/auth/platform/login",
  "/auth/platform/refresh",
  "/auth/platform/logout",
];

type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

export const apiClient: AxiosInstance = axios.create({
  baseURL: getEnv().VITE_API_URL,
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

let inFlightRefresh: Promise<string> | null = null;

/** Trades the httpOnly `platform_refresh` cookie — never staff `/auth/refresh`. */
export function refreshAccessToken(): Promise<string> {
  inFlightRefresh ??= (async () => {
    try {
      const response = await axios.post<ApiSuccess<{ accessToken: string }>>(
        `${getEnv().VITE_API_URL}/auth/platform/refresh`,
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

    config._retried = true;

    try {
      const token = await refreshAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return await apiClient.request(config);
    } catch {
      sessionStore.clear();
      return Promise.reject(error);
    }
  },
);

export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body?.error?.message) return body.error.message;
    if (!error.response) return "Could not reach the server. Is the API running?";
  }
  return fallback;
}

export function apiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    return body?.error?.code ?? null;
  }
  return null;
}
