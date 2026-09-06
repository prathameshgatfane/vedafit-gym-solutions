import { useEffect, useRef } from "react";
import { useSessionStore } from "../../stores/session.store";
import { fetchMe, refreshAccessToken } from "./auth.api";

/**
 * Restores a session on cold load.
 *
 * The access token lives in memory only, so a page reload always starts with nothing. What
 * survives is the httpOnly refresh cookie, so boot trades it for a fresh access token and then
 * loads `/auth/me`. A 401 here is the normal "nobody is logged in" path, not an error.
 *
 * The `useRef` guard makes this run once even under React 18 StrictMode, which double-invokes
 * effects in development. That matters because the API revokes a whole refresh-token family when
 * a spent token is replayed — two boots racing the same cookie would sign the user out.
 * (`refreshAccessToken` is single-flight as a second line of defence.)
 *
 * Note there is deliberately no "cancelled" flag or cleanup here. The result lands in a global
 * store rather than component state, so a late write is harmless — and under StrictMode a
 * cancel-on-unmount would abort the *only* run this hook ever makes, leaving the app stuck on
 * the loading spinner forever.
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
