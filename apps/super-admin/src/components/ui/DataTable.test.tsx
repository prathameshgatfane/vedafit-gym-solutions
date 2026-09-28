import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("keeps the existing table test id and opts the scrollport into overflow-x", () => {
    render(
      <DataTable>
        <table data-testid="organizations-table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Demo Gym</td>
              <td>ACTIVE</td>
            </tr>
          </tbody>
        </table>
      </DataTable>,
    );

    expect(screen.getByTestId("organizations-table")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("data-table-scroll").className).toContain("sticky");
  });
});
