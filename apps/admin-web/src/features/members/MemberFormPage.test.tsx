import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemberFormPage } from "./MemberFormPage";
import { apiClient } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import {
  renderWithProviders,
  testBranches,
  testOrganization,
  testUser,
} from "../../test/test-utils";
import type { Member } from "./member.types";

let mock: MockAdapter;

const MEMBERS_PATH = `/organizations/${testOrganization.id}/members`;
const MEMBER_ID = "01k4h0member0000000000001";

const existingMember: Member = {
  id: MEMBER_ID,
  organizationId: testOrganization.id,
  branchId: testBranches[0]!.id,
  firstName: "Aarav",
  lastName: "Singh",
  phone: "+919000000001",
  email: "aarav@example.test",
  dateOfBirth: "1994-03-17",
  status: "ACTIVE",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

function renderForm(mode: "create" | "edit") {
  useSessionStore.getState().setSession({
    user: testUser,
    organization: testOrganization,
    branches: testBranches,
  });

  const route = mode === "create" ? "/members/new" : `/members/${MEMBER_ID}/edit`;

  return renderWithProviders(
    <Routes>
      <Route path="/members/new" element={<MemberFormPage mode="create" />} />
      <Route path="/members/:memberId/edit" element={<MemberFormPage mode="edit" />} />
      <Route path="/members/:memberId" element={<h1>Member detail</h1>} />
    </Routes>,
    { route },
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First name"), "Nikhil");
  await user.type(screen.getByLabelText("Last name"), "Sharma");
  await user.type(screen.getByLabelText("Phone"), "+919812345678");
}

beforeEach(() => {
  mock = new MockAdapter(apiClient);
  useSessionStore.getState().clear();
});

afterEach(() => {
  mock.restore();
});

describe("MemberFormPage validation", () => {
  it("reports every missing required field without calling the API", async () => {
    const user = userEvent.setup();
    renderForm("create");

    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByText("First name is required")).toBeInTheDocument();
    expect(screen.getByText("Last name is required")).toBeInTheDocument();
    expect(screen.getByText("Phone number is required")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("rejects a phone number that isn't one", async () => {
    const user = userEvent.setup();
    renderForm("create");

    await user.type(screen.getByLabelText("First name"), "Nikhil");
    await user.type(screen.getByLabelText("Last name"), "Sharma");
    await user.type(screen.getByLabelText("Phone"), "abc");
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(
      await screen.findByText("Only digits, spaces, +, -, and () are allowed"),
    ).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it("rejects too few digits even in a well-formed string", async () => {
    const user = userEvent.setup();
    renderForm("create");

    await user.type(screen.getByLabelText("First name"), "Nikhil");
    await user.type(screen.getByLabelText("Last name"), "Sharma");
    await user.type(screen.getByLabelText("Phone"), "+91 12");
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByText("Phone number needs at least 7 digits")).toBeInTheDocument();
  });

  it("rejects a malformed email but accepts an empty one", async () => {
    const user = userEvent.setup();
    mock.onPost(MEMBERS_PATH).reply(201, { success: true, data: existingMember });
    renderForm("create");

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Email (optional)"), "nope");
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);

    await user.clear(screen.getByLabelText("Email (optional)"));
    await user.click(screen.getByRole("button", { name: /create member/i }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
  });

  it("rejects a date of birth in the future", async () => {
    const user = userEvent.setup();
    renderForm("create");

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Date of birth (optional)"), "2099-01-01");
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByText("Date of birth is in the future")).toBeInTheDocument();
  });
});

describe("MemberFormPage create", () => {
  it("posts the member and navigates to their detail page", async () => {
    const user = userEvent.setup();
    mock.onPost(MEMBERS_PATH).reply(201, { success: true, data: existingMember });
    renderForm("create");

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Email (optional)"), "nikhil@example.test");
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByRole("heading", { name: "Member detail" })).toBeInTheDocument();

    const payload = JSON.parse(mock.history.post[0]!.data as string);
    expect(payload).toMatchObject({
      firstName: "Nikhil",
      lastName: "Sharma",
      phone: "+919812345678",
      email: "nikhil@example.test",
      branchId: testBranches[0]!.id,
    });
  });

  it("omits blank optional fields from the create payload", async () => {
    const user = userEvent.setup();
    mock.onPost(MEMBERS_PATH).reply(201, { success: true, data: existingMember });
    renderForm("create");

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create member/i }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const payload = JSON.parse(mock.history.post[0]!.data as string);
    expect(payload.email).toBeUndefined();
    expect(payload.dateOfBirth).toBeUndefined();
  });

  it("puts a duplicate-phone error on the phone field, not just in a banner", async () => {
    // Locked Decision 1.3's service-layer check, surfaced where the fix is.
    const user = userEvent.setup();
    mock.onPost(MEMBERS_PATH).reply(409, {
      success: false,
      error: {
        code: "DUPLICATE_PHONE",
        message: "Phone number +919812345678 already belongs to Ravi Kumar",
      },
    });

    renderForm("create");
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create member/i }));

    const phoneField = screen.getByLabelText("Phone");
    await waitFor(() => expect(phoneField).toHaveAttribute("aria-invalid", "true"));
    expect(
      await screen.findByText("Phone number +919812345678 already belongs to Ravi Kumar"),
    ).toBeInTheDocument();

    // Still on the form — nothing was created.
    expect(screen.queryByRole("heading", { name: "Member detail" })).not.toBeInTheDocument();
  });

  it("shows a banner for a failure that isn't tied to one field", async () => {
    const user = userEvent.setup();
    mock.onPost(MEMBERS_PATH).reply(403, {
      success: false,
      error: { code: "PERMISSION_DENIED", message: "This role lacks members.create" },
    });

    renderForm("create");
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /create member/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This role lacks members.create");
  });
});

describe("MemberFormPage edit", () => {
  it("loads the existing member into the form", async () => {
    mock.onGet(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(200, { success: true, data: existingMember });
    renderForm("edit");

    await waitFor(() => {
      expect(screen.getByLabelText("First name")).toHaveValue("Aarav");
    });
    expect(screen.getByLabelText("Phone")).toHaveValue("+919000000001");
    expect(screen.getByLabelText("Email (optional)")).toHaveValue("aarav@example.test");
    expect(screen.getByLabelText("Date of birth (optional)")).toHaveValue("1994-03-17");
  });

  it("patches only through the API and returns to the detail page", async () => {
    const user = userEvent.setup();
    mock.onGet(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(200, { success: true, data: existingMember });
    mock.onPatch(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(200, {
      success: true,
      data: { ...existingMember, firstName: "Aaravi" },
    });

    renderForm("edit");
    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Aarav"));

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Aaravi");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("heading", { name: "Member detail" })).toBeInTheDocument();
    expect(JSON.parse(mock.history.patch[0]!.data as string)).toMatchObject({
      firstName: "Aaravi",
    });
  });

  it("sends null, not undefined, when an optional field is cleared", async () => {
    // `undefined` would mean "leave it alone" and the deletion would silently not happen.
    const user = userEvent.setup();
    mock.onGet(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(200, { success: true, data: existingMember });
    mock.onPatch(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(200, {
      success: true,
      data: { ...existingMember, email: null },
    });

    renderForm("edit");
    await waitFor(() =>
      expect(screen.getByLabelText("Email (optional)")).toHaveValue("aarav@example.test"),
    );

    await user.clear(screen.getByLabelText("Email (optional)"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(JSON.parse(mock.history.patch[0]!.data as string).email).toBeNull();
  });

  it("reports a member that could not be loaded", async () => {
    mock.onGet(`${MEMBERS_PATH}/${MEMBER_ID}`).reply(404, {
      success: false,
      error: { code: "MEMBER_NOT_FOUND", message: "Member not found" },
    });

    renderForm("edit");

    expect(await screen.findByRole("alert")).toHaveTextContent("Member not found");
  });
});
