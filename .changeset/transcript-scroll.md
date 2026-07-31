---
"create-dpas-app": patch
---

Keep the assistant transcript pinned to the newest content, and stop yanking
the reader back when they scroll away.

A turn's answer arrives under several tool cards, and the transcript was
leaving it below the fold beneath a half-clipped card. assistant-ui's
auto-scroll watches the viewport for resize — a box whose height never changes
— so growth reached it only through its MutationObserver, which reads
`scrollHeight` the instant a node is appended, before that card has laid out
(markdown, monospace ids, the Input/Result `<details>`). It scrolled to an
already-stale height and landed short. Its `isAtBottom` flag also only updates
on a narrow set of scroll transitions, so once stale it stayed `true` and every
later growth pulled the reader back down — wheel and trackpad scrolling never
fire `pointerdown`, so its cancel path missed them too.

The generated app now owns this: a ResizeObserver on the content box (the thing
that actually grows, and which fires when layout settles) re-pins only while
the reader is within 120px of the bottom, and "at bottom" is derived from the
live scroll position on every scroll event. The viewport's own auto-scroll
props are off, so nothing competes. A "Jump to latest" pill appears whenever
the newest content is out of view.
