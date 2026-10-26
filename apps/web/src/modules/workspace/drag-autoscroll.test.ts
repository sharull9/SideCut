import { expect, it } from "vite-plus/test";
import { edgeScrollVelocity } from "./drag-autoscroll";

it("scrolls toward the nearest visible edge with bounded speed and no center drift", () => {
  expect(edgeScrollVelocity(500, 248, 1000)).toBe(0);
  expect(edgeScrollVelocity(248, 248, 1000)).toBe(-720);
  expect(edgeScrollVelocity(1000, 248, 1000)).toBe(720);
  expect(edgeScrollVelocity(976, 248, 1000)).toBe(360);
  expect(edgeScrollVelocity(272, 248, 1000)).toBe(-360);
  expect(edgeScrollVelocity(2000, 248, 1000)).toBe(720);
  expect(edgeScrollVelocity(-100, 248, 1000)).toBe(-720);
  expect(edgeScrollVelocity(200, 248, 200)).toBe(0);
});
