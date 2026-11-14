"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

type Choice = { value: string; label: string; disabled?: boolean };
const CLEAR = "__earthsignal_clear_selection__";

/** Reuse the scientific explorer's accessible select, including its dark portal. */
export function WorkspaceSelect({
  label,
  value,
  onValueChange,
  options,
  placeholder = "Choose an option…",
  disabled,
  title,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Choice[];
  placeholder?: string;
  disabled?: boolean;
  title?: string;
}) {
  const selected = options.find((option) => option.value === value && value);
  return (
    <Select
      value={selected ? value : ""}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next === CLEAR ? "" : next)}
    >
      <SelectTrigger
        className="workspace-select-trigger"
        aria-label={label}
        title={title}
      >
        <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className="workspace-select-menu"
        position="popper"
        align="start"
        sideOffset={4}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value || CLEAR}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
