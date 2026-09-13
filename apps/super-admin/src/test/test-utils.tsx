import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "../app/query-client";
import type { PlatformUser } from "../stores/session.store";

interface RenderOptions {
  route?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/" }: RenderOptions = {},
): RenderResult {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export const testPlatformUser: PlatformUser = {
  id: "01k4h0platform0user0000001",
  name: "Vedafit Operator",
  email: "platform@vedafit.test",
  status: "ACTIVE",
};
