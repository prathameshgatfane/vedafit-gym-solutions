/**
 * Shared native-select chrome: hide the OS chevron, pad the text away from a custom arrow,
 * and ask the platform picker to use a dark scheme so it does not flash white on our palette.
 *
 * Super-admin / SaaS screens (`apps/super-admin`) should reuse this class and `SelectChevron`
 * rather than a second select style that would need the same retrofit later.
 */
export const SELECT_CONTROL_CLASS = [
  "w-full appearance-none rounded-md bg-brand-black px-3 pr-10 text-sm text-brand-white",
  "[color-scheme:dark]",
  "border focus:outline-none focus:ring-2 focus:ring-brand-green",
].join(" ");

export function SelectChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-white/50"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
