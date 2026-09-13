import { useEffect, useRef } from "react";
import { useSessionStore } from "../../stores/session.store";
import { fetchMe, refreshAccessToken } from "./auth.api";

/**
 * Restores a platform session on cold load.
 *
 * The access token lives in memory only, so a reload always starts empty. What survives is the
 * httpOnly `platform_refresh` cookie — never a staff `/auth/refresh` cookie. The `useRef` guard
 * runs once under React 18 StrictMode so a replayed refresh family is not revoked.
 */
export function useSessionBootstrap(): void {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const { setSession, markUnauthenticated } = useSessionStore.getState();
      try {
        await refreshAccessToken();
        setSession(await fetchMe());
      } catch {
        markUnauthenticated();
      }
    })();
  }, []);
}
