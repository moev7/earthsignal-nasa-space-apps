"use client";
import { useEffect, useRef, useState } from "react";
import { publicStudySignInHref, type PublicStudyContext } from "@/lib/public-study-context";

// Keep client types local: the native Node auth implementation must remain server-only.
type User = { id: string; username: string };
export function CollaboratorAccess({ publicStudyContext = null }: { publicStudyContext?: PublicStudyContext | null }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const identity = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controllers = new Set<AbortController>();
    async function refresh() {
      const current = ++revision;
      // Superseded requests must not overwrite a newer logout or account change.
      controllers.forEach((controller) => controller.abort());
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Collaborator access is unavailable.");
        const payload = await response.json() as { user: User | null };
        if (!active || current !== revision) return;
        const previous = identity.current;
        identity.current = payload.user?.id ?? null;
        setUser(payload.user); setMessage("");
        if (previous !== undefined && previous !== identity.current) window.dispatchEvent(new Event("earthsignal-auth-changed"));
      } catch {
        if (active && current === revision) {
          setUser(null); setMessage("Collaborator access is unavailable.");
          const previous = identity.current; identity.current = null;
          if (previous) window.dispatchEvent(new Event("earthsignal-auth-changed"));
        }
      } finally {
        controllers.delete(controller);
        if (active && current === revision) setLoading(false);
      }
    }
    const changed = () => { void refresh(); };
    window.addEventListener("earthsignal-auth-changed", changed);
    window.addEventListener("focus", changed);
    void refresh();
    return () => {
      active = false; controllers.forEach((controller) => controller.abort());
      window.removeEventListener("earthsignal-auth-changed", changed);
      window.removeEventListener("focus", changed);
    };
  }, []);
  async function logout() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("logout failed");
      setUser(null); identity.current = null;
      window.dispatchEvent(new Event("earthsignal-auth-changed"));
    } catch { setMessage("Could not sign out. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <div aria-label="Collaborator access" className="flex flex-wrap items-center gap-2 text-sm">
      {loading ? <span role="status">Checking collaborator access…</span> : user ? <>
        <span>Signed in as {user.username}</span>
        <button type="button" onClick={logout} disabled={busy} className="rounded border px-3 py-1">{busy ? "Signing out…" : "Sign out"}</button>
      </> : <a href={publicStudyContext ? publicStudySignInHref(publicStudyContext) : "/sign-in"} className="underline">Collaborator sign-in</a>}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
