import { apiClient, refreshAccessToken, type ApiSuccess } from "../../lib/api-client";
import type { SessionSnapshot } from "../../stores/session.store";
import type { LoginInput } from "./login.schema";

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: {
    id: string;
    name: string;
    email: string;
    organizationId: string;
    branchId: string | null;
    roleId: string;
  };
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await apiClient.post<ApiSuccess<LoginResponse>>("/auth/login", input);
  return data.data;
}

export async function fetchMe(): Promise<SessionSnapshot> {
  const { data } = await apiClient.get<ApiSuccess<SessionSnapshot>>("/auth/me");
  return data.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout", {});
}

export { refreshAccessToken };
