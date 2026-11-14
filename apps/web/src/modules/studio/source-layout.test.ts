import { describe, expect, it } from "vite-plus/test";
import {
  defaultLayout,
  fillLayout,
  fitLayout,
  moveLayout,
  resizeLayout,
  sourceRect,
} from "./source-layout";

const WIDE = 16 / 9;

describe("source layout", () => {
  it("fits the first screen to the frame and keeps later screens from covering it", () => {
    expect(defaultLayout("screen", 0, WIDE, WIDE)).toEqual({ x: 0, y: 0, w: 1 });
    const second = sourceRect(defaultLayout("screen", 1, WIDE, WIDE), WIDE, WIDE);
    const third = sourceRect(defaultLayout("screen", 2, WIDE, WIDE), WIDE, WIDE);
    expect(second.w).toBe(0.5);
    expect(third.x).toBeGreaterThanOrEqual(second.x + second.w);
  });

  it("pillarboxes a tall screen instead of stretching it", () => {
    const layout = defaultLayout("screen", 0, WIDE, 9 / 16);
    const rect = sourceRect(layout, WIDE, 9 / 16);
    expect(rect.h).toBeCloseTo(1);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5);
  });

  it("stacks cameras picture-in-picture bottom right", () => {
    const first = sourceRect(defaultLayout("camera", 0, WIDE, WIDE), WIDE, WIDE);
    const second = sourceRect(defaultLayout("camera", 1, WIDE, WIDE), WIDE, WIDE);
    expect(first.x + first.w).toBeCloseTo(0.98);
    expect(first.y + first.h).toBeLessThan(1);
    expect(second.y + second.h).toBeLessThan(first.y);
  });

  it("moves, snaps to edges and never loses a source off the canvas", () => {
    const start = { x: 0.2, y: 0.2, w: 0.5 };
    const moved = moveLayout(start, 0.1, 0.05, WIDE, WIDE);
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBeCloseTo(0.25);
    expect(moved.w).toBe(0.5);
    expect(moveLayout(start, -0.19, 0, WIDE, WIDE).x).toBe(0);
    expect(moveLayout(start, -0.19, 0, WIDE, WIDE, false).x).toBeCloseTo(0.01);
    const flung = moveLayout(start, 5, 5, WIDE, WIDE);
    expect(flung.x).toBeLessThan(1);
    expect(flung.y).toBeLessThan(1);
  });

  it("resizes from a corner around the opposite corner and keeps the aspect", () => {
    const start = { x: 0.2, y: 0.2, w: 0.4 };
    const grown = resizeLayout(start, "se", { x: 0.8, y: 0.8 }, WIDE, WIDE);
    expect(grown).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.6) as number });
    // A sideways pull still resizes, by half as much as a diagonal one.
    expect(resizeLayout(start, "se", { x: 0.4, y: 0.6 }, WIDE, WIDE).w).toBeCloseTo(0.3);
    const fromTopLeft = resizeLayout(start, "nw", { x: 0.4, y: 0.4 }, WIDE, WIDE);
    const before = sourceRect(start, WIDE, WIDE);
    const after = sourceRect(fromTopLeft, WIDE, WIDE);
    expect(after.x + after.w).toBeCloseTo(before.x + before.w);
    expect(after.y + after.h).toBeCloseTo(before.y + before.h);
    expect(after.w).toBeCloseTo(0.2);
    expect(resizeLayout(start, "se", { x: 0, y: 0 }, WIDE, WIDE).w).toBe(0.05);
  });

  it("fits inside or covers the whole canvas", () => {
    expect(fitLayout(WIDE, 4 / 3).w).toBeCloseTo(0.75);
    const fill = sourceRect(fillLayout(WIDE, 4 / 3), WIDE, 4 / 3);
    expect(fill.w).toBe(1);
    expect(fill.h).toBeGreaterThan(1);
    expect(fill.y + fill.h / 2).toBeCloseTo(0.5);
  });
});
