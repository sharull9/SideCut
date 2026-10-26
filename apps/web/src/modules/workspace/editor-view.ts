import { createStore } from "zustand/vanilla";
import { Time } from "@sidecut/contracts/time";
export const KEYMAP_STORAGE_KEY = "sidecut.keymap.v1";

export interface EditorView {
  playhead: Time;
  playing: boolean;
  seekVersion: number;
  zoom: number;
  snapping: boolean;
  setSnapping: (snapping: boolean) => void;
  selected: readonly string[];
  selectMany: (ids: readonly string[]) => void;
  keymap: "premiere" | "minimal";
  setKeymap: (keymap: "premiere" | "minimal") => void;
  range: { from: number; to: number } | null;
  setRange: (range: { from: number; to: number } | null) => void;
  /** The alternate output format the viewer shows, or null for the main canvas. */
  format: string | null;
  setFormat: (format: string | null) => void;
  seek: (time: Time) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  select: (id: string | null, additive?: boolean) => void;
  reset: () => void;
}
export function createEditorView() {
  return createStore<EditorView>()((set) => ({
    playhead: new Time(0n),
    playing: false,
    seekVersion: 0,
    zoom: 60,
    snapping: true,
    setSnapping: (snapping) => set({ snapping }),
    selected: [],
    selectMany: (selected) => set({ selected }),
    keymap: "premiere",
    setKeymap: (keymap) => set({ keymap }),
    range: null,
    setRange: (range) => set({ range }),
    format: null,
    setFormat: (format) => set({ format }),
    seek: (playhead) => set((state) => ({ playhead, seekVersion: state.seekVersion + 1 })),
    setPlaying: (playing) => set({ playing }),
    setZoom: (zoom) => set({ zoom: Math.max(2, Math.min(600, zoom)) }),
    select: (id, additive = false) =>
      set((state) => ({
        selected:
          id === null
            ? []
            : additive
              ? state.selected.includes(id)
                ? state.selected.filter((value) => value !== id)
                : [...state.selected, id]
              : [id],
      })),
    reset: () =>
      set((state) => ({
        playhead: new Time(0n),
        playing: false,
        selected: [],
        range: null,
        format: null,
        seekVersion: state.seekVersion + 1,
      })),
  }));
}
