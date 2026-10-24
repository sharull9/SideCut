import { it, expect, vi } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { BrowserProjectSession } from "./browser-session";
import { waitService } from "./service-wait";

function setup() {
  const session = new BrowserProjectSession();
  const file = decodeProjectFile({
    revision: 1,
    project: {
      id: "wait",
      media: [
        { id: "m", path: "camera.wav", kind: "audio", role: "camera", hasAudio: true, duration: 2 },
      ],
    },
  });
  vi.spyOn(session, "projectFile").mockReturnValue(file);
  vi.spyOn(session, "getSnapshot").mockReturnValue({ ...session.getSnapshot(), ...file });
  vi.spyOn(session.analysis, "load").mockResolvedValue(undefined);
  return session;
}
it("schedules a missing transcript and reports cached readiness without changing revision", async () => {
  const session = setup();
  vi.spyOn(session.analysis, "transcribe").mockImplementation(async () => {
    vi.spyOn(session.analysis, "transcriptFor").mockReturnValue({
      model: "fixture",
      language: "en",
      words: [],
    });
    return { model: "fixture", language: "en", words: [] };
  });
  expect(
    await waitService(
      session,
      { what: "transcript", media: ["m"], timeout: 1 },
      new AbortController().signal,
    ),
  ).toMatchObject({
    done: true,
    timedOut: false,
    revision: 1,
    finished: [{ state: "ready", words: 0 }],
    pending: [],
  });
  expect(session.analysis.transcribe).toHaveBeenCalledWith("m");
});
it("times out at zero and cancels only the waiter while the actual job continues", async () => {
  const session = setup();
  let complete: (() => void) | undefined;
  vi.spyOn(session.analysis, "transcribe").mockImplementation(() =>
    session.jobs.run(
      "Local transcription:m",
      "transcript",
      1,
      new AbortController().signal,
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ model: "fixture", language: "en", words: [] });
        }),
    ),
  );
  expect(
    await waitService(session, { what: "transcript", timeout: 0 }, new AbortController().signal),
  ).toMatchObject({ done: false, timedOut: true, pending: [{ mediaID: "m", state: "running" }] });
  const controller = new AbortController();
  const waiting = waitService(session, { what: "jobs", timeout: 86400 }, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(session.jobs.getSnapshot()[0]?.status).toBe("running");
  complete?.();
});
it("rejects unknown targets/media and returns failures as finished work", async () => {
  const session = setup();
  vi.spyOn(session.analysis, "transcribe").mockRejectedValue(new Error("Source missing"));
  expect(
    await waitService(session, { what: "transcript", timeout: 1 }, new AbortController().signal),
  ).toMatchObject({ done: true, finished: [{ state: "failed", message: "Source missing" }] });
  await expect(
    waitService(session, { what: "matte", media: ["m"] }, new AbortController().signal),
  ).rejects.toThrow(/Nothing makes/);
  await expect(
    waitService(session, { what: "invalid" }, new AbortController().signal),
  ).rejects.toThrow(/target/);
  await expect(
    waitService(session, { media: ["missing"] }, new AbortController().signal),
  ).rejects.toThrow(/missing/);
});
