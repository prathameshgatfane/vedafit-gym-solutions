import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "../app/query-client";
import type {
  SessionBranch,
  SessionOrganization,
  SessionUser,
} from "../stores/session.store";

interface RenderOptions {
  /** Initial history entries for the MemoryRouter. */
  route?: string;
}

/** Renders with the same providers `App` uses, minus the real BrowserRouter. */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/" }: RenderOptions = {},
): RenderResult {
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export const testUser: SessionUser = {
  id: "01k4h0test0user0000000001",
  name: "Priya Owner",
  email: "owner@demo-gym.test",
  status: "ACTIVE",
  branchId: null,
  role: {
    id: "01k4h0test0role0000000001",
    name: "OWNER",
    permissions: ["members.view", "members.create", "users.manage", "roles.manage"],
  },
};

export const testOrganization: SessionOrganization = {
  id: "01k4h0test00org0000000001",
  name: "Demo Gym",
  slug: "demo-gym",
  email: "hello@demo-gym.test",
  phone: "+911234567890",
  status: "ACTIVE",
};

export const testBranches: SessionBranch[] = [
  {
    id: "01k4h0test0branch00000001",
    name: "Main Branch",
    address: "12 Fitness Road",
    phone: "+911234567891",
    status: "ACTIVE",
  },
];
