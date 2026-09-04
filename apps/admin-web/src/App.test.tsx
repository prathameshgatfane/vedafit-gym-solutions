import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the admin shell placeholder with the given API URL", () => {
    render(<App apiUrl="http://localhost:4000/api/v1" />);

    expect(screen.getByText("Gym Management — Admin")).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost:4000\/api\/v1/)).toBeInTheDocument();
  });
});
