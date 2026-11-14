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
  radarOnly,
  children,
}: {
  anchor: string;
  id: MissionId;
  title: ReactNode;
  setup: string;
  hook?: string;
  next?: [string, string];
  radarOnly?: boolean;
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
      <DiscoveryWorld key={replayToken} id={id} invitation={false} radarOnly={radarOnly} />
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
              <small>Five hands-on missions · Echo is your co-pilot</small>
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
        description="Stay with this street as you scroll. We are going beneath it."
        visual={({ progress }) => <JourneyWater progress={progress} />}
        beats={[
          {
            title: "First, look between the grains.",
            body: (
              <>
                <p>
                  There is no giant lake under this street. Water fills tiny
                  spaces in sand and sediment. A well draws from those spaces.
                </p>
                <p className="ea-look">↓ Watch the blue layer as you scroll.</p>
              </>
            ),
          },
          {
            title: "Take the water. Lose some space.",
            body: (
              <p>
                When water pressure falls, some fine layers squeeze. Everything
                above them settles too. The city can move while an ordinary day
                carries on.
              </p>
            ),
          },
          {
            title: "Now bring the water back.",
            body: (
              <>
                <p>
                  Here is the twist: refilling does not necessarily reopen the
                  space that was squeezed out. The water can return without the
                  street returning.
                </p>
                <p className="ea-look">
                  Try returning the water yourself. The dashed line remembers
                  where the street began.
                </p>
              </>
            ),
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
        description="A road, a pipe, a row of homes: they connect places that may move differently."
        visual={({ progress }) => <JourneyCity progress={progress} />}
        beats={[
          {
            title: "Everything is connected.",
            body: (
              <p>
                Start with an invented neighbourhood. The buildings sit on
                ground; roads and pipes connect them. Now let the ground move.
              </p>
            ),
          },
          {
            title: "Watch what happens between places.",
            body: (
              <p>
                One part settles more than another. The connections change
                shape. The difference across a street can matter as much as the
                largest sinking number.
              </p>
            ),
          },
          {
            title: "You cannot watch every street.",
            body: (
              <>
                <p>
                  A person can inspect a crack. A city needs a way to notice a
                  much wider pattern—before turning an observation into a claim.
                </p>
                <p className="ea-look">
                  Next stop: an instrument that brings its own light.
                </p>
              </>
            ),
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
        description="Follow the same ground target across two visits. Scroll to bring the echoes together."
        visual={({ progress }) => (
          <div id="radar-model">
            <JourneyRadar progress={progress} />
          </div>
        )}
        beats={[
          {
            title: "Send. Bounce. Return.",
            body: (
              <p>
                The satellite sends a microwave signal and records the echo. It
                measures along the radar’s line of sight, rather than simply
                taking a photograph.
              </p>
            ),
          },
          {
            title: "Come back to the same place.",
            body: (
              <p>
                If the ground moved between visits, the signal travels a
                different distance. Compare the phase—the position within the
                repeating wave.
              </p>
            ),
          },
          {
            title: "The colours are a clue, not a verdict.",
            body: (
              <>
                <p>
                  Repeated colour cycles help make an invisible change visible.
                  But atmosphere, viewing geometry and other effects also
                  matter. A real estimate needs processing and checks.
                </p>
                <p className="ea-look">
                  We have made a model. Now let us leave it and open the actual
                  record.
                </p>
              </>
            ),
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
        setup="This record is real. Compare two radar visits, then scroll through four months of Tehran’s ground."
        hook="Measurements can reveal change. They do not decide what happens next."
        next={["what-we-can-do", "Meet a city that changed course"]}
        radarOnly
      >
        <section className="sa-watch" aria-label="Four months of ground, one pass at a time">
          <TimeLapse title="Four months of ground, one pass at a time." />
        </section>
        <RadarEvidenceBridge />
        <AtlasDepth />
        <div className="es-evidence-exits">
          <ActionLink href="/explore">Explore the observations</ActionLink>
          <ActionLink href="/explore?study=lake-mead-gcov-2026">
            Full radar comparison & downloads
          </ActionLink>
        </div>
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
            <p>
              How much water leaves? What is the ground doing? What could
              change—and how would you check?
            </p>
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
