"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const WIDTH_KEY = "mederti-chat-width";
const DEFAULT_W = 380;
const MIN_W = 300;
const MAX_W = 720;
const STEP = 16;

const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));

/**
 * The middle chat column of the 3-column {@link AppShell}, with a draggable
 * divider on its right edge. Drag (or focus the divider and use ←/→) to resize;
 * double-click resets to the default. The chosen width is remembered per browser
 * in localStorage, like V1Sidebar's collapsed state. CSS also caps the column so
 * the content column keeps a usable width on narrower screens (app-shell.css).
 */
export default function ChatColumn({ className, children }: { className: string; children: ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_W);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a client-only preference
      if (saved) setWidth(clamp(saved));
    } catch {}
  }, []);

  // Saved only on user changes (drag end, keys, reset) — never from an effect,
  // which would run before the restore above lands and overwrite it.
  function save(w: number) {
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {}
  }

  function resize(next: (w: number) => number) {
    setWidth((w) => {
      const n = clamp(next(w));
      save(n);
      return n;
    });
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setWidth(clamp(drag.current.w + e.clientX - drag.current.x));
  }

  function endDrag() {
    if (drag.current) save(width);
    drag.current = null;
    setDragging(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") resize((w) => w - STEP);
    else if (e.key === "ArrowRight") resize((w) => w + STEP);
    else if (e.key === "Home") resize(() => MIN_W);
    else if (e.key === "End") resize(() => MAX_W);
    else return;
    e.preventDefault();
  }

  return (
    <aside className={`${className}${dragging ? " chat-col--dragging" : ""}`} style={{ ["--chat-w" as string]: `${width}px` }}>
      {children}
      <div
        className="chat-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat column"
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => resize(() => DEFAULT_W)}
        onKeyDown={onKeyDown}
      />
    </aside>
  );
}
