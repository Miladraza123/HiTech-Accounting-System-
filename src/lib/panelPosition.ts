// Where a dropdown panel goes relative to the button that opened it, in viewport coordinates.
// The panel is drawn on <body> (position: fixed), so a card with overflow hidden around the button
// can never cut it off; this keeps it inside the screen and flips it above the button when there is
// no room below.
export type PanelPlacement = { top: number; left: number };

export function placePanel(
  button: { top: number; bottom: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 12,
  gap = 8
): PanelPlacement {
  // right-aligned to the button, clamped into the screen
  const idealLeft = button.right - panel.width;
  const maxLeft = Math.max(viewport.width - panel.width - margin, margin);
  const left = Math.min(Math.max(idealLeft, margin), maxLeft);

  const below = button.bottom + gap;
  const fitsBelow = below + panel.height + margin <= viewport.height;
  const above = button.top - gap - panel.height;
  const top = fitsBelow || above < margin ? below : above;
  return { top, left };
}
