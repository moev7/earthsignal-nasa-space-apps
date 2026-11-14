"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { WorkspaceSelect } from "@/components/ui/workspace-select";
import {
  Sparkles,
  ArrowUpRight,
  BookOpen,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import {
  PUBLIC_BLOCKS,
  PUBLIC_QUESTIONS,
  approvedPublicQuestion,
  publicAssistantContext,
  type PublicBlock,
  PUBLIC_PROOF_ACTIONS,
} from "@/lib/public-evidence";
import { assistantPayload } from "@/lib/assistant-contract";
import { submitReviewedQuestion } from "@/lib/assistant-submission";
import { apiJSON } from "./use-assessments";

type Connection =
  "checking" | "ready" | "sign-in" | "configuration" | "unavailable";
export function PublicAssistant({
  domain,
  initialBlockId,
  resultContext = false,
}: {
  domain: "water" | "fire" | "ecology" | "urban";
  initialBlockId?: string;
  resultContext?: boolean;
}) {
  const responseEpoch = useRef(0);
  const [question, setQuestion] = useState(
    initialBlockId ? (PUBLIC_QUESTIONS[initialBlockId] ?? "") : "",
  );
  const [consent, setConsent] = useState(false),
    [connection, setConnection] = useState<Connection>("checking");
  const [preview, setPreview] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    blocks: PublicBlock[];
    notice: string;
    model: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const evidenceIds = publicAssistantContext(domain, question);
  const payload = JSON.stringify(
    assistantPayload(question, evidenceIds),
    null,
    2,
  );
  const sharedBlocks = PUBLIC_BLOCKS.filter((b) =>
    evidenceIds.includes(b.evidenceId),
  );
  const reviewed = preview === payload;
  const selectedBlock = PUBLIC_BLOCKS.find(
    (b) => PUBLIC_QUESTIONS[b.id] === question,
  );
  useEffect(() => {
    let epoch = 0,
      alive = true;
    const responseCounter = responseEpoch,
      controllers = new Set<AbortController>();
    const load = () => {
      const current = ++epoch,
        controller = new AbortController();
      controllers.forEach((c) => c.abort());
      controllers.add(controller);
      setConnection("checking");
      void fetch("/api/assistant", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      })
        .then(async (response) => {
          const next: Connection =
            response.status === 401
              ? "sign-in"
              : !response.ok
                ? "unavailable"
                : z.object({ ready: z.boolean() }).parse(await response.json())
                      .ready
                  ? "ready"
                  : "configuration";
          if (alive && current === epoch) setConnection(next);
        })
        .catch(() => {
          if (alive && current === epoch) setConnection("unavailable");
        })
        .finally(() => controllers.delete(controller));
    };
    const reset = () => {
      responseEpoch.current++;
      setBusy(false);
      setAnswer(null);
      setPreview(null);
      setConsent(false);
      setQuestion("");
      setError(null);
      load();
    };
    load();
    window.addEventListener("earthsignal-auth-changed", reset);
    return () => {
      alive = false;
      epoch++;
      controllers.forEach((c) => c.abort());
      responseCounter.current++;
      window.removeEventListener("earthsignal-auth-changed", reset);
    };
  }, []);
  const changeQuestion = (value: string) => {
    responseEpoch.current++;
    setQuestion(value);
    setBusy(false);
    setError(null);
    setConsent(false);
    setPreview(null);
    setAnswer(null);
  };
  const ask = async () => {
    if (!consent || !reviewed || connection !== "ready" || busy) return;
    const epoch = ++responseEpoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await submitReviewedQuestion(
        question,
        evidenceIds,
        () => epoch === responseEpoch.current,
        (body) =>
          apiJSON("/api/assistant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      );
      if (result === null) return;
      const value = z
        .object({
          blocks: z.array(z.object({ id: z.string() })),
          notice: z.string(),
          model: z.string(),
        })
        .parse(result);
      const blocks = value.blocks.map((b) =>
        PUBLIC_BLOCKS.find((p) => p.id === b.id),
      );
      if (
        new Set(value.blocks.map((b) => b.id)).size !== value.blocks.length ||
        blocks.some((b) => !b || !evidenceIds.includes(b.evidenceId))
      )
        throw new Error("A supported answer could not be verified.");
      if (epoch === responseEpoch.current)
        setAnswer({
          blocks: blocks as PublicBlock[],
          notice: value.notice,
          model: value.model,
        });
    } catch (e) {
      if (epoch === responseEpoch.current)
        setError(
          e instanceof Error
            ? e.message
            : "A supported answer could not be verified.",
        );
    } finally {
      if (epoch === responseEpoch.current) {
        setBusy(false);
        setConsent(false);
        setPreview(null);
      }
    }
  };
  return (
    <section className="public-assistant" aria-label="Gemini science guide">
      <header className="assistant-heading">
        <span className="assistant-icon">
          <Sparkles size={20} aria-hidden="true" />
        </span>
        <div>
          <span className="assistant-eyebrow">
            A LITTLE HELP WITH THE SCIENCE
          </span>
          <h3>
            {resultContext ? "Understand this result" : "Explore the science"}
          </h3>
        </div>
        <span className="assistant-badge">Gemini · optional</span>
      </header>
      <p className="assistant-intro">
        {resultContext
          ? "Your measurements are explained above. Ask about the science behind them using reviewed public sources."
          : "Choose a question to explore with reviewed public sources."}
      </p>
      <p className="assistant-privacy">
        <ShieldCheck size={16} aria-hidden="true" />
        Your result, area, files and notes stay in Earthsignal.
      </p>
      <div className="assistant-question-row">
        <label className="assistant-question">
          Choose a question
          <WorkspaceSelect
            label="Choose a question"
            placeholder="What would you like to understand?"
            value={
              Object.values(PUBLIC_QUESTIONS).includes(question) ? question : ""
            }
            onValueChange={changeQuestion}
            title={question || undefined}
            options={[
              { value: "", label: "Clear question" },
              ...PUBLIC_BLOCKS.filter(
                (b) => b.domain === domain || b.domain === "general",
              )
                .filter((b) => PUBLIC_QUESTIONS[b.id])
                .map((b) => ({
                  value: PUBLIC_QUESTIONS[b.id],
                  label: PUBLIC_QUESTIONS[b.id],
                })),
            ]}
          />
        </label>
        <button
          className="assistant-review-button"
          type="button"
          disabled={!approvedPublicQuestion(question) || busy}
          onClick={() => {
            setPreview(payload);
            setConsent(false);
          }}
        >
          Review what’s shared
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
      {selectedBlock && (
        <aside className="assistant-proof">
          <span>TRY THE IDEA WITH YOUR OWN HANDS</span>
          <ReviewedExplanation block={selectedBlock} />
          <small>
            Local public instrument · no AI request or private result shared.
          </small>
        </aside>
      )}
      {reviewed && (
        <div
          className="assistant-review"
          aria-label="Review the public information to share"
        >
          <span className="assistant-eyebrow">
            ONLY THIS PUBLIC INFORMATION
          </span>
          <p className="assistant-reviewed-question">{question}</p>
          <details className="assistant-sources">
            <summary>{sharedBlocks.length} reviewed public sources</summary>
            <ul>
              {sharedBlocks.map((b) => (
                <li key={b.id}>
                  <a href={b.url} target="_blank" rel="noreferrer">
                    {b.sourceTitle}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <details className="assistant-payload">
            <summary>View the exact payload</summary>
            <pre>{preview}</pre>
          </details>
          <p className="assistant-data-use">
            Google may use free-tier submissions to improve its products.{" "}
            <a
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noreferrer"
            >
              Data-use terms
            </a>
          </p>
          <label className="assistant-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I approve sending this public question and these sources to
              Gemini.
            </span>
          </label>
          <button
            className="assistant-primary"
            type="button"
            disabled={
              connection !== "ready" ||
              !consent ||
              busy ||
              !approvedPublicQuestion(question)
            }
            onClick={() => void ask()}
          >
            <Sparkles size={16} aria-hidden="true" />
            {busy ? "Checking the evidence…" : "Ask Gemini"}
          </button>
        </div>
      )}
      {connection !== "ready" && (
        <p className="assistant-status" role="status">
          {connection === "checking" ? (
            "Checking the Gemini connection…"
          ) : connection === "sign-in" ? (
            <>
              <a href="/sign-in">Sign in</a> to ask Gemini. You can read the
              science below without signing in.
            </>
          ) : connection === "configuration" ? (
            "Gemini has not been connected by the operator. You can still read the science below."
          ) : (
            "The Gemini connection could not be checked. Your local explanation and sources are still available."
          )}
        </p>
      )}
      {error && (
        <div className="assistant-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}
      {answer && (
        <div className="assistant-answer" aria-live="polite">
          <p className="assistant-answer-note">
            {answer.notice} · {answer.model}
          </p>
          {answer.blocks
            .filter((b) => b.id !== selectedBlock?.id)
            .map((b) => (
              <ReviewedExplanation key={b.id} block={b} />
            ))}
        </div>
      )}
      <details className="assistant-library">
        <summary>
          <BookOpen size={16} aria-hidden="true" />
          Read the science without AI
        </summary>
        {PUBLIC_BLOCKS.filter((b) => b.domain === domain).map((b) => (
          <ReviewedExplanation key={b.id} block={b} />
        ))}
      </details>
    </section>
  );
}

function ReviewedExplanation({ block: b }: { block: PublicBlock }) {
  const action = b.focusTarget ? PUBLIC_PROOF_ACTIONS[b.focusTarget] : null;
  return (
    <article>
      <span className="claim-tag">{b.type}</span>
      <h4>{b.title}</h4>
      <p>{b.hook}</p>
      {action && (
        <a className="assistant-proof-link" href={action.href}>
          {action.label} <ArrowUpRight size={16} />
        </a>
      )}
      <details className="assistant-technical">
        <summary>How it works &amp; where the evidence stops</summary>
        <p>{b.text}</p>
        <a href={b.url} target="_blank" rel="noreferrer">
          {b.sourceTitle}
        </a>
        <p className="assistant-limitations">{b.limitations.join(" · ")}</p>
      </details>
    </article>
  );
}
