---
name: Earthsignal public experience
description: An interactive dark exhibition about the ground beneath a city
colors:
  accent: "#8bcec0"
  accent-hover: "#afe0d4"
  background: "#191c1d"
  surface: "#222627"
  deep: "#121617"
  text: "#f1eee7"
  muted: "#b5bcb8"
  line: "#404948"
typography:
  story-display:
    fontFamily: "Barlow Condensed, Manrope, sans-serif"
    fontSize: "clamp(4.3rem, 6.9vw, 6rem)"
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.015em"
  display:
    fontFamily: "Manrope, Inter, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(3.1rem, 5vw, 4.5rem)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Manrope, Inter, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.7
  caption:
    fontFamily: "Manrope, Inter, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.65
rounded:
  control: "6px"
  scene: "12px"
spacing:
  small: "8px"
  medium: "24px"
  large: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.deep}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "52px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  scene:
    backgroundColor: "{colors.deep}"
    rounded: "{rounded.scene}"
---

## Overview

**Creative North Star: "Dark exhibition"**

Scientific scenes receive the space and attention of an exhibition. Warm white text sits on charcoal; a restrained mint accent identifies interaction. Scenes, maps and direct manipulation carry the explanation, with short prose nearby and specialist material in persistent disclosures.

The public story and advanced investigation workspace share the same palette, Manrope typography and Earthsignal mark. Public pages use editorial layouts; the workspace keeps its compact scientific panels and an explicit “Back to the story” link.

**Key Characteristics:**
- Large interactive scenes with calm editorial spacing.
- Normal scrolling and compact chapter navigation.
- Evidence labels beside the content they qualify.
- Purposeful motion with pause, replay and still-state alternatives.

## Colors

Use the accent for actions and selected states. Background, deep and surface establish hierarchy; text and muted distinguish explanations from captions. Dividers use the line token.

**The Evidence Colour Rule.** Reserve multicolour scales for explaining data. Preserve the scientific raster’s original colour scale.

## Typography

Use the self-hosted Manrope variable font with sans-serif fallbacks. Headlines use sentence case and moderate weight. Keep body copy generous and captions readable. Monospace belongs to occasional units or technical identifiers.

The public story adds self-hosted Barlow Condensed at weight 600 for its industrial display voice, as requested in the reference-led visual revision. Its short uppercase headlines have a six-rem ceiling; reading text, controls, other routes and the workspace retain Manrope. Do not turn body copy into technical lettering.

## Layout

The content width is capped at 1344px. Desktop gutters are 48px per side, falling to 20px on a small phone. Wide scenes alternate with heading/explanation layouts; columns stack on smaller screens. Phone body text is 17px. Controls wrap instead of shrinking their touch targets.

The public story uses an object-led industrial composition: a finite 3D neighbourhood against charcoal, sparse explanatory leaders, and real city photography interrupted by interactive scientific scenes. Tehran and Tokyo photographs provide urban context; the NISAR rendering is labelled an artist's concept. None serves as observational evidence of damage. Avoid repeating the same two-column composition throughout the journey.

**The Focus Rule.** Simplify presentation without deleting useful data or interactions. Put supporting options behind clear controls, and keep the primary map, scene or comparison discoverable.

The sticky header contains public destinations, chapter navigation and global playback. Keep anchor offsets clear of it. Dates, units, status, uncertainty and exaggerated-motion labels stay visible. On phones the opening scene follows the title before the longer introduction.

## Elevation & Depth

Use tonal surfaces and thin dividers. The contents menu has a modest shadow. Scientific 3D lighting explains geometry; decorative interface glows and gradients do not.

## Shapes

Controls have gently curved corners; scene frames are slightly softer. Avoid repeated icon-card grids and pill badges as page structure.

Use the shared `--earth-space-*` scale for interface grouping: 8px within a label/value pair, 12–16px between controls, and 24–48px between sections. Interface captions use the shared 13px minimum, labels 14px, and body/control text 15–16px; public reading copy retains its larger scale. Let labels wrap and controls grow. Keep disclosures in document flow and show the full current Echo message. On desktop, place the current action beside its model; on phones, allow the page to grow naturally. Do not recover viewport space by shrinking text or clipping instructions.

## Components

Primary actions use accent fill and dark text; secondary actions use a quiet outline. Focus has a visible accent outline with breathing room. Touch targets are at least 44px high.

Group scene playback and timelines together. Keep orbit manipulation explicit on touch devices. Expose zoom, selection, measurement cells and conditional thresholds without crowding the stage. Display future summaries outside the canvas.

The atlas places city, layer and background controls above a large map. Dates, source records, numerical inspection and specialist settings use native details/summary. Preserve keyboard alternatives for map and chart inspection. Tokyo remains an interactive case study, with a visible route and a substantial comparison.

Reduced motion offers manually selected still states. Scene, tile and dataset failures retain useful explanations and static alternatives.

## Do's and Don'ts

### Do:
- Do give the interactive scientific content the largest visual area.
- Do preserve useful features through progressive disclosure.
- Do keep dates and evidence status near the scene.
- Do preserve keyboard controls and ordinary page scrolling.

### Don't:
- Don't use gradient headings, glowing actions or decorative grids.
- Don't turn every paragraph into an icon card.
- Don't label simulated collapse or extrapolated ground motion as a real building prediction.
- Don't create a separate visual identity for Advanced tools; share theme tokens while preserving scientific data colours and its specialist layout.
