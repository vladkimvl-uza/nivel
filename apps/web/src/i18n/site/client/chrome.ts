// The small things of the page that need a script: the line under the header once the page is scrolled, the menu of a phone
// that closes after a click, the blocks that appear as they come into view, the switch «Without animation», the groups of the
// footer that fold on a phone. Everything works without them; they only make it nicer.
import { motionCookie } from "../prefs.ts";
import type { Win } from "./dom.ts";

export function startChrome(win: Win = window): () => void {
  const doc = win.document;
  const cleanups: (() => void)[] = [];
  const reduced = doc.documentElement.classList.contains("is-reduced");
  const small = win.innerWidth < 860 || win.matchMedia("(pointer: coarse)").matches;

  // the line under the header: a marker at the top of the page tells whether the page is scrolled
  const hdr = doc.querySelector<HTMLElement>("[data-hdr]");
  if (hdr && "IntersectionObserver" in win) {
    const marker = doc.createElement("div");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = "position:absolute;top:0;left:0;width:1px;height:9px;pointer-events:none";
    doc.body.insertBefore(marker, doc.body.firstChild);
    const io = new win.IntersectionObserver((entries) => {
      hdr.classList.toggle("is-scrolled", !entries[0]?.isIntersecting);
    });
    io.observe(marker);
    cleanups.push(() => {
      io.disconnect();
      marker.remove();
    });
  }

  // the menu of a phone closes after a click on a link
  const menu = doc.querySelector<HTMLDetailsElement>("[data-menu]");
  if (menu) {
    const close = (e: Event) => {
      if ((e.target as Element).closest("a")) menu.open = false;
    };
    menu.addEventListener("click", close);
    cleanups.push(() => menu.removeEventListener("click", close));
  }

  // blocks that appear when they come into view; a page that wants less motion shows them at once
  const reveal = [...doc.querySelectorAll<HTMLElement>(".rv, .step")];
  if (reduced || !("IntersectionObserver" in win)) {
    for (const el of reveal) el.classList.add("is-in");
  } else {
    const io = new win.IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.2 },
    );
    reveal.forEach((el, i) => {
      if (el.classList.contains("step")) el.style.transitionDelay = `${(i % 6) * 70}ms`;
      io.observe(el);
    });
    cleanups.push(() => io.disconnect());
  }

  // «Without animation»: the choice is a cookie, the server reads it, the page is served static
  const toggle = doc.querySelector<HTMLButtonElement>("[data-motion-toggle]");
  if (toggle) {
    const click = () => {
      doc.cookie = motionCookie(toggle.dataset.off !== "1");
      win.location.reload();
    };
    toggle.addEventListener("click", click);
    toggle.dataset.ready = "1";
    cleanups.push(() => toggle.removeEventListener("click", click));
  }

  // the groups of the footer are folded on a phone
  if (small) for (const d of doc.querySelectorAll<HTMLDetailsElement>(".ftr-d")) d.open = false;

  return () => {
    for (const c of cleanups) c();
  };
}
