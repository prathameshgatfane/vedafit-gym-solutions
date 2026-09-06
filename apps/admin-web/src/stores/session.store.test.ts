import { beforeEach, describe, expect, it } from "vitest";
import { sessionStore, useSessionStore } from "./session.store";
import { testBranches, testOrganization, testUser } from "../test/test-utils";

beforeEach(() => {
  useSessionStore.setState({
    status: "bootstrapping",
    accessToken: null,
    user: null,
    organization: null,
    branches: [],
    activeBranchId: null,
  });
});

describe("session store", () => {
  it("starts out bootstrapping, not unauthenticated", () => {
    // The distinction is what stops ProtectedRoute redirecting mid-cold-load.
    expect(useSessionStore.getState().status).toBe("bootstrapping");
  });

  it("hydrates user, organization and branches from an /auth/me snapshot", () => {
    useSessionStore.getState().setSession({
      user: testUser,
      organization: testOrganization,
      branches: testBranches,
    });

    const state = useSessionStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.user?.name).toBe("Priya Owner");
    expect(state.organization?.slug).toBe("demo-gym");
    expect(state.branches).toHaveLength(1);
  });

  it("leaves an org-wide user unscoped and pins a branch-scoped one", () => {
    useSessionStore.getState().setSession({
      user: testUser,
      organization: testOrganization,
      branches: testBranches,
    });
    expect(useSessionStore.getState().activeBranchId).toBeNull();

    const receptionist = {
      ...testUser,
      branchId: testBranches[0]!.id,
      role: { id: "role_r", name: "RECEPTIONIST", permissions: ["members.view"] },
    };
    useSessionStore.getState().setSession({
      user: receptionist,
      organization: testOrganization,
      branches: testBranches,
    });
    expect(useSessionStore.getState().activeBranchId).toBe(testBranches[0]!.id);
  });

  it("answers permission checks from the role's permission list", () => {
    useSessionStore.getState().setSession({
      user: testUser,
      organization: testOrganization,
      branches: testBranches,
    });

    expect(useSessionStore.getState().hasPermission("users.manage")).toBe(true);
    expect(useSessionStore.getState().hasPermission("payments.refund")).toBe(false);
  });

  it("denies every permission when signed out", () => {
    expect(useSessionStore.getState().hasPermission("members.view")).toBe(false);
  });

  it("drops the token and all context on clear", () => {
    useSessionStore.getState().setSession({
      user: testUser,
      organization: testOrganization,
      branches: testBranches,
    });
    useSessionStore.getState().setAccessToken("token");

    useSessionStore.getState().clear();

    const state = useSessionStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.organization).toBeNull();
    expect(state.branches).toEqual([]);
  });

  it("exposes the same state to non-React callers like the api-client", () => {
    sessionStore.setAccessToken("from-interceptor");
    expect(useSessionStore.getState().accessToken).toBe("from-interceptor");
    expect(sessionStore.getAccessToken()).toBe("from-interceptor");

    sessionStore.clear();
    expect(useSessionStore.getState().status).toBe("unauthenticated");
  });
});
