import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal scroll for wide admin tables. The first column stays pinned so the row's
 * identity remains visible; a right-edge fade + chevron is the affordance that more
 * columns exist. Existing `<table data-testid>` nodes stay the children — this wrapper
 * does not invent ids.
 *
 * Super-admin / SaaS screens (`apps/super-admin`, Phase 15 org list, subscriptions,
 * billing) should import this same wrapper — and `SELECT_CONTROL_CLASS` / the topbar
 * truncation pattern — rather than inventing a second table/select markup that would
 * need this retrofit again.
 */
export function DataTable({
  children,
  fit = false,
}: {
  children: ReactNode;
  /** Skip the 40rem floor — for 2-column tables that should only scroll if they truly overflow. */
  fit?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const Observer = typeof ResizeObserver === "function" ? ResizeObserver : null;
    const observer = Observer ? new Observer(sync) : null;
    observer?.observe(el);
    const table = el.querySelector("table");
    if (table) observer?.observe(table);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      observer?.disconnect();
    };
  }, [sync, children]);

  return (
    <div className="relative" data-testid="data-table">
      <div
        ref={scrollerRef}
        data-testid="data-table-scroll"
        className={[
          "overflow-x-auto rounded-lg border border-border",
          fit ? "[&_table]:w-full" : "[&_table]:min-w-[40rem] [&_table]:w-full",
          "[&_th]:whitespace-nowrap [&_td]:whitespace-nowrap",
          "[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-20",
          "[&_th:first-child]:bg-surface",
          "[&_th:first-child]:shadow-[1px_0_0_0_var(--color-border)]",
          "[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-10",
          // inherit so `tr:hover:bg-accent/10` tints the pin instead of leaving a black hole
          "[&_td:first-child]:bg-inherit",
          "[&_td:first-child]:shadow-[1px_0_0_0_var(--color-border)]",
        ].join(" ")}
      >
        {children}
      </div>
      {canScrollRight ? (
        <div
          data-testid="data-table-fade"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-20 flex w-14 items-center justify-end rounded-r-lg bg-gradient-to-l from-bg from-40% via-bg/80 to-transparent pr-1.5"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-accent-text"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
