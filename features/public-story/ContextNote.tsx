"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";
import "./context-note.css";

/** Supporting prose only. Primary controls and evidence identity stay outside. */
export function ContextNote({ label, children, iconOnly = false }: {
  label: string; children?: ReactNode; iconOnly?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  return <div className={`es-context-note${iconOnly ? " es-context-note-icon" : ""}`}>
    <button ref={trigger} type="button" className="es-context-trigger" aria-label={label}
      aria-haspopup="dialog" aria-controls={id} aria-expanded={open} title={iconOnly ? label : undefined}
      onClick={() => {
        if (!dialog.current || dialog.current.open) return;
        dialog.current.showModal(); setOpen(true);
        title.current?.focus({ preventScroll: true });
      }}>
      <CircleHelp size={19} aria-hidden="true" /><span>{label}</span>
    </button>
    <dialog ref={dialog} id={id} className="es-context-dialog" aria-labelledby={`${id}-title`}
      onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="es-context-sheet">
        <header><h2 ref={title} id={`${id}-title`} tabIndex={-1}>{label}</h2>
          <button type="button" className="es-context-close" onClick={close} aria-label={`Close ${label}`}><X size={20} aria-hidden="true" /></button></header>
        <div className="es-context-body">{children}</div>
      </div>
    </dialog>
  </div>;
}
