/**
 * Shared native-select chrome: hide the OS chevron, pad the text away from a custom arrow.
 * `color-scheme` comes from `html` (`:root` / `[data-theme]`). Port of admin-web's copy —
 * do not import across Vite apps.
 */
export const SELECT_CONTROL_CLASS = [
  "w-full appearance-none rounded-md bg-bg px-3 pr-10 text-sm text-fg",
  "border focus:outline-none focus:ring-2 focus:ring-accent",
].join(" ");

export function SelectChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
