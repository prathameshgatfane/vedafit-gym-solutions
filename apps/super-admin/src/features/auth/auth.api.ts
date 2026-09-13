import { apiClient, refreshAccessToken, type ApiSuccess } from "../../lib/api-client";
import type { PlatformUser } from "../../stores/session.store";
import type { LoginInput } from "./login.schema";

export interface PlatformLoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: PlatformUser;
}

export async function login(input: LoginInput): Promise<PlatformLoginResponse> {
  const { data } = await apiClient.post<ApiSuccess<PlatformLoginResponse>>(
    "/auth/platform/login",
    input,
  );
  return data.data;
}

export async function fetchMe(): Promise<PlatformUser> {
  const { data } = await apiClient.get<ApiSuccess<{ user: PlatformUser }>>("/auth/platform/me");
  return data.data.user;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/platform/logout", {});
}

export { refreshAccessToken };
