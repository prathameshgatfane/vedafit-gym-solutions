import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  "/": (
    <Icon>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v9h12v-9" />
    </Icon>
  ),
  "/members": (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 19c.6-3 2.6-4.5 5-4.5S13.4 16 14 19" />
      <circle cx="16.5" cy="8.5" r="2.2" />
      <path d="M16 14.5c2.2 0 3.8 1.2 4.4 3.5" />
    </Icon>
  ),
  "/memberships": (
    <Icon>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </Icon>
  ),
  "/membership-plans": (
    <Icon>
      <path d="M12 4 5 8v8l7 4 7-4V8z" />
      <path d="M12 12 5 8M12 12l7-4M12 12v8" />
    </Icon>
  ),
  "/attendance": (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </Icon>
  ),
  "/trainers": (
    <Icon>
      <path d="M8 14v5M16 14v5M6 19h12" />
      <path d="M9 9a3 3 0 0 1 6 0v5H9z" />
    </Icon>
  ),
  "/leads": (
    <Icon>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M6 18h12" />
    </Icon>
  ),
  "/invoices": (
    <Icon>
      <path d="M7 4h8l5 5v11H7z" />
      <path d="M15 4v5h5M10 13h6M10 17h4" />
    </Icon>
  ),
  "/payments": (
    <Icon>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <path d="M3 11h18" />
      <circle cx="8" cy="15" r="1" />
    </Icon>
  ),
  "/expenses": (
    <Icon>
      <path d="M12 5v14M8 9h5.5a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h6" />
    </Icon>
  ),
  "/reports": (
    <Icon>
      <path d="M5 19V9M10 19V5M15 19v-7M20 19v-4" />
    </Icon>
  ),
  "/notifications": (
    <Icon>
      <path d="M7 17h10l-1.2-2.2A6 6 0 0 1 6 10c0-3.3 2.2-6 6-6s6 2.7 6 6" />
      <path d="M10 17v1a2 2 0 0 0 4 0v-1" />
    </Icon>
  ),
  "/staff": (
    <Icon>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19c1-3.5 3.5-5 7-5s6 1.5 7 5" />
    </Icon>
  ),
};

export function NavIcon({ to }: { to: string }) {
  return ICONS[to] ?? ICONS["/members"];
}
