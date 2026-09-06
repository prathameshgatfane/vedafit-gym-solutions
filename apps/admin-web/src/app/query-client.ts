import { QueryClient } from "@tanstack/react-query";

/**
 * Retries are off for 4xx and capped at one attempt overall.
 *
 * The api-client already retries once after a silent token refresh, so a query-level retry on top
 * of that would multiply requests against an API that revokes a refresh-token family on replay.
 * One retry, network errors only.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
