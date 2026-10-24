// Phases 106–110. Run in an isolated browser profile at the requested development URL.
import { AssetLibrary, normalizeAsset } from "../../packages/platform-browser/src/asset-library.ts";
import { BrowserAssetProviders } from "../../packages/platform-browser/src/asset-providers.ts";
import { starterAssets } from "../../packages/platform-browser/src/starter.ts";
import { SegmentLibrary } from "../../packages/platform-browser/src/segments.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { BrowserProjectSession } from "../../apps/web/src/modules/workspace/browser-session.ts";
import { encodeProjectFile } from "../../packages/contracts/src/project.ts";
import { decodeAsset } from "../../packages/contracts/src/assets.ts";
import { projectCredits, creditsText } from "../../packages/core/src/asset-use.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { wrapPCM } from "../../packages/assets/src/elevenlabs.ts";
import iconifyFixture from "../fixtures/tandem/providers/iconify_search_rocket.json";
const assert = (v, message) => {
  if (!v) throw new Error(message);
};
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="8" y="8" width="48" height="48" fill="red"/></svg>';
export async function verifyAssetProviders() {
  const library = await AssetLibrary.open(),
    nonce = crypto.randomUUID(),
    controller = new AbortController(),
    requests = [];
  const service = new BrowserAssetProviders(library, {
    mode: "browser",
    hasCredential: async () => false,
    request: async (r) => {
      requests.push({ provider: r.provider, url: r.url, auth: r.auth ?? false });
      return {
        status: 200,
        headers: { "content-type": r.url.includes(".svg") ? "image/svg+xml" : "application/json" },
        bytes: new TextEncoder().encode(
          r.url.includes(".svg") ? svg : JSON.stringify(iconifyFixture),
        ).buffer,
      };
    },
  });
  const infos = await service.list();
  assert(infos.length === 12, "Provider count differs from the reference");
  assert(
    infos.find((p) => p.id === "elevenlabs").status.state === "unsupported",
    "Browser generation must be unavailable",
  );
  assert(infos.find((p) => p.id === "epidemic").status.state === "stub", "Stub status lost");
  const rows = await service.search("iconify", { text: "rocket" }, controller.signal),
    credited = rows.find((a) => a.licenceClass === "creditNeeded");
  assert(credited, "Pinned credited Iconify result is missing");
  const fetched = await service.fetch(credited, controller.signal);
  assert(
    fetched.normalised.type === "image/png" && fetched.licence,
    "Provider normalization or licence snapshot failed",
  );
  assert(fetched.asset.id === credited.id, "Provider identity lost");
  const custom = await normalizeAsset(new File([svg], "user.svg", { type: "image/svg+xml" }), {
    provider: "local",
    providerID: nonce,
    kind: "icon",
    name: "User version",
    licenceClass: "creditNeeded",
    creditLine: "Fixture maker",
  });
  await library.put(custom);
  await library.mergeRemote([
    decodeAsset({ ...custom.asset, name: "Remote overwrite", state: "remote" }),
  ]);
  assert(
    (await library.get(custom.asset.id)).asset.name === "User version",
    "Remote merge overwrote user content",
  );
  const starter = starterAssets();
  await library.mergeRemote(starter);
  await library.mergeRemote(starter);
  assert(
    starter.length === 90 &&
      starter.filter((a) => a.provider === "noto").every((a) => a.licenceClass === "creditNeeded"),
    "Starter count or Noto licence mismatch",
  );
  const folderFile = new File([svg], "camera.svg", { type: "image/svg+xml" });
  Object.defineProperty(folderFile, "webkitRelativePath", { value: "Fixture/Graphics/camera.svg" });
  const note = new File(
    [
      JSON.stringify({
        licenceClass: "creditNeeded",
        credit: "Folder maker",
        licence: "Fixture CC BY",
      }),
    ],
    "tandem-licence.json",
  );
  Object.defineProperty(note, "webkitRelativePath", { value: "Fixture/tandem-licence.json" });
  const folder = await service.importFolder([folderFile, note], "shared", controller.signal);
  assert(
    folder[0].asset.id === "shared:Graphics/camera.svg" &&
      folder[0].asset.creditLine === "Folder maker",
    "Folder licence/identity lost",
  );
  let cancelled = false;
  const aborted = new AbortController();
  aborted.abort();
  try {
    await service.search("iconify", { text: "rocket" }, aborted.signal);
  } catch {
    cancelled = true;
  }
  assert(cancelled, "Cancelled search completed");
  let network = 0;
  const generation = new BrowserAssetProviders(library, {
    mode: "host",
    hasCredential: async () => true,
    request: async () => {
      network++;
      return { status: 200, headers: { "character-cost": "20" }, bytes: new ArrayBuffer(48000) };
    },
  });
  let refused = false;
  try {
    await generation.generate({ prompt: "Fixture click", duration: 0.5 }, false, controller.signal);
  } catch {
    refused = true;
  }
  assert(refused && network === 0, "Unconfirmed generation reached a provider");
  const generated = await generation.generate(
    { prompt: "Fixture click", duration: 0.5, variations: 1 },
    true,
    controller.signal,
  );
  assert(
    generated.entries.length === 1 && generated.entries[0].asset.licenceClass === "aiGenerated",
    "Mock generated take was not retained",
  );
  library.close();
  return {
    providers: infos.map((p) => ({ id: p.id, state: p.status.state })),
    creditedID: credited.id,
    creditLine: credited.creditLine,
    normalizedBytes: fetched.normalised.size,
    starterCount: starter.length,
    folderID: folder[0].asset.id,
    cancelled,
    mockGeneratedID: generated.entries[0].asset.id,
    mockRequests: network,
    requests,
  };
}
export async function verifySavedSegments() {
  const session = new BrowserProjectSession(),
    nonce = crypto.randomUUID();
  await session.start();
  const open = async (name) =>
    session.openProject(
      new File(
        [
          JSON.stringify({
            revision: 0,
            project: {
              id: `${name}-${nonce}`,
              name,
              settings: { width: 128, height: 128, frameRate: { numerator: 10, denominator: 1 } },
              videoTracks: [{ id: "graphics", kind: "video", name: "Graphics" }],
              audioTracks: [{ id: "sfx", kind: "audio", name: "SFX" }],
            },
          }),
        ],
        `${name}.tandem`,
        { type: "application/json" },
      ),
    );
  try {
    await open("Asset source");
    const image = await normalizeAsset(new File([svg], "fixture.svg", { type: "image/svg+xml" }), {
      provider: "local",
      providerID: `image-${nonce}`,
      kind: "icon",
      licenceClass: "creditNeeded",
      creditLine: "Fixture maker",
    });
    const sound = await normalizeAsset(
      new File([wrapPCM(new ArrayBuffer(96000), 1)], "fixture.wav", { type: "audio/wav" }),
      {
        provider: "local",
        providerID: `sound-${nonce}`,
        kind: "sfx",
        licenceClass: "creditNeeded",
        creditLine: "Fixture maker",
      },
    );
    const picture = await session.useLibraryAsset(image),
      audio = await session.useLibraryAsset(sound);
    assert(picture.mediaID && audio.mediaID, "Media placement IDs missing");
    const repeated = await session.useLibraryAsset(image);
    assert(
      repeated.mediaID === picture.mediaID && session.getSnapshot().project.media.length === 2,
      "Repeated asset use duplicated media",
    );
    session.apply({
      label: "Fixture clips",
      expectedRevision: session.getSnapshot().revision,
      commands: [
        {
          insertClip: {
            trackID: "graphics",
            clip: {
              id: "first",
              content: { media: { mediaID: picture.mediaID } },
              start: 0,
              duration: 1,
              linkGroup: "linked",
            },
          },
        },
        {
          insertClip: {
            trackID: "graphics",
            clip: {
              id: "second",
              content: { media: { mediaID: picture.mediaID } },
              start: 1,
              duration: 1,
              linkGroup: "linked",
            },
          },
        },
        {
          insertClip: {
            trackID: "sfx",
            clip: {
              id: "sound",
              content: { media: { mediaID: audio.mediaID } },
              start: 0.9,
              duration: 0.2,
              linkGroup: "linked",
            },
          },
        },
        {
          addTransition: {
            trackID: "graphics",
            transition: {
              id: "dissolve",
              type: "dissolve",
              duration: 0.2,
              fromClipID: "first",
              toClipID: "second",
              soundClipID: "sound",
            },
          },
        },
      ],
    });
    const segment = await session.saveSelectionAsSegment(["first"], `Verification ${nonce}`);
    assert(segment.template.clips.length === 3, "Linked sound or picture left out");
    let duplicate = false;
    try {
      await session.saveSelectionAsSegment(["first"], segment.name);
    } catch {
      duplicate = true;
    }
    assert(duplicate, "Duplicate segment name overwritten");
    const lib = await SegmentLibrary.open(),
      entry = (await lib.list(nonce))[0];
    lib.close();
    assert(
      entry && entry.resources[segment.resources[0].path].file.size > 0,
      "Segment files lost on reopen",
    );
    await open("Asset target");
    const result = await session.insertSavedSegment(entry, 2, "place"),
      state = session.getSnapshot(),
      clips = [...state.project.videoTracks, ...state.project.audioTracks].flatMap((t) => t.clips);
    assert(
      clips.length === 3 && clips.every((c) => !["first", "second", "sound"].includes(c.id)),
      "Inserted IDs or clips invalid",
    );
    assert(state.project.videoTracks[0].transitions.length === 1, "Segment transition lost");
    const credits = projectCredits(state.project);
    assert(
      credits.entries.length === 1 && credits.entries[0].assetIDs.length === 2,
      "Segment credits were not preserved/deduplicated",
    );
    const firstMedia = state.project.media.find((m) => m.kind === "image"),
      resource = await session.resource(firstMedia.id),
      reader = await LocalMediaReader.open(resource.file, "image"),
      canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    await paintPicture(canvas.getContext("2d"), state.project, 2.5, async () => reader);
    reader.close();
    assert(
      canvas.getContext("2d").getImageData(64, 64, 1, 1).data[0] === 255,
      "Inserted resource did not render",
    );
    const before = encodeProjectFile(session.projectFile());
    let conflict = false;
    try {
      await session.insertSavedSegment(entry, 2, "place");
    } catch {
      conflict = true;
    }
    assert(
      conflict && encodeProjectFile(session.projectFile()) === before,
      "Conflicting insert partially changed the project",
    );
    session.undo();
    assert(session.getSnapshot().project.media.length === 0, "Segment insertion was not one undo");
    session.redo();
    assert(session.getSnapshot().project.media.length === 2, "Redo did not restore segment media");
    await session.retrySave();
    const store = await BrowserProjectStore.open(),
      saved = await store.load(session.getSnapshot().project.id);
    store.close();
    assert(
      projectCredits(saved.project).entries[0].line === "Fixture maker",
      "Credit lost on project reopen",
    );
    return {
      segment: segment.name,
      clips: clips.length,
      media: state.project.media.length,
      transitionCount: state.project.videoTracks[0].transitions.length,
      credits: creditsText(credits),
      resourceBytes: resource.file.size,
      revision: result.revision,
      duplicateRejected: duplicate,
      conflictRejected: conflict,
      undoRedo: true,
      sourceProject: saved.project.id,
    };
  } finally {
    await session.close();
  }
}
