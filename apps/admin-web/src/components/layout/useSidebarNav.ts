import { useEffect, useState } from "react";

/** UI preference only — never store tokens here (Phase 3 locked decision). */
export const SIDEBAR_COLLAPSED_KEY = "vedafit.admin.sidebarCollapsed";

/** Tailwind `md` — inline collapse at this width and up; drawer below it. */
export const MD_UP_QUERY = "(min-width: 768px)";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode / quota: the session still toggles; the next load starts expanded.
  }
}

function matchesMdUp(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(MD_UP_QUERY).matches;
}

export function useMdUp(): boolean {
  const [mdUp, setMdUp] = useState(matchesMdUp);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MD_UP_QUERY);
    const sync = () => setMdUp(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return mdUp;
}

/**
 * Desktop (`md+`) collapse is persisted. The mobile drawer is session-only — a phone
 * reload should not reopen an overlay that covers the page.
 */
export function useSidebarNav() {
  const mdUp = useMdUp();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (mdUp) setMobileOpen(false);
  }, [mdUp]);

  useEffect(() => {
    if (mdUp || !mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mdUp, mobileOpen]);

  useEffect(() => {
    if (mdUp || !mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mdUp, mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsed(next);
      return next;
    });
  }

  return {
    mdUp,
    collapsed,
    mobileOpen,
    toggleCollapsed,
    openMobile: () => setMobileOpen(true),
    closeMobile: () => setMobileOpen(false),
  };
}
