import { SignInForm, SignInBackLink } from "./sign-in-form";
import { Orbit, Radar, Layers, NotebookPen } from "lucide-react";

export default function SignInPage() {
  return (
    <main className="sign-in-shell">
      <SignInBackLink />
      <div className="sign-in-card">
        <section
          className="sign-in-story"
          aria-label="About your collaborator workspace"
        >
          <div className="sign-in-brand">
            <Orbit size={32} aria-hidden="true" />
            <div>
              <strong>earthsignal</strong>
              <span>EARTH OBSERVATORY</span>
            </div>
          </div>
          <p className="sign-in-eyebrow">CURIOSITY, WITH CONTEXT</p>
          <h2>A clearer view of a changing Earth.</h2>
          <p>
            Explore the signals. Understand the evidence. Bring a better brief
            to your next decision.
          </p>
          <ul className="sign-in-benefits">
            <li>
              <Radar size={18} aria-hidden="true" />
              <span>Compare real satellite observations</span>
            </li>
            <li>
              <Layers size={18} aria-hidden="true" />
              <span>Keep measurements and their sources together</span>
            </li>
            <li>
              <NotebookPen size={18} aria-hidden="true" />
              <span>Save investigations and export clear briefs</span>
            </li>
          </ul>
          <p className="sign-in-story-note">
            Water · Fire · Ecology · Urban planning
          </p>
        </section>
        <section className="sign-in-access" aria-labelledby="sign-in-title">
          <span className="sign-in-eyebrow">YOUR WORKSPACE</span>
          <h1 id="sign-in-title">Welcome back.</h1>
          <p className="sign-in-intro">
            Sign in with your Earthsignal collaborator account.
          </p>
          <SignInForm />
          <div className="sign-in-help">
            <p>
              <strong>Need an account or a reset?</strong>
              <br />
              Ask the person who manages your Earthsignal workspace.
            </p>
            <p>
              This is separate from NASA Earthdata. Use your Earthsignal
              username and password.
            </p>
          </div>
        </section>
      </div>
      <p className="sign-in-footer">
        Built for curiosity. Grounded in evidence.
      </p>
    </main>
  );
}
