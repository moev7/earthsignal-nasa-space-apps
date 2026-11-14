"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { Volume2, VolumeX, ArrowDown, SlidersHorizontal } from "lucide-react";
import { useStory } from "@/features/ground-truth/components/story/StoryProvider";
import { createSoundscape, type SoundCue } from "./createSoundscape";
import {
  createEchoNarration,
  type VoiceCue,
  type VoiceState,
} from "./createEchoNarration";
import credits from "@/docs/internal/story-audio-sources.json";
type Sound = {
  voiceState: VoiceState;
  speak: (cue: VoiceCue) => void;
  stopVoice: () => void;
  enabled: boolean;
  unavailable: boolean;
  toggle: () => void;
  enable: () => void;
  listen: (kind: SoundCue, value?: number) => void;
  volume: number;
  setVolume: (value: number) => void;
  cue: (kind: SoundCue, value?: number) => void;
  silence: () => void;
  respond: (
    kind: "water" | "strain" | "phase",
    intensity?: number,
    phase?: number,
  ) => void;
};
const Context = createContext<Sound>({
  voiceState: "idle",
  speak() {},
  stopVoice() {},
  enabled: false,
  unavailable: false,
  toggle() {},
  enable() {},
  listen() {},
  volume: 0.6,
  setVolume() {},
  cue() {},
  silence() {},
  respond() {},
});
export const useDiscoverySound = () => useContext(Context);

/** One page-scoped ambient bed; scene exits cancel only their foreground foley. */
export function DiscoverySound({ children }: { children: ReactNode }) {
  const { paused, replayToken } = useStory();
  const [enabled, setEnabled] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [volume, setVolume] = useState(0.6);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const narration = useRef<ReturnType<typeof createEchoNarration> | null>(null);
  const stopVoice = useCallback(() => narration.current?.stop(), []);
  const surface = useRef<HTMLDivElement>(null),
    context = useRef<AudioContext | null>(null),
    audio = useRef<ReturnType<typeof createSoundscape> | null>(null);
  const live = useRef(true),
    enabledRef = useRef(false),
    pausedRef = useRef(paused),
    visible = useRef(true),
    activation = useRef(0),
    foreground = useRef(0);
  const refresh = useCallback(
    () =>
      audio.current?.setAudible(
        live.current &&
          enabledRef.current &&
          !pausedRef.current &&
          visible.current &&
          document.visibilityState !== "hidden",
      ),
    [],
  );
  const failed = useCallback(() => {
    if (!live.current) return;
    enabledRef.current = false;
    activation.current++;
    foreground.current++;
    audio.current?.setAudible(false);
    narration.current?.stop();
    setEnabled(false);
    setUnavailable(true);
  }, []);
  const silence = useCallback(() => {
    foreground.current++;
    audio.current?.stopEffects();
    narration.current?.stop();
  }, []);
  useEffect(() => {
    live.current = true;
    const invalidate = () => {
      activation.current++;
      foreground.current++;
    };
    const changed = () => {
      if (document.visibilityState === "hidden") {
        activation.current++;
        foreground.current++;
        audio.current?.setAudible(false);
        narration.current?.stop();
        void context.current?.suspend().catch(() => {});
      } else refresh();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible.current = entry.isIntersecting;
            if (!entry.isIntersecting) {
              activation.current++;
              foreground.current++;
              narration.current?.stop();
            }
            refresh();
          });
    if (surface.current) observer?.observe(surface.current);
    document.addEventListener("visibilitychange", changed);
    return () => {
      live.current = false;
      invalidate();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", changed);
      narration.current?.dispose();
      narration.current = null;
      audio.current?.dispose();
      audio.current = null;
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    pausedRef.current = paused;
    activation.current++;
    foreground.current++;
    audio.current?.setAudible(false);
    narration.current?.stop();
    refresh();
  }, [paused, replayToken, refresh]);
  useEffect(() => {
    audio.current?.volume(volume);
    narration.current?.volume(volume);
  }, [volume]);
  const activate = (preview: SoundCue = "arrival", value = 0) => {
    enabledRef.current = true;
    setEnabled(true);
    setUnavailable(false);
    const epoch = ++activation.current,
      fx = ++foreground.current;
    try {
      const Constructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Constructor) throw Error("Audio unavailable");
      context.current ??= new Constructor();
      audio.current ??= createSoundscape(context.current, failed);
      audio.current.volume(volume);
      audio.current.warm();
      void context.current
        .resume()
        .then(() => {
          if (
            !live.current ||
            epoch !== activation.current ||
            !enabledRef.current
          )
            return;
          refresh();
          if (
            preview !== "arrival" &&
            foreground.current === fx &&
            !pausedRef.current &&
            visible.current &&
            document.visibilityState !== "hidden"
          )
            void audio.current?.cue(preview, value);
        })
        .catch(() => {
          if (epoch === activation.current) failed();
        });
    } catch {
      failed();
    }
  };
  const toggle = () => {
    if (!enabledRef.current) {
      activate();
      return;
    }
    enabledRef.current = false;
    activation.current++;
    foreground.current++;
    setEnabled(false);
    narration.current?.stop();
    audio.current?.setAudible(false);
    void context.current?.suspend().catch(() => {});
  };
  const enable = () => {
    if (!enabledRef.current) activate();
    else refresh();
  };
  const cue: Sound["cue"] = (kind, value = 0) => {
    if (
      enabledRef.current &&
      !pausedRef.current &&
      visible.current &&
      document.visibilityState !== "hidden"
    )
      void audio.current?.cue(kind, value);
  };
  const listen: Sound["listen"] = (kind, value = 0) => {
    if (!enabledRef.current || context.current?.state !== "running")
      activate(kind, value);
    else cue(kind, value);
  };
  const speak = (voiceCue: VoiceCue) => {
    if (
      pausedRef.current ||
      !visible.current ||
      document.visibilityState === "hidden"
    )
      return;
    if (!enabledRef.current) activate();
    if (!context.current) return;
    narration.current ??= createEchoNarration(context.current, (state) => {
      if (!live.current) return;
      setVoiceState(state);
      audio.current?.duck(state === "loading" || state === "speaking");
    });
    narration.current.volume(volume);
    void narration.current.speak(voiceCue);
  };
  return (
    <Context.Provider
      value={{
        voiceState,
        speak,
        stopVoice,
        enabled,
        unavailable,
        toggle,
        enable,
        listen,
        volume,
        setVolume,
        cue,
        silence,
        respond: (kind, intensity = 0, phase = 0) => {
          if (
            enabledRef.current &&
            !pausedRef.current &&
            visible.current &&
            document.visibilityState !== "hidden"
          )
            void audio.current?.respond(kind, intensity, phase);
        },
      }}
    >
      <div ref={surface} className="ea-sound-surface">
        {children}
      </div>
      {enabled && (
        <div className="ea-sound-dock">
          <SoundSwitch iconOnly />
          <details>
            <summary className="ea-sound-level" aria-label="Sound level"><SlidersHorizontal size={17} aria-hidden="true" /><span>Level</span></summary>
            <div className="ea-sound-settings">
              <label>
                Sound level
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={Math.round(volume * 100)}
                  onChange={(e) => setVolume(Number(e.target.value) / 100)}
                />
              </label>
              <div className="ea-sound-credit">
                <p>
                  Designed space ambience &amp; recorded water/material foley.
                  Collapse sounds accompany the invented model.
                </p>
                <details>
                  <summary>Sound credits</summary>
                  {credits.sources.map((source) => (
                    <p key={source.id}>
                      <a href={source.page}>{source.title}</a> · {source.author}{" "}
                      · CC0
                    </p>
                  ))}
                </details>
              </div>
            </div>
          </details>
        </div>
      )}
    </Context.Provider>
  );
}
export function SoundSwitch({ iconOnly = false }: { iconOnly?: boolean }) {
  const { enabled, unavailable, toggle } = useDiscoverySound();
  return (
    <button
      type="button"
      className={`ed-sound${iconOnly ? " ed-sound-icon" : ""}`}
      aria-label={
        unavailable
          ? "Sound unavailable · retry"
          : enabled
            ? "Turn optional sounds off"
            : "Turn optional sounds on"
      }
      aria-pressed={enabled}
      onClick={toggle}
      title="Ambient soundscape and recorded material effects; every result is also visible"
    >
      {enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
      <span>
        {unavailable
          ? "Sound unavailable · retry"
          : enabled
            ? "Sound on"
            : "Sound off"}
      </span>
    </button>
  );
}

/** The initial gesture unlocks audio and starts the ambient bed; silence is an equal path. */
export function SoundEntrance({
  href,
  label = "Begin with Echo",
  onBegin,
}: {
  href?: string;
  label?: string;
  onBegin?: () => void;
}) {
  const sound = useDiscoverySound();
  const begin = () => {
    sound.enable();
    onBegin?.();
  };
  return (
    <div className="ea-sound-entrance">
      <div>
        {href ? (
          <a
            className="es-action es-action-primary"
            href={href}
            onClick={begin}
          >
            {label} <Volume2 size={18} />
          </a>
        ) : (
          <button type="button" className="eg-launch" onClick={begin}>
            {label} <Volume2 size={18} />
          </button>
        )}
        {href ? (
          <a href={href} className="ea-silent-start">
            Continue quietly <ArrowDown size={15} />
          </a>
        ) : (
          <button type="button" className="ea-silent-start" onClick={onBegin}>
            Play quietly <ArrowDown size={15} />
          </button>
        )}
      </div>
      <small>
        {sound.unavailable
          ? "Audio unavailable here. Every discovery is still visible."
          : "With sound · best with headphones · always optional"}
      </small>
    </div>
  );
}
