"use client";
import { Slider as Primitive } from "radix-ui";
export function LabeledSlider({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <Primitive.Root
      data-slot="slider"
      className="labeled-slider"
      min={min}
      max={max}
      step={1}
      value={[value]}
      onValueChange={([next]) => onChange(next)}
    >
      <Primitive.Track className="slider-track" data-slot="slider-track">
        <Primitive.Range className="slider-range" />
      </Primitive.Track>
      <Primitive.Thumb
        className="slider-thumb"
        data-slot="slider-thumb"
        aria-label={label}
      />
    </Primitive.Root>
  );
}
