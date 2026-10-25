import { it, expect } from "vite-plus/test";
import { shortcut, ownsKey } from "./keyboard";
import { copyClips, pasteClips } from "./clipboard";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
});
it("routes platform modifiers and suppresses composing/prevented events", () => {
  expect(shortcut(key("z", { ctrlKey: true }), "premiere")).toBe("undo");
  expect(shortcut(key("z", { metaKey: true, shiftKey: true }), "premiere")).toBe("redo");
  expect(shortcut(key("ArrowRight", { isComposing: true }), "premiere")).toBe(null);
  expect(shortcut(key("Delete", { defaultPrevented: true }), "premiere")).toBe(null);
  expect(shortcut(key(" "), "minimal")).toBe(null);
  expect(shortcut(key("i"), "premiere")).toBe("markIn");
});
it("leaves keys to focused tabs, sliders, summaries and buttons", () => {
  const el = (...roles: string[]) =>
    ({ closest: (selector: string) => roles.find((r) => selector.includes(r)) ?? null }) as never;
  const tab = el("[role=tab]", '[role="tab"]'),
    summary = el("summary"),
    body = el();
  expect(ownsKey(tab, "forward")).toBe(true);
  expect(ownsKey(summary, "play")).toBe(true);
  expect(ownsKey(body, "play")).toBe(false);
  expect(ownsKey(body, "forward")).toBe(false);
  expect(ownsKey(null, "play")).toBe(false);
});
it("pastes with new IDs and link groups as one atomic undo step", () => {
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "copy",
      videoTracks: [
        {
          id: "v",
          kind: "video",
          clips: [
            {
              id: "a",
              duration: 1,
              linkGroup: "original",
              content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
            },
          ],
        },
      ],
    },
  });
  const clipboard = copyClips(file.project, ["a"]);
  let n = 0;
  const coordinator = new ProjectCoordinator(file);
  coordinator.apply({ commands: pasteClips(file.project, clipboard, 2, () => `new-${n++}`) });
  expect(coordinator.getSnapshot().project.videoTracks[0]?.clips).toMatchObject([
    { id: "a" },
    { id: "new-1", linkGroup: "new-0" },
  ]);
  coordinator.undo();
  expect(coordinator.getSnapshot().project.videoTracks[0]?.clips).toHaveLength(1);
  expect(() => pasteClips({ ...file.project, id: "other" }, clipboard, 0, () => "new")).toThrow(
    "another project",
  );
});
