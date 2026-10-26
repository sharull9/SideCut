# Editor interaction adapters: group 134

The existing desktop editor now has individual runtime acceptance for all twelve group 134 interactions. The implementation remains a portable subset of the pinned native editor, not full keymap or native gesture parity.

The [later follow-up](continuation-2026-10-25-followup.md) adds marker navigation,
select-forward, mark-clip, link/unlink and fit shortcuts. Edit-point navigation
respects targeted tracks. Chromium and Firefox also verify that read-only tabs
can navigate and select with the keyboard while Delete remains blocked.

Reference: `735a9b8e162c1f951044baa892d94993869f2e77`, particularly `Keymap/KeyboardRouter.swift`, `Resources/Keymaps/premiere.json`, `Timeline/Model/DragPlanner.swift`, `Marquee.swift`, `Selection.swift` and `Timeline/View/TimelineScrollerView.swift`.

The clip context menu uses the project's existing Base UI primitives and semantic colors. Right-click or Shift+F10 opens it. Copy, paste, split, link, unlink, lift and ripple-delete share the same actions as the toolbar and keyboard. Opening it selects the clicked clip and linked partners; Escape restores focus to the clip body. Editing keys are protected inside the menu. Locked, busy and read-only states disable mutations.

Copy/paste preserves relative positions and remaps clip IDs and link groups. Pasted clips become the selection after the one atomic edit completes. Errors from asynchronous paste and nudge operations reach the existing error notice. The clipboard belongs to the current project; clips with transitions require saved segments.

Marquee selection covers the active track and linked partners. Shift-drag sets the timeline range. Escape, pointer cancellation, lost capture and window blur restore the selection and range from the start of a marquee. Clip gestures cancel without applying on Escape, lost capture or blur. Autoscroll uses animation frames and elapsed time, so it continues with a stationary pointer beside an edge and stops after cancellation, release or unmount. Track headers remain outside the horizontal scrolling target.

Moving clips snap their start or end to other clips, markers and the playhead within six screen pixels. Shift temporarily bypasses snapping for move gestures; Ctrl/Cmd retains the existing bypass alias. Shift-dragging a trim handle still means ripple trim. Keyboard comma/period moves one frame, Shift-comma/period moves five, and focused trim handles use arrows or Shift-arrows for one/five-frame edits. Fractional frame rates continue to use the shared time model.

`tests/desktop/verify-editor-interactions.mjs` uses real Electron keyboard, pointer and wheel events. [Runtime evidence](editor-interactions-runtime.json) records:

- Switching between Premiere subset and editing-only maps, with input focus protected.
- Persisting the chosen map across renderer reload.
- Previous/next edit navigation at concrete boundaries.
- Linked multi-track copy/paste, new IDs, new link groups, pasted selection and one-step undo.
- Pointer and keyboard menu opening, copy/lift actions, Escape focus restoration and protection from Delete while inside the menu.
- Marquee overlap/linked selection and cancellation restoring both selection and range.
- Default snapping, Ctrl and Shift bypass, and canceled clip drags preserving the project.
- Keyboard/button snapping toggles and unmodified unsnapped drags.
- Horizontal wheel scrolling, keyboard zoom, modifier-wheel zoom and input focus protection.
- Stationary-pointer autoscroll, followed by Escape stopping further movement without an edit.
- One/five-frame moves, five-frame trim and locked-track rejection.
- Q/W playhead ripple trims, boundary no-ops and one-step undo.
- Slip gestures with direction and source offset scaled for two-times speed.

The open menu passes the WCAG 2 A/AA and WCAG 2.1 AA automated checks (zero violations, fourteen checks passed). The rendered menu was visually inspected in the existing dark editor. The Impeccable detector reports no findings for changed UI targets. Unit tests cover edge-scroll velocity, snapping distance, end-edge/marker targets, excluded clips and shifted punctuation keys.

Run after `vp run build:desktop`, with the web dev server at `127.0.0.1:4270`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-editor-interactions.mjs
```

The earlier `verify-agent-ui.mjs` acceptance covers shortcut dispatch/input focus, I/O and pointer range selection, and keyboard track resizing (134.01, 134.05 and 134.08). The new runtime covers the remaining nine subphases. Evidence is Windows development Electron. Native user keymap files, all upstream shortcuts/menus, cross-project clipboard, cross-track marquee rectangles, native macOS/Linux gestures, screen-reader sessions and touch editing remain outside this acceptance.
