import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("keeps the existing table test id and opts the scrollport into overflow-x", () => {
    render(
      <DataTable>
        <table data-testid="members-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Aarav Singh</td>
              <td>+919000000001</td>
            </tr>
          </tbody>
        </table>
      </DataTable>,
    );

    expect(screen.getByTestId("members-table")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-scroll").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("data-table-scroll").className).toContain("sticky");
  });
});
