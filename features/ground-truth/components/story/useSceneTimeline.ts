import { useRef } from 'react'
import type { RefObject } from 'react'
import { useInView } from 'framer-motion'

import { useTimeline } from '@/features/ground-truth/lib/useTimeline'
import type { TimelineControls } from '@/features/ground-truth/lib/useTimeline'
import { useStory } from './StoryProvider'
import { useVisibleReplay } from './useVisibleReplay'

export interface SceneTimeline {
  /** Attach to the element that scopes this scene's clock. */
  ref: RefObject<HTMLDivElement | null>
  inView: boolean
  timeline: TimelineControls
}

/**
 * A scene clock that only runs while its section is on screen, stops when the
 * chapter rail asks for a pause, and restarts when the rail asks to replay.
 *
 * Scenes derive their SVG geometry from `timeline.progress`, so pausing really
 * freezes the mechanism rather than just halting a decorative loop.
 */
export function useSceneTimeline(durationMs: number): SceneTimeline {
  const ref = useRef<HTMLDivElement | null>(null)
  const inView = useInView(ref, { amount: 0.3 })
  const { paused, replayToken } = useStory()
  const timeline = useTimeline(durationMs, { enabled: inView && !paused })

  useVisibleReplay(replayToken, inView, timeline.replay)

  return { ref, inView, timeline }
}
