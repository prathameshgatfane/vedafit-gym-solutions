import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only self-registers cleanup when Vitest globals are on. This project runs with
// `globals: false`, so without this every test after the first in a file renders into a DOM that
// still holds the previous tree, and queries fail with "found multiple elements".
afterEach(() => {
  cleanup();
});
