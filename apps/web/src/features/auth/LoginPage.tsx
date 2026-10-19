import { loginSchema } from "@sarh/shared";
import { useState, type FormEvent } from "react";
import { useLogin } from "./session";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const login = useLogin();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setValidationError("Enter your email and password");
      return;
    }
    setValidationError(null);
    login.mutate(parsed.data);
  }

  const error = validationError ?? login.error?.message;

  return (
    <section className="login">
      <form className="login__card" onSubmit={handleSubmit} noValidate>
        <h1>Sign in</h1>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button--primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}
