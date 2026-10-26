import { createStore } from "zustand/vanilla";
import { Time } from "@sidecut/contracts/time";
import type { KeymapOverrides } from "./keyboard";
export const KEYMAP_STORAGE_KEY = "sidecut.keymap.v1";
export const KEYMAP_OVERRIDES_STORAGE_KEY = "sidecut.keymap.overrides.v1";

export interface EditorView {
  playhead: Time;
  playing: boolean;
  playbackRate: number;
  shuttle: (direction: -1 | 0 | 1) => void;
  tool: "select" | "blade" | "ripple" | "roll" | "slip" | "slide";
  linkedSelection: boolean;
  rippleTrims: boolean;
  showTranscript: boolean;
  safeMargins: boolean;
  keymapOverrides: KeymapOverrides;
  requestedDialog:
    | "comment"
    | "cards"
    | "save"
    | "saveVersion"
    | "export"
    | "newProject"
    | "openProject"
    | null;
  useProxies: boolean;
  seekVersion: number;
  zoom: number;
  snapping: boolean;
  setSnapping: (snapping: boolean) => void;
  selected: readonly string[];
  selectMany: (ids: readonly string[]) => void;
  keymap: "premiere" | "minimal";
  setKeymap: (keymap: "premiere" | "minimal") => void;
  range: { from: number; to: number } | null;
  inPoint: number | null;
  outPoint: number | null;
  setIn: (time: number | null) => void;
  setOut: (time: number | null) => void;
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
    playbackRate: 1,
    shuttle: (direction) =>
      set((state) =>
        direction === 0
          ? { playing: false, playbackRate: 1 }
          : {
              playing: true,
              playbackRate:
                state.playing && Math.sign(state.playbackRate) === direction
                  ? direction * Math.min(8, Math.abs(state.playbackRate) * 2)
                  : direction,
            },
      ),
    tool: "select",
    linkedSelection: true,
    rippleTrims: false,
    showTranscript: true,
    safeMargins: false,
    keymapOverrides: {},
    requestedDialog: null,
    useProxies: true,
    seekVersion: 0,
    zoom: 60,
    snapping: true,
    setSnapping: (snapping) => set({ snapping }),
    selected: [],
    selectMany: (selected) => set({ selected }),
    keymap: "premiere",
    setKeymap: (keymap) => set({ keymap }),
    range: null,
    inPoint: null,
    outPoint: null,
    setIn: (time) =>
      set((state) => {
        const to =
          state.outPoint !== null && time !== null && state.outPoint <= time
            ? null
            : state.outPoint;
        return {
          inPoint: time,
          outPoint: to,
          range: time !== null && to !== null ? { from: time, to } : null,
        };
      }),
    setOut: (time) =>
      set((state) => {
        const from =
          state.inPoint !== null && time !== null && state.inPoint >= time ? null : state.inPoint;
        return {
          inPoint: from,
          outPoint: time,
          range: from !== null && time !== null ? { from, to: time } : null,
        };
      }),
    setRange: (range) => set({ range, inPoint: range?.from ?? null, outPoint: range?.to ?? null }),
    format: null,
    setFormat: (format) => set({ format }),
    seek: (playhead) => set((state) => ({ playhead, seekVersion: state.seekVersion + 1 })),
    setPlaying: (playing) => set({ playing, playbackRate: 1 }),
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
        playbackRate: 1,
        selected: [],
        range: null,
        inPoint: null,
        outPoint: null,
        format: null,
        seekVersion: state.seekVersion + 1,
      })),
  }));
}
