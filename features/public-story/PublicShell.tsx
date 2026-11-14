"use client";

import { SiteLink as Link } from "@/components/site-link";
import { EarthsignalMark } from "@/components/earthsignal-mark";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Gamepad2,
  BookOpen,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  StoryProvider,
  useStory,
} from "@/features/ground-truth/components/story/StoryProvider";
import "./public-story.css";
import "./quest/game-presence.css";
import { GameDirector, useGame } from "./quest/GameDirector";

export const PUBLIC_CHAPTERS = [
  { id: "opening", title: "The ground beneath us" },
  { id: "hidden-cause", title: "Follow the water" },
  { id: "consequences", title: "An uneven city" },
  { id: "from-space", title: "Read the satellite signal" },
  { id: "observations", title: "The real observations" },
  { id: "what-we-can-do", title: "Tokyo & a different future" },
] as const;

type PublicPage = "story" | "explore" | "compare" | "about";
const NAV: { page: PublicPage; href: string; text: string }[] = [
  { page: "story", href: "/", text: "The story" },
  { page: "explore", href: "/explore", text: "Explore places" },
  { page: "compare", href: "/compare", text: "Tehran & Tokyo" },
];

/** Resolve at action time too: a native anchor/lazy layout can precede React's scroll frame. */
function chapterAtReadingLine() {
  const readingLine = Math.min(window.innerHeight * 0.35, 280);
  let next = 0;
  PUBLIC_CHAPTERS.forEach((chapter, index) => {
    const element = document.getElementById(chapter.id);
    if (element && element.getBoundingClientRect().top <= readingLine)
      next = index;
  });
  return next;
}

function useCurrentChapter(enabled: boolean) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      setCurrent(chapterAtReadingLine());
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    onScroll();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onScroll);
    const main = document.getElementById("public-main");
    if (main) observer?.observe(main);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("popstate", onScroll);
    window.addEventListener("hashchange", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("popstate", onScroll);
      window.removeEventListener("hashchange", onScroll);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [enabled]);
  return current;
}

function PublicHeader({
  page,
  playback,
  game,
}: {
  page: PublicPage;
  playback: boolean;
  game: boolean;
}) {
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = header.current,
      surface = node?.closest<HTMLElement>(".es-public");
    if (!node || !surface) return;
    const measure = () => {
      surface.style.setProperty(
        "--es-header-height",
        `${Math.ceil(node.getBoundingClientRect().height)}px`,
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const { paused, togglePaused, replay } = useStory();
  const director = useGame();
  const scrollCurrent = useCurrentChapter(page === "story" && !game);
  const current =
    director?.chapter === "case-file"
      ? PUBLIC_CHAPTERS.length
      : director
        ? Math.max(
            0,
            PUBLIC_CHAPTERS.findIndex((item) => item.id === director.chapter),
          )
        : scrollCurrent;
  const contents = useRef<HTMLDetailsElement>(null);
  const chapter =
    current === PUBLIC_CHAPTERS.length
      ? { id: "case-file", title: "Your case file" }
      : PUBLIC_CHAPTERS[current];
  const go = (index: number) => {
    if (director && index === PUBLIC_CHAPTERS.length) {
      director.navigate("case-file");
      if (contents.current) contents.current.open = false;
      return;
    }
    if (!PUBLIC_CHAPTERS[index]) return;
    if (director) {
      director.navigate(PUBLIC_CHAPTERS[index].id);
      if (contents.current) contents.current.open = false;
      return;
    }
    const target = document.getElementById(PUBLIC_CHAPTERS[index].id);
    if (target) {
      // Record the old reading position before moving; Back must restore it.
      window.history.pushState(null, "", `#${target.id}`);
      target.scrollIntoView({ behavior: "auto", block: "start" });
      target.focus({ preventScroll: true });
    }
    if (contents.current) contents.current.open = false;
  };

  return (
    <header className="es-header" ref={header}>
      <div className="es-header-main es-wrap">
        <Link className="es-brand" href="/" aria-label="Earthsignal home">
          <EarthsignalMark />
          Earthsignal
        </Link>
        <nav aria-label="Public navigation" className="es-nav">
          {page === "story" && (
            <Link
              className="ep-mode-link"
              href={
                game
                  ? `/#${director?.chapter === "case-file" ? "what-we-can-do" : (director?.chapter ?? chapter.id)}`
                  : `/?mode=game#${chapter.id}`
              }
            >
              <CompassIcon game={game} />
              <span>{game ? "Read story" : "Play game"}</span>
            </Link>
          )}
          {page === "story" ? (
            <>
              <Link href="/explore" aria-label="Explore places">
                <span className="es-nav-long">Explore places</span>
                <span className="es-nav-short">Explore</span>
              </Link>
              <Link href="/workspace" aria-label="Advanced tools">
                <span className="es-nav-long">Advanced tools</span>
                <span className="es-nav-short">Tools</span>
              </Link>
            </>
          ) : (
            <>
              {NAV.map((item) => (
                <Link
                  key={item.page}
                  href={item.href}
                  aria-current={page === item.page ? "page" : undefined}
                >
                  {item.text}
                </Link>
              ))}
              <Link href="/workspace">Advanced tools</Link>
            </>
          )}
        </nav>
        {playback && page !== "story" && (
          <PlaybackControls
            paused={paused}
            togglePaused={togglePaused}
            replay={replay}
          />
        )}
      </div>
      {page === "story" && (
        <div className="es-chapter-bar es-wrap">
          <div className="es-chapter-position">
            <button
              className="es-icon-button"
              type="button"
              onClick={() =>
                go((director ? current : chapterAtReadingLine()) - 1)
              }
              disabled={current === 0}
              aria-label="Previous chapter"
            >
              <ArrowLeft size={18} />
            </button>
            <details
              className="es-contents"
              ref={contents}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                aria-label={`Contents. Current chapter: ${chapter.title}`}
              >
                <span>{chapter.title}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <nav aria-label="Story chapters">
                {PUBLIC_CHAPTERS.map((item, index) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    aria-current={current === index ? "location" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      go(index);
                    }}
                  >
                    {item.title}
                  </a>
                ))}
                <a
                  href="#sources"
                  onClick={() => {
                    if (contents.current) contents.current.open = false;
                  }}
                >
                  Sources &amp; methods
                </a>
                <Link href="/compare">Tehran &amp; Tokyo comparison</Link>
                <Link
                  className="es-story-mode-link"
                  href={`${game ? "/" : "/?mode=game"}#${director?.chapter === "case-file" ? "what-we-can-do" : (director?.chapter ?? chapter.id)}`}
                >
                  {game ? "Read the story" : "Play investigation"}
                </Link>
              </nav>
            </details>
            <button
              className="es-icon-button"
              type="button"
              onClick={() =>
                go((director ? current : chapterAtReadingLine()) + 1)
              }
              disabled={current >= PUBLIC_CHAPTERS.length - (game ? 0 : 1)}
              aria-label="Next chapter"
            >
              <ArrowRight size={18} />
            </button>
          </div>
          <PlaybackControls
            paused={paused}
            togglePaused={togglePaused}
            replay={replay}
          />
        </div>
      )}
    </header>
  );
}

function PlaybackControls({
  paused,
  togglePaused,
  replay,
}: {
  paused: boolean;
  togglePaused: () => void;
  replay: () => void;
}) {
  return (
    <div
      className="es-playback"
      role="group"
      aria-label="Story animation controls"
    >
      <button
        type="button"
        className="es-text-button"
        onClick={togglePaused}
        aria-pressed={paused}
        aria-label={
          paused ? "Resume all story animations" : "Pause all story animations"
        }
      >
        {paused ? (
          <Play size={16} aria-hidden="true" />
        ) : (
          <Pause size={16} aria-hidden="true" />
        )}
        <span>{paused ? "Resume" : "Pause"}</span>
      </button>
      <button
        type="button"
        className="es-text-button"
        onClick={replay}
        aria-label="Replay story scenes from the beginning"
      >
        <RotateCcw size={16} aria-hidden="true" />
        <span>Replay</span>
      </button>
    </div>
  );
}

export function PublicFrame({
  page,
  children,
  playback = false,
  game = false,
}: {
  page: PublicPage;
  children: ReactNode;
  playback?: boolean;
  game?: boolean;
}) {
  const content = (
    <div
      className={`es-public es-page-${page}`}
      data-experience={page === "story" ? (game ? "game" : "story") : undefined}
    >
      <div className="es-viewport-probe" aria-hidden="true" />
      <a className="es-skip" href="#public-main">
        Skip to content
      </a>
      <PublicHeader page={page} playback={playback} game={game} />
      <main id="public-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="es-footer es-wrap">
        <div>
          <Link className="es-footer-brand" href="/">
            Earthsignal
          </Link>
          <p>Making the ground beneath us easier to understand.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/about">Evidence &amp; purpose</Link>
          <Link href="/compare">Tehran &amp; Tokyo</Link>
          <Link href="/workspace">
            Investigate a place <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </nav>
        <p className="es-footer-note">
          Educational · not a safety or warning service.
        </p>
      </footer>
    </div>
  );
  return (
    <StoryProvider>
      {game ? <GameDirector>{content}</GameDirector> : content}
    </StoryProvider>
  );
}

export function ActionLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={primary ? "es-action es-action-primary" : "es-action"}
    >
      {children}
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}

function CompassIcon({ game }: { game: boolean }) {
  return game ? (
    <BookOpen size={17} aria-hidden="true" />
  ) : (
    <Gamepad2 size={17} aria-hidden="true" />
  );
}
