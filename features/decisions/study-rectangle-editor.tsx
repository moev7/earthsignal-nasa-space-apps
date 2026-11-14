"use client";
import { useId, useRef, useState } from "react";
import { coordinateInput, RECTANGLE_FIELDS, studyRectangle, type RectangleErrors, type RectangleField, type RectangleInputs } from "@/lib/study-rectangle";
import type { AssessmentArea } from "@/lib/observatory-contract";

const labels = { west: "West longitude", south: "South latitude", east: "East longitude", north: "North latitude" };

/** Geometry changes reset the draft in place, preserving keyboard focus. Account changes remount it. */
export function StudyRectangleEditor({ extent, selectionKey, onApply }: {
  extent: readonly [number, number, number, number];
  selectionKey: string;
  onApply: (area: AssessmentArea) => void;
}) {
  const initial = Object.fromEntries(RECTANGLE_FIELDS.map((field, i) => [field, coordinateInput(extent[i])])) as RectangleInputs;
  const [previousSelection, setPreviousSelection] = useState(selectionKey);
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<RectangleErrors>({});
  if (previousSelection !== selectionKey) {
    setPreviousSelection(selectionKey);
    setInput(initial);
    setErrors({});
  }
  const refs = useRef<Partial<Record<RectangleField, HTMLInputElement | null>>>({});
  const id = useId();
  const dirty = RECTANGLE_FIELDS.some(field => input[field] !== initial[field]);
  const apply = () => {
    const result = studyRectangle(input);
    if (!result.ok) {
      setErrors(result.errors);
      const first = RECTANGLE_FIELDS.find(field => result.errors[field]);
      if (first) refs.current[first]?.focus();
      return;
    }
    setErrors({});
    onApply(result.area);
  };
  return <fieldset className="study-rectangle-editor" aria-describedby={`${id}-help`}>
    <legend>Enter a rectangle</legend>
    <p id={`${id}-help`}>Use longitude and latitude in decimal degrees (WGS84). Negative longitude is west of Greenwich; negative latitude is south of the equator. Latitude is supported from −85° to 85°.</p>
    <div className="study-coordinate-grid">
      {RECTANGLE_FIELDS.map(field => <div className="study-coordinate-field" key={field}>
        <label htmlFor={`${id}-${field}`}>{labels[field]}</label>
        <input id={`${id}-${field}`} type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={40}
          ref={element => { refs.current[field] = element; }} value={input[field]}
          aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }}
          onChange={event => { setInput(previous => ({ ...previous, [field]: event.target.value })); setErrors({}); }} />
        {errors[field] && <span className="coordinate-error" id={`${id}-${field}-error`}>{errors[field]}</span>}
      </div>)}
    </div>
    <p>Applying replaces the current boundary, including any holes, with this rectangle. The map changes after you apply it.</p>
    <div className="area-actions">
      <button type="button" onClick={apply}>Use this rectangle</button>
      <button type="button" disabled={!dirty && !Object.keys(errors).length} onClick={() => { setInput(initial); setErrors({}); }}>Reset coordinates</button>
    </div>
    <p role="status">{Object.keys(errors).length ? "Rectangle not applied. Correct the marked coordinates." : dirty ? "Coordinates edited. The selected area has not changed." : "Coordinates show the outer bounds of the selected area."}</p>
  </fieldset>;
}
