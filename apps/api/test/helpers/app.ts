import { createApp } from "../../src/app";

/** Shared Express app instance for Supertest — no network socket opened. */
export const app = createApp();
