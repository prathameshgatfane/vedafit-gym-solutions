import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { apiErrorMessage } from "../../lib/api-client";
import { useSessionStore } from "../../stores/session.store";
import { fetchMe, login } from "./auth.api";
import { loginSchema, type LoginInput } from "./login.schema";

export function LoginPage() {
  const navigate = useNavigate();
  const status = useSessionStore((s) => s.status);
  const setAccessToken = useSessionStore((s) => s.setAccessToken);
  const setSession = useSessionStore((s) => s.setSession);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (input: LoginInput) => {
      const result = await login(input);
      // Store the token before /auth/me — the request interceptor reads it from the store.
      setAccessToken(result.accessToken);
      return fetchMe();
    },
    onSuccess: (snapshot) => {
      setSession(snapshot);
      navigate("/", { replace: true });
    },
    onError: (error) => {
      setAccessToken(null);
      setFormError(apiErrorMessage(error, "Could not sign in. Please try again."));
    },
  });

  // Someone who is already signed in has no business on the login screen.
  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-fg">Gym Admin</h1>
        </div>

        <p className="mb-6 text-sm text-accent-muted">Sign in to continue.</p>

        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            loginMutation.mutate(values);
          })}
        >
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register("email")}
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />

          {formError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <Button type="submit" disabled={loginMutation.isPending} className="mt-2 w-full">
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
