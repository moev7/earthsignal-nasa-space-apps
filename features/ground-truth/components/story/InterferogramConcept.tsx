'use client';
import { useStory } from './StoryProvider';
import { RadarLesson } from './radar3d/RadarLesson';
import type { RadarModelState, RadarExperimentControl } from './radar3d/RadarLesson';
import type { ReactNode } from 'react';

/** Synthetic repeat-pass teaching lesson; className/ariaLabel API is preserved. */
export function InterferogramConcept({ className, ariaLabel = 'Interactive repeat-pass radar geometry and synthetic phase fringes', story = false, onModelChange, children, experiment }: {
  story?: boolean;
  className?: string;
  ariaLabel?: string;
  onModelChange?: (state: RadarModelState) => void;
  children?: ReactNode;
  experiment?: RadarExperimentControl;
}) {
  const { replayToken } = useStory();
  return <RadarLesson story={story} className={className} ariaLabel={ariaLabel} replayToken={replayToken} onModelChange={onModelChange} experiment={experiment}>{children}</RadarLesson>;
}
