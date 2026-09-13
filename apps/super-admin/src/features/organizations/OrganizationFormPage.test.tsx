import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { renderWithProviders, testPlatformUser } from "../../test/test-utils";
import { OrganizationFormPage } from "./OrganizationFormPage";

let mock: MockAdapter;

function renderForm() {
  useSessionStore.getState().setSession(testPlatformUser);
  return renderWithProviders(
    <Routes>
      <Route path="/organizations/new" element={<OrganizationFormPage />} />
      <Route path="/organizations/:organizationId" element={<h1>Created org</h1>} />
    </Routes>,
    { route: "/organizations/new" },
  );
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("OrganizationFormPage", () => {
  it("creates an organization with the backend signup schema and no plan fields", async () => {
    const user = userEvent.setup();
    mock.onPost("/platform/organizations").reply(201, {
      success: true,
      data: {
        organization: {
          id: "org_new",
          name: "Acme Gym",
          slug: "acme-gym",
          email: "hello@acme.test",
          phone: null,
          status: "ACTIVE",
          timezone: "Asia/Kolkata",
        },
        branch: { id: "br_1", name: "Main" },
        owner: { id: "u_1", name: "Ada Owner", email: "ada@acme.test" },
      },
    });

    renderForm();

    await user.type(screen.getByLabelText("Organization name"), "Acme Gym");
    await user.type(screen.getByLabelText("Slug"), "acme-gym");
    await user.type(screen.getByLabelText("Organization email"), "hello@acme.test");
    await user.type(screen.getByLabelText("Owner name"), "Ada Owner");
    await user.type(screen.getByLabelText("Owner email"), "ada@acme.test");
    await user.type(screen.getByLabelText("Owner password"), "ChangeMe123!");
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByRole("heading", { name: "Created org" })).toBeInTheDocument();

    const body = JSON.parse(mock.history.post[0]?.data ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Acme Gym",
      slug: "acme-gym",
      email: "hello@acme.test",
      timezone: "Asia/Kolkata",
      owner: {
        name: "Ada Owner",
        email: "ada@acme.test",
        password: "ChangeMe123!",
      },
    });
    expect(body).not.toHaveProperty("planId");
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("subscription");
    expect(body).not.toHaveProperty("organizationId");
  });

  it("rejects a weak owner password before calling the API", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Organization name"), "Acme Gym");
    await user.type(screen.getByLabelText("Slug"), "acme-gym");
    await user.type(screen.getByLabelText("Organization email"), "hello@acme.test");
    await user.type(screen.getByLabelText("Owner name"), "Ada Owner");
    await user.type(screen.getByLabelText("Owner email"), "ada@acme.test");
    await user.type(screen.getByLabelText("Owner password"), "password");
    await user.click(screen.getByRole("button", { name: /create organization/i }));

    expect(await screen.findByText(/uppercase letter/i)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("does not expose plan or entitlement controls", () => {
    renderForm();

    expect(screen.queryByLabelText(/plan/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/entitlement/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^status$/i)).not.toBeInTheDocument();
  });
});
