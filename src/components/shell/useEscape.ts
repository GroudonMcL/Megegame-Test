"use client";

import { useEffect, useRef } from "react";

// Escape closes the overlay opened most recently (side panel, window…).
// Each open overlay registers itself; one window-level listener calls the top one.
// Escape is left alone while typing in a field or when a modal <dialog> is open
// (the dialog closes itself).

const stack: { current: () => void }[] = [];
let listening = false;

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented || typing(e.target) || document.querySelector("dialog[open]")) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current();
}

/** While `active`, Escape calls onClose (if this is the most recently opened overlay). */
export function useEscape(active: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    if (!listening) {
      window.addEventListener("keydown", onKey);
      listening = true;
    }
    return () => {
      stack.splice(stack.indexOf(entry), 1);
    };
  }, [active]);
}
