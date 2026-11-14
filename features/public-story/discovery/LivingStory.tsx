"use client";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { SiteLink as Link } from "@/components/site-link";
import { CityScene } from "@/features/ground-truth/components/story/CityScene";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import { usePrefersReducedMotion } from "@/features/ground-truth/lib/useTimeline";
import { StoryPhotography } from "../StoryPhotography";
import { Sources } from "../Sources";
import { StoryStage } from "../StoryStage";
import { JourneyWater, JourneyCity, JourneyRadar } from "./NarrativeScenes";
import { ActionLink } from "../PublicShell";
import { DiscoveryWorld } from "./DiscoveryWorld";
import { TimeLapse } from "../timelapse/TimeLapse";
import { TehranScale, RadarEvidenceBridge } from "./StoryEvidenceBridge";
import "./exhibition.css";
import { SoundSwitch, SoundEntrance } from "./DiscoverySound";
import type { MissionId } from "@/lib/story-missions";
import "../story-experience.css";
import "../industrial-story.css";
import "../scene-layout.css";
import "./discovery.css";
const LearningLab = lazy(() => import("../LearningLab"));
const Atlas = lazy(() =>
  import("../InteractiveAtlas").then((m) => ({ default: m.InteractiveAtlas })),
);
function Depth({ topic }: { topic: "mechanism" | "radar" }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      id={topic === "radar" ? "radar-lab" : undefined}
      className="ed-details"
      onToggle={(e) => setOpened(e.currentTarget.open)}
    >
      <summary>
        {topic === "mechanism"
          ? "Other forces beneath a city & the deeper science"
          : "Profiles, radar wavelengths & satellite missions"}
      </summary>
      {opened && (
        <Suspense
          fallback={<p role="status">Opening the visual explanation…</p>}
        >
          <LearningLab topic={topic} />
        </Suspense>
      )}
    </details>
  );
}
function Chapter({
  anchor,
  id,
  title,
  setup,
  hook,
  next,
  world = true,
  children,
}: {
  anchor: string;
  id: MissionId;
  title: ReactNode;
  setup: string;
  hook?: string;
  next?: [string, string];
  world?: boolean;
  children?: ReactNode;
}) {
  const { replayToken } = useStory();
  return (
    <section
      id={anchor}
      className="ed-story-chapter es-wrap"
      tabIndex={-1}
      aria-labelledby={`${anchor}-title`}
    >
      <header className="ed-chapter-heading">
        <h2 id={`${anchor}-title`}>{title}</h2>
        <p>{setup}</p>
      </header>
      {world && <DiscoveryWorld key={replayToken} id={id} invitation={false} />}
      {children}
      {hook && next && (
        <div className="ed-next-question">
          <p>{hook}</p>
          <a href={`#${next[0]}`}>
            {next[1]}
            <ArrowRight size={18} />
          </a>
        </div>
      )}
    </section>
  );
}
function AtlasDepth() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="ed-details"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Open the full map, layers, buildings & ground profile</summary>
      {open && (
        <Suspense fallback={<p role="status">Opening the map…</p>}>
          <Atlas compact />
        </Suspense>
      )}
    </details>
  );
}
export function LivingStory() {
  const { paused } = useStory(),
    reduced = usePrefersReducedMotion();
  return (
    <div
      className="es-journey es-scroll-journey ed-living-story ea-story"
      data-motion={paused || reduced ? "still" : "active"}
    >
      <section
        id="opening"
        className="es-journey-hero es-wrap"
        aria-labelledby="opening-title"
        tabIndex={-1}
      >
        <div className="es-journey-title">
          <h1 id="opening-title">
            The ground is moving.
            <br />
            <span>
              Can you
              <br />
              see it?
            </span>
          </h1>
          <p>
            A street looks still. A satellite sees it move.
            Follow the water—and the echo that reveals the change.
          </p>
          <SoundEntrance href="#hidden-cause" label="Begin the story" />
          <Link className="es-optional-game" href="/?mode=game#opening">
            <span className="ep-invite-icon" aria-hidden="true">
              ✦
            </span>
            <span>
              <strong>Play the investigation</strong>
              <small>Five hands-on missions</small>
            </span>
            <ArrowRight size={20} />
          </Link>
        </div>
        <figure className="es-journey-city">
          <CityScene mode="measured" preview ambient exhibition intro />
          <figcaption>
            <span>
              South-west Tehran
            </span>
          </figcaption>
        </figure>
      </section>
      <div className="es-wrap ed-story-toolbar">
        <p>Scroll to begin · explore at your own pace</p>
        <SoundSwitch />
      </div>
      <section
        id="city-context"
        className="es-photo-bridge es-wrap"
        aria-label="Tehran, above the surface"
      >
        <div>
          <h2>
            An ordinary day.
            <br />
            An invisible change.
          </h2>
          <p>
            Every home needs water. What happens when it comes from beneath the street?
          </p>
        </div>
        <div>
          <StoryPhotography subject="tehran" />
          <TehranScale />
        </div>
      </section>
      <StoryStage
        id="hidden-cause"
        kicker={<p className="ea-act-number">01 / The thing you cannot see</p>}
        title={
          <>
            A city needs water.
            <br />
            The ground remembers.
          </>
        }
        description="Scroll to follow the water."
        notes={{ label: "Why the street stays down", content: <>
          <p>Water fills tiny spaces in sand and sediment, rather than a giant underground lake. A well draws water from those spaces.</p>
          <p>When water pressure falls, some fine layers squeeze and the ground above settles. Refilling does not necessarily reopen that lost space.</p>
          <p>The dashed line marks where the illustrated street began. Return the water to compare the water level with the land surface.</p>
        </> }}
        visual={({ progress }) => <JourneyWater progress={progress} />}
        beats={[
          {
            title: "First, look between the grains.",
            body: <p>Water sits between grains. Watch the blue layer fall.</p>,
          },
          {
            title: "Take the water. Lose some space.",
            body: <p>Less water pressure lets fine layers squeeze. The street settles.</p>,
          },
          {
            title: "Now bring the water back.",
            body: <p>Refill the water. Some squeezed-out space stays lost.</p>,
          },
        ]}
        evidence={
          <span>
            Illustration · exaggerated geometry
          </span>
        }
        appendix={<Depth topic="mechanism" />}
      />
      <div className="ea-narrative-link es-wrap">
        <span>But cities are not one solid block.</span>
        <ArrowDown aria-hidden="true" />
      </div>
      <StoryStage
        id="consequences"
        kicker={
          <p className="ea-act-number">02 / A connection tells the story</p>
        }
        title={
          <>
            One street.
            <br />
            Two different speeds.
          </>
        }
        description="Scroll to see the connections change."
        notes={{ label: "Why uneven sinking matters", content: <>
          <p>Buildings sit on ground; roads and pipes connect them. If one place settles more than another, those connections change shape.</p>
          <p>The difference across a street can matter as much as the largest sinking number. This invented city explains that mechanism; its damage is not a forecast.</p>
          <p>A person can inspect a crack. Satellite observations help reveal a wider pattern, without diagnosing any individual building.</p>
        </> }}
        visual={({ progress }) => <JourneyCity progress={progress} />}
        beats={[
          {
            title: "Everything is connected.",
            body: <p>Buildings, roads and pipes share ground that can move.</p>,
          },
          {
            title: "Watch what happens between places.",
            body: <p>Uneven sinking bends the connections between places.</p>,
          },
          {
            title: "You cannot watch every street.",
            body: <p>To see a wider pattern, we need a view from orbit.</p>,
          },
        ]}
        evidence={
          <span>
            Invented city · illustrative damage, not a forecast
          </span>
        }
      />
      <section className="ea-orbit-bridge es-wrap" aria-label="Meet NISAR">
        <div>
          <p className="ea-act-number">From a street to orbit</p>
          <h2>
            Give the invisible
            <br />
            an echo.
          </h2>
          <p>
            Meet NISAR, NASA and ISRO’s radar satellite. Follow one signal home.
          </p>
        </div>
        <StoryPhotography subject="nisar" />
      </section>
      <StoryStage
        id="from-space"
        kicker={<p className="ea-act-number">03 / The orbital duet</p>}
        title={
          <>
            One echo is a visit.
            <br />
            Two can reveal a change.
          </>
        }
        description="Scroll to compare two visits."
        notes={{ label: "How two echoes reveal movement", content: <>
          <p>The satellite sends a microwave signal and records the echo. It measures along the radar’s line of sight, rather than simply taking a photograph.</p>
          <p>If the ground moves, the signal travels a different distance. Comparing phase—the position within a repeating wave—reveals that difference.</p>
          <p>Repeated colour cycles make the change visible. Atmosphere, viewing geometry and other effects also matter; real estimates need processing and checks.</p>
        </> }}
        visual={({ progress }) => (
          <div id="radar-model">
            <JourneyRadar progress={progress} />
          </div>
        )}
        beats={[
          {
            title: "Send. Bounce. Return.",
            body: <p>Radar sends a signal and listens for its echo.</p>,
          },
          {
            title: "Come back to the same place.",
            body: <p>Moving ground changes the distance the next signal travels.</p>,
          },
          {
            title: "The colours are a clue, not a verdict.",
            body: <p>Colour cycles reveal a difference. A real measurement needs more checks.</p>,
          },
        ]}
        evidence={
          <span>
            Synthetic radar model · not satellite imagery
          </span>
        }
        appendix={<Depth topic="radar" />}
      />
      <Chapter
        anchor="observations"
        id="evidence"
        title={
          <>
            Back on
            <br />
            real ground.
          </>
        }
        setup="Scroll through four months of real observations."
        hook="Measurements can reveal change. They do not decide what happens next."
        next={["what-we-can-do", "Meet a city that changed course"]}
        world={false}
      >
        <section className="sa-watch" aria-label="Four months of ground, one pass at a time">
          <TimeLapse title="Four months of ground, one pass at a time." />
        </section>
        <RadarEvidenceBridge />
        <AtlasDepth />
        <div className="es-evidence-exits"><ActionLink href="/explore">Explore the observations</ActionLink></div>
      </Chapter>
      <Chapter
        anchor="what-we-can-do"
        id="tokyo"
        title={
          <>
            Tokyo chose
            <br />
            another path.
          </>
        }
        setup="Tokyo changed course. Try a response that addresses water use—and checks what happens."
      >
        <div className="ed-story-ending">
          <div>
            <h3>
              What would you ask
              <br />
              about your place?
            </h3>

          </div>
          <div className="es-finish-links">
            <ActionLink href="/workspace" primary>
              Investigate a place
            </ActionLink>
            <Link href="/compare">
              Compare Tehran & Tokyo <ArrowRight size={18} />
            </Link>
            <Link href="/?mode=game#opening">
              Collect the five discoveries <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </Chapter>
      <Sources />
    </div>
  );
}

import "./alive.css";
