// "Esc twice returns to the mode selector".
//
// Escape is already the cancel key for the search overlay, info popovers and
// the collection autocomplete, so a single press must not also eject the user
// from their mode.

export const ESC_WINDOW_MS = 1200

/**
 * What a keydown means for the gesture: 'ignore', 'arm' (first press — wait for
 * a second) or 'leave' (second press within the window — go to the menu).
 *
 * `armed` is whether a first press is still live.  Everything else describes
 * what is on screen: the gesture stays out of the way while the splash or the
 * search overlay is up, while typing, and on the menu itself.
 */
export function escapeAction(key, { mode, showSplash, searchOpen, typing, armed }) {
  if (key !== 'Escape') return 'ignore'
  if (!mode || showSplash || searchOpen || typing) return 'ignore'
  return armed ? 'leave' : 'arm'
}

export const ESC_HINT = 'Press Esc again to return to the menu'
