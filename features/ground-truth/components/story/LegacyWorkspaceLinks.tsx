"use client";
import { useEffect } from 'react';
import { LEGACY_WORKSPACE_ANCHORS, LEGACY_STORY_ANCHORS } from '@/lib/story-evidence';
export function LegacyWorkspaceLinks() {
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (LEGACY_WORKSPACE_ANCHORS.has(anchor)) window.location.replace(`/workspace#${anchor}`);
    else if (LEGACY_STORY_ANCHORS[anchor]) window.location.replace(`#${LEGACY_STORY_ANCHORS[anchor]}`);
  }, []);
  return null;
}
