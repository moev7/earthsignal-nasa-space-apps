"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, AlertCircle } from "lucide-react";
import { signInDestination } from "@/lib/sign-in-destination";
import { readPublicStudyContext, publicStudyWorkspaceHref } from "@/lib/public-study-context";

export function SignInBackLink() {
  const parameters = useSearchParams();
  const context = parameters.getAll("continue").length === 1 && parameters.get("continue") === "workspace-study" ? readPublicStudyContext(new URLSearchParams(parameters.toString())) : null;
  // A fresh document also clears any prior collaborator's in-memory private data.
  return <a href={context ? publicStudyWorkspaceHref(context.selection) : "/"} className="sign-in-back"><ArrowLeft size={16} aria-hidden="true" />{context ? "Back to the study draft" : "Back to the observatory"}</a>;
}

export function SignInForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setFailed(false);
    setMessage("Signing in…");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });
      if (!response.ok) {
        const error =
          response.status === 429
            ? "Too many attempts. Wait a few minutes before trying again."
            : response.status === 401
              ? "Sign-in failed. Check your username and password."
              : "Collaborator access is unavailable. Try again later or contact your operator.";
        throw new Error(error);
      }
      setMessage("Signed in. Opening Earthsignal…");
      window.dispatchEvent(new Event("earthsignal-auth-changed"));
      // Named internal destinations only; arbitrary return URLs remain ignored.
      router.replace(signInDestination(window.location.search));
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error && error.message !== "Failed to fetch"
          ? error.message
          : "Could not connect. Check your connection and try again.",
      );
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-busy={busy} className="sign-in-form">
      <div className="sign-in-field">
        <label htmlFor="collaborator-username">Username</label>
        <input
          id="collaborator-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={64}
          disabled={busy}
          aria-describedby={message ? "sign-in-message" : undefined}
          placeholder="Your collaborator username"
        />
      </div>
      <div className="sign-in-field">
        <label htmlFor="collaborator-password">Password</label>
        <div className="sign-in-password">
          <input
            id="collaborator-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={1024}
            disabled={busy}
            aria-describedby={message ? "sign-in-message" : undefined}
            placeholder="Your Earthsignal password"
          />
          <button
            type="button"
            disabled={busy}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <button type="submit" disabled={busy} className="sign-in-submit">
        {busy ? "Signing in…" : "Open my workspace"}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
      <div
        id="sign-in-message"
        className={failed ? "sign-in-message is-error" : "sign-in-message"}
        role={failed ? "alert" : "status"}
        aria-live="polite"
      >
        {failed && <AlertCircle size={17} aria-hidden="true" />}
        {message}
      </div>
    </form>
  );
}
