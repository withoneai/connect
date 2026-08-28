// Frame management for @withone/connect.
//
// The SDK has exactly one presentation: an authkit-style modal. A
// full-viewport transparent iframe sits over the host page; One's
// connect page renders a scrim + centered card inside it, so the host
// app stays visible and dimmed underneath. Works at every viewport
// size — the card is responsive and the frame is the viewport.
//
// Transport note: every step of the flow rides on the user's One
// session cookie, which is a THIRD-PARTY cookie when the host page is
// on a different site than One. Production embedding therefore relies
// on One serving that cookie as `Partitioned` (CHIPS) and allowing the
// client's domain via frame-ancestors (RFC 6749 §10.13). Same-site
// setups (e.g. localhost dev) work everywhere as-is.

export const IFRAME_ID = "one-connect-frame";

export function createEmbedIframe(url: string): HTMLIFrameElement {
  removeEmbedIframe();
  const iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = url;
  iframe.setAttribute("allowtransparency", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    zIndex: "2147483000",
    background: "transparent",
    colorScheme: "normal", // keep the transparent viewport from being painted
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(iframe);
  return iframe;
}

export function removeEmbedIframe(): void {
  const existing = document.getElementById(IFRAME_ID);
  if (existing) existing.remove();
}

export const SUCCESS_ID = "one-connect-success";

/** The "Access granted" confirmation shown after the grant completes —
 *  the same beat as authkit's "Connection established" screen, and
 *  dismissed the same way: the user closes it with the ✕ or the Close
 *  button, never a timer. By this point the card's iframe has already
 *  navigated home and been removed, so the SDK paints this itself.
 *  Pure inline styles — the SDK ships no CSS and loads no assets. */
export function showSuccessOverlay(theme?: "dark" | "light"): void {
  removeSuccessOverlay();
  const dark = theme === "dark";
  const overlay = document.createElement("div");
  overlay.id = SUCCESS_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(8, 8, 8, 0.5)",
    opacity: "0",
    transition: "opacity 160ms ease",
  } as Partial<CSSStyleDeclaration>);

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "320px",
    maxWidth: "calc(100vw - 32px)",
    padding: "40px 32px",
    borderRadius: "28px",
    background: dark ? "rgba(25, 25, 25, 0.97)" : "rgba(255, 255, 255, 0.97)",
    border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(228,228,223,0.9)"}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  } as Partial<CSSStyleDeclaration>);
  const muted = dark ? "#a1a1aa" : "#6b7280";
  card.style.position = "relative";
  card.innerHTML =
    `<button data-one-close aria-label="Close" style="position:absolute;top:16px;right:16px;width:20px;height:20px;padding:0;border:0;background:none;cursor:pointer;color:${muted};line-height:0;">` +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
    "</button>" +
    '<div style="width:56px;height:56px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;">' +
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' +
    "</div>" +
    `<div style="font-size:17px;font-weight:600;letter-spacing:-0.01em;color:${dark ? "#fafafa" : "#111114"};">Access granted</div>` +
    `<div style="font-size:13px;line-height:1.5;max-width:240px;color:${muted};">Your tools are connected. You can pick up right where you left off.</div>` +
    `<button data-one-close style="width:100%;margin-top:8px;padding:10px 0;border:0;border-radius:12px;cursor:pointer;font-size:14px;font-weight:500;background:${dark ? "#fafafa" : "#111114"};color:${dark ? "#111114" : "#fafafa"};">Close</button>`;

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
  });

  const dismiss = () => {
    window.removeEventListener("keydown", onKeydown);
    overlay.style.opacity = "0";
    window.setTimeout(() => overlay.remove(), 180);
  };
  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") dismiss();
  }

  for (const button of card.querySelectorAll("[data-one-close]")) {
    button.addEventListener("click", dismiss);
  }
  // The card is dismissed deliberately, never on a timer — but this
  // overlay covers the host page at the top of the stacking context, so
  // it must never be able to strand the app. Clicking the scrim outside
  // the card and pressing Escape are both floors under the buttons: if a
  // button ever fails to render or bind, the user is still not trapped.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
  window.addEventListener("keydown", onKeydown);

  // Send focus somewhere sane for keyboard and screen-reader users, who
  // otherwise land on a full-viewport overlay with no reachable control.
  (card.querySelector("[data-one-close]") as HTMLElement | null)?.focus();
}

export function removeSuccessOverlay(): void {
  document.getElementById(SUCCESS_ID)?.remove();
}

export function getEmbedIframe(): HTMLIFrameElement | null {
  return document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
}
