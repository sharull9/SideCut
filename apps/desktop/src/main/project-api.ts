import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeProjectFile } from "@sidecut/contracts/project";
import {
  queryRequest,
  queryClips,
  queryTimeline,
  QueryError,
  clipMediaID,
} from "@sidecut/core/project-queries";
import { validateProject } from "@sidecut/core/validation";
import type { HostProjectService } from "./project-service.ts";
import { scanFolder, mediaRole } from "./folder-scanner.ts";
import type { NativeMedia } from "./native-media.ts";
import { serviceRequest, serviceFields } from "@sidecut/core/service-requests";
import { clipChanges, editOutcome, revisionFile, restorePlan } from "@sidecut/core/service-edits";
import { ProjectCoordinator, EditError, type JournalEntry } from "@sidecut/core/coordinator";
import { helperPlan } from "@sidecut/core/service-speech";
import { serviceOutput } from "./service-output.ts";
import { encodeProjectFile } from "@sidecut/contracts/project";
import { safeArchivePath } from "@sidecut/core/archive";
import { reviewQuery } from "@sidecut/core/service-review";
import { effectRegistry, renderedEffects } from "@sidecut/core/effects";
import { importEDL, importFilmora, object } from "@sidecut/core/interchange";
type RendererOperations = {
  ready?: () => boolean;
  run: (operation: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  screenshot: () => Promise<Uint8Array>;
};

export class ProjectAPI {
  private mediaRoot: string | null = null;
  constructor(
    readonly project: HostProjectService,
    private readonly native?: Pick<NativeMedia, "run">,
    private readonly renderer?: RendererOperations,
  ) {}
  setMediaRoot(root: string | null) {
    this.mediaRoot = root;
  }
  private file() {
    return decodeProjectFile(JSON.parse(this.project.snapshot().json));
  }
  private apply(
    input: Record<string, unknown>,
    file = this.file(),
    generation = this.project.snapshot().generation,
  ) {
    const before = file;
    const { dryRun, ...batch } = input;
    const request = {
      label: "Agent edit",
      author: "agent",
      ...batch,
      expectedRevision: input.expectedRevision ?? before.revision,
    };
    if (dryRun === true) {
      const copy = new ProjectCoordinator(before),
        result = copy.apply(request);
      return editOutcome(before, copy.projectFile(), result, true);
    }
    const reply = this.project.request(
      JSON.stringify({ type: "apply", projectID: before.project.id, generation, batch: request }),
    );
    return editOutcome(
      before,
      this.file(),
      reply.result!,
      false,
      reply.result!.revision <= before.revision,
    );
  }
  private async edit(operation: string, request: Record<string, unknown>) {
    const file = this.file(),
      snapshot = this.project.snapshot();
    if (request.expectedRevision != null && request.expectedRevision !== file.revision)
      throw new EditError(
        "stale-revision",
        `Stale revision: expected ${request.expectedRevision}, actual ${file.revision}.`,
      );
    if (operation === "apply") return this.apply(request, file, snapshot.generation);
    const entries = (file.sidecutJournal as { entries: JournalEntry[] } | undefined)?.entries ?? [];
    if (operation === "history") {
      const limit = Number(request.limit ?? 20);
      if (limit < 1 || limit > 1000)
        throw new QueryError("badRequest", "History limit must be 1-1000.");
      return {
        revision: file.revision,
        ...this.project.history(limit),
        events: [],
        edits: entries
          .slice(-limit)
          .reverse()
          .map((e) => ({
            revision: e.result.revision,
            kind: e.kind,
            label: e.result.label,
            author: e.result.author,
            ...(e.date ? { date: e.date } : {}),
          })),
      };
    }
    if (operation === "undo" || operation === "redo") {
      const count = Number(request.count ?? 1);
      if (count < 1 || count > 500)
        throw new QueryError("badRequest", "History count must be 1-500.");
      const labels: string[] = [],
        authors: string[] = [];
      for (let i = 0; i < count; i++) {
        const current = this.project.snapshot();
        if (!(operation === "undo" ? current.undoLabel : current.redoLabel)) break;
        const result = this.project.request(
          JSON.stringify({
            type: operation,
            projectID: file.project.id,
            generation: snapshot.generation,
            revision: this.file().revision,
          }),
        ).result!;
        labels.push(result.label.replace(/^(Undo|Redo) /, ""));
        authors.push(result.author);
      }
      if (!labels.length)
        throw new QueryError(
          operation === "undo" ? "nothingToUndo" : "nothingToRedo",
          `Nothing to ${operation}.`,
          file.revision,
        );
      return {
        action: operation,
        revision: this.file().revision,
        label: labels.at(-1),
        author: authors.at(-1),
        count: labels.length,
        labels,
        authors,
      };
    }
    const reference = String(request.since ?? request.from);
    const source = await this.baseline(reference, file);
    if (source.project.id !== file.project.id)
      throw new QueryError("badRequest", "The baseline belongs to a different project.");
    if (operation === "diff")
      return {
        revision: file.revision,
        since: `revision ${source.revision}`,
        sinceRevision: source.revision,
        changes: clipChanges(source, file),
      };
    const plan = restorePlan(file, source, request);
    if (request.apply === true && plan.commands.length) {
      if (plan.problem) throw new QueryError("badRequest", plan.problem);
      return {
        ...plan,
        applied: this.apply(
          {
            commands: plan.commands,
            label: request.label ?? `Restore from revision ${source.revision}`,
            author: request.author ?? "agent",
            expectedRevision: request.expectedRevision ?? file.revision,
          },
          file,
          snapshot.generation,
        ),
      };
    }
    return plan;
  }
  private async baseline(reference: string, file: ReturnType<ProjectAPI["file"]>) {
    if (reference === "reviewed")
      throw new QueryError(
        "notImplemented",
        "Reviewed baselines require the review service from phase 126.",
      );
    if (/^\d+$/.test(reference)) return revisionFile(file, Number(reference));
    const name = safeArchivePath(
      reference.match(/\.(mp4|webm|m4a|wav)$/i) ? reference + ".tandem" : reference,
    );
    const root = await realpath(dirname(this.project.store.path)),
      path = await realpath(resolve(root, name)),
      within = relative(root, path);
    if (within.startsWith("..") || isAbsolute(within) || (await stat(path)).size > 20 * 1024 * 1024)
      throw new QueryError("badRequest", "Unsafe or oversized baseline project.");
    return decodeProjectFile(JSON.parse(await readFile(path, "utf8")));
  }
  private async rendererOperation(
    operation: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const file = this.file(),
      snapshot = this.project.snapshot();
    if (request.output != null)
      this.outputName(
        request,
        ["frame", "frames", "screenshot"].includes(operation)
          ? "png"
          : request.audioOnly === true
            ? "m4a"
            : "mp4",
      );
    if (request.expectedRevision != null && request.expectedRevision !== file.revision)
      throw new EditError("stale-revision", "Stale project revision.");
    if (["join", "short", "cards", "tighten", "captions"].includes(operation)) {
      const plan = ["join", "short", "cards"].includes(operation)
        ? helperPlan(file, operation, request, () => undefined)
        : await this.renderer?.run(operation, request, signal);
      if (!plan) throw new QueryError("unavailable", "This helper requires an attached editor.");
      const result = plan as {
        commands: unknown[];
        label: string;
        warnings: string[];
        locked?: string;
      };
      if (operation === "short" && (request.copy === true || request.copyPath != null)) {
        if (request.apply !== true)
          return {
            ...result,
            copy: String(request.copyPath ?? `${file.project.name} Short.tandem`),
          };
        const copyFile = decodeProjectFile({
            revision: 0,
            project: { ...JSON.parse(encodeProjectFile(file)).project, id: `prj_${randomUUID()}` },
          }),
          copy = new ProjectCoordinator(copyFile);
        copy.apply({
          commands: [...result.commands, { adoptFormat: { format: "portrait" } }],
          label: request.label ?? result.label,
          author: request.author ?? "agent",
        });
        const path = await serviceOutput(
          this.project.store.path,
          String(
            request.copyPath ?? `${file.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")} Short.tandem`,
          ),
          new TextEncoder().encode(encodeProjectFile(copy.projectFile())),
          signal,
        );
        return { ...result, copy: path };
      }
      if (request.apply === true && result.commands.length) {
        if (result.locked) throw new QueryError("badRequest", result.locked);
        return {
          ...result,
          applied: this.apply(
            {
              commands: result.commands,
              label: request.label ?? result.label,
              author: request.author ?? "agent",
              expectedRevision: request.expectedRevision ?? file.revision,
            },
            file,
            snapshot.generation,
          ),
        };
      }
      return result;
    }
    if (operation === "screenshot") {
      if (!this.renderer)
        throw new QueryError("unavailable", "No editor is available for capture.");
      const bytes = await this.renderer.screenshot();
      signal.throwIfAborted();
      return request.output
        ? {
            path: await serviceOutput(
              this.project.store.path,
              this.outputName(request, "png"),
              bytes,
              signal,
            ),
            bytes: bytes.length,
            warnings: [],
          }
        : { png: Buffer.from(bytes).toString("base64"), bytes: bytes.length, warnings: [] };
    }
    if (!this.renderer || this.renderer.ready?.() === false)
      throw new QueryError("unavailable", `${operation} requires an attached editor renderer.`);
    let applied;
    if (operation === "transcribe") {
      const refs = request.media as string[],
        ids = refs.map(
          (ref) =>
            file.project.media.find(
              (m) => m.id === ref || m.path === ref || m.path.split(/[\\/]/).at(-1) === ref,
            )?.id ??
            [...file.project.videoTracks, ...file.project.audioTracks]
              .flatMap((t) => t.clips)
              .filter((c) => c.id === ref)
              .map(clipMediaID)[0],
        );
      if (ids.some((id) => !id) || !ids.length)
        throw new QueryError("notFound", "A transcription source was not found.");
      if (ids.some((id) => !file.project.media.find((m) => m.id === id)?.hasAudio))
        throw new QueryError("badRequest", "Transcription requires audio media.");
      const commands = [...new Set(ids)]
        .filter((id) => file.project.media.find((m) => m.id === id)?.transcribe !== true)
        .map((mediaID) => ({ updateMedia: { mediaID, patch: { transcribe: true } } }));
      if (commands.length)
        applied = this.apply(
          { commands, label: request.label ?? "Transcribe media", author: "agent" },
          file,
          snapshot.generation,
        );
    }
    if (request.output != null)
      this.outputName(
        request,
        ["frame", "frames"].includes(operation)
          ? "png"
          : request.audioOnly === true
            ? "m4a"
            : "mp4",
      );
    const result = (await this.renderer.run(operation, request, signal)) as Record<string, unknown>;
    signal.throwIfAborted();
    if (operation === "transcribe") return { ...result, ...(applied ? { applied } : {}) };
    if (operation === "loudness" || ["transcript", "search", "pauses"].includes(operation))
      return result;
    if (["frame", "frames"].includes(operation)) {
      if (!request.output) return result;
      const { png, ...metadata } = result,
        bytes = Buffer.from(String(png), "base64");
      return {
        ...metadata,
        path: await serviceOutput(
          this.project.store.path,
          this.outputName(request, "png"),
          bytes,
          signal,
        ),
      };
    }
    const { data, container, ...metadata } = result;
    let bytes = new Uint8Array(Buffer.from(String(data), "base64"));
    const name = this.outputName(
        request,
        request.audioOnly === true ? "m4a" : request.preset === "webm" ? "webm" : "mp4",
      ),
      extension = extname(name);
    if (
      (extension !== ".webm" || container === "wav") &&
      !(extension === ".wav" && container === "wav")
    ) {
      if (!this.native) throw new QueryError("unavailable", "Native codec service is unavailable.");
      bytes = new Uint8Array(
        await this.native.run(
          extension === ".wav"
            ? "decode"
            : extension === ".m4a"
              ? "aac"
              : extension === ".webm"
                ? "export"
                : "mp4",
          bytes,
          signal,
          () => {},
          0,
          Number(metadata.duration),
        ),
      );
    }
    signal.throwIfAborted();
    const path = await serviceOutput(this.project.store.path, name, bytes, signal);
    try {
      await serviceOutput(
        this.project.store.path,
        name + ".tandem",
        new TextEncoder().encode(encodeProjectFile(file)),
        signal,
      );
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
    return {
      ...metadata,
      path,
      codec:
        extension === ".mp4"
          ? "h264"
          : extension === ".webm"
            ? request.audioOnly === true
              ? "opus"
              : "vp8"
            : extension === ".wav"
              ? "pcm_s16le"
              : "aac",
      bytes: bytes.length,
    };
  }
  private outputName(request: Record<string, unknown>, extension: string) {
    const name = String(request.output ?? `exports/${randomUUID()}.${extension}`);
    safeArchivePath(name);
    if (
      !(
        extension === "png"
          ? [".png"]
          : extension === "m4a"
            ? [".m4a", ".wav", ".webm"]
            : [".mp4", ".webm"]
      ).includes(extname(name))
    )
      throw new QueryError("badRequest", "Unsupported output extension.");
    const filename = name.startsWith("exports/") ? name.slice(8) : name;
    if (filename.includes("/"))
      throw new QueryError("badRequest", "Output must be a filename in exports.");
    return name;
  }
  private async source(path: string) {
    const root = await realpath(this.mediaRoot ?? dirname(this.project.store.path));
    const absolute = await realpath(resolve(root, path));
    const within = relative(root, absolute);
    if (within.startsWith("..") || isAbsolute(within))
      throw new QueryError("badRequest", "Source escapes the selected media folder.");
    return absolute;
  }
  async handle(
    operation: string,
    input: unknown,
    signal: AbortSignal = new AbortController().signal,
  ) {
    if (operation === "schema") {
      if (!input || typeof input !== "object" || Object.keys(input).length)
        throw new QueryError("badRequest", "Schema takes no fields.");
      return {
        apiVersion: "0.1.0",
        operations: {
          status: {},
          media: { refresh: "boolean" },
          clips: { track: "string", media: "string", from: "time", to: "time", ids: "boolean" },
          timeline: { from: "time", to: "time", format: "string" },
          ...serviceFields,
        },
      };
    }
    if (Object.hasOwn(serviceFields, operation)) {
      const request = serviceRequest(operation, input);
      if (["new", "open", "import-edl", "import-filmora"].includes(operation)) {
        const before = this.project.snapshot();
        if (request.expectedRevision == null)
          throw new QueryError(
            "badRequest",
            "Replacing the active project requires expectedRevision. The current project is saved before replacement.",
          );
        let next;
        if (operation === "new")
          next = decodeProjectFile({
            revision: 0,
            project: { id: `prj_${randomUUID()}`, name: request.name ?? "Untitled sequence" },
          });
        else {
          if (typeof request.path !== "string")
            throw new QueryError("badRequest", "A source path is required.");
          const path = await this.source(request.path);
          if ((await stat(path)).size > 20 * 1024 * 1024)
            throw new QueryError("badRequest", "Project import exceeds 20 MiB.");
          const bytes = await readFile(path);
          if (operation === "open") next = decodeProjectFile(JSON.parse(bytes.toString("utf8")));
          else if (operation === "import-filmora") next = importFilmora(bytes).file;
          else {
            const parsed = object(JSON.parse(bytes.toString("utf8")));
            next = importEDL(parsed.edl, parsed.recipe).file;
          }
        }
        signal.throwIfAborted();
        await this.project.replace(encodeProjectFile(next), false, {
          generation: before.generation,
          revision: Number(request.expectedRevision),
        });
        this.mediaRoot = null;
        return {
          revision: this.file().revision,
          projectID: this.file().project.id,
          name: this.file().project.name,
        };
      }
      if (["validate", "check", "comments"].includes(operation))
        return reviewQuery(this.file(), operation, request);
      if (operation === "effects") {
        const effects = effectRegistry.filter(
          (e) =>
            request.type == null || e.type.toLowerCase() === String(request.type).toLowerCase(),
        );
        if (!effects.length) throw new QueryError("notFound", "Unknown effect type.");
        return {
          effects: effects.map((e) => ({ ...e, rendered: renderedEffects.has(e.type) })),
          warnings: ["Effects without a renderer are retained but cannot be rendered."],
        };
      }
      if (operation === "watch") return this.watch(request, signal);
      if (operation === "sync") {
        if (request.files != null || request.makeDefault === true)
          throw new QueryError(
            "notImplemented",
            "Sound matching and default recorder delay are not exposed by the service yet.",
          );
        const file = this.file(),
          refs = request.media as string[] | undefined;
        const items = file.project.media.filter(
          (m) =>
            m.hasVideo &&
            (!refs ? m.role === "camera" : refs.includes(m.id) || refs.includes(m.path)),
        );
        if (refs?.some((ref) => !items.some((m) => m.id === ref || m.path === ref)))
          throw new QueryError("notFound", "A requested video source was not found.");
        const applied =
          request.delay == null || !items.length
            ? undefined
            : this.apply({
                expectedRevision: request.expectedRevision,
                dryRun: request.dryRun,
                label: request.label ?? "Set picture delay",
                commands: items.map((m) => ({
                  updateMedia: { mediaID: m.id, patch: { pictureDelay: request.delay } },
                })),
              });
        return {
          revision: this.file().revision,
          files: this.file()
            .project.media.filter((m) => m.hasVideo)
            .map((m) => ({
              id: m.id,
              path: m.path,
              role: m.role,
              pictureDelay: m.pictureDelay?.seconds,
              pictureDelayCorrected: m.pictureDelayCorrected?.seconds,
            })),
          defaultDelay: 0,
          ...(applied ? { applied } : {}),
          warnings: ["Recorder default settings and sound matching are not included."],
        };
      }
      if (operation === "archive") {
        if (!this.renderer)
          throw new QueryError("unavailable", "A ready editor is required for archive resources.");
        const result = await this.renderer.run(operation, request, signal);
        if (
          !result ||
          typeof result !== "object" ||
          !("data" in result) ||
          typeof result.data !== "string" ||
          result.data.length > 358 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data)
        )
          throw new QueryError("unavailable", "Invalid archive payload.");
        signal.throwIfAborted();
        const output = await serviceOutput(
          this.project.store.path,
          String(request.output ?? "project.sidecut"),
          Buffer.from(result.data, "base64"),
          signal,
        );
        return {
          revision: this.file().revision,
          output,
          format: "sidecut",
          warnings: [
            "ZIP archive of project resources; upstream standalone-folder archive and analysis caches are not supported.",
          ],
        };
      }
      if (operation === "relink") {
        if (!this.renderer)
          throw new QueryError("unavailable", "A ready editor is required for relink.");
        if (typeof request.path !== "string" || typeof request.mediaID !== "string")
          throw new QueryError(
            "badRequest",
            "Relink requires mediaID and a source path beneath the selected folder.",
          );
        const path = await this.source(request.path);
        if ((await stat(path)).size > 64 * 1024 * 1024)
          throw new QueryError("badRequest", "Relink source exceeds 64 MiB.");
        const bytes = await readFile(path);
        return this.renderer.run(
          operation,
          { mediaID: request.mediaID, name: path.split(/[\\/]/).at(-1), bytes: Array.from(bytes) },
          signal,
        );
      }
      if (
        operation.startsWith("assets-") ||
        ["segments", "save-segment", "insert-segment", "wait"].includes(operation)
      ) {
        if (!this.renderer)
          throw new QueryError(
            "unavailable",
            "A ready editor is required for library and job operations.",
          );
        return this.renderer.run(operation, request, signal);
      }
      if (["apply", "undo", "redo", "history", "diff", "restore"].includes(operation))
        return this.edit(operation, request);
      return this.rendererOperation(operation, request, signal);
    }
    const { request } = queryRequest(operation, input);
    if (operation === "media") {
      const added: string[] = [];
      if (request.refresh === true) {
        if (!this.mediaRoot || !this.native)
          throw new QueryError(
            "unavailable",
            "Select a watched media folder in the editor before refreshing.",
          );
        const before = this.project.snapshot(),
          file = this.file();
        const scanned = await scanFolder(this.mediaRoot),
          commands: unknown[] = [];
        for (const [path] of scanned) {
          signal.throwIfAborted();
          if (file.project.media.some((m) => m.path === path)) continue;
          const absolute = await this.source(path);
          if ((await stat(absolute)).size > 256 * 1024 * 1024)
            throw new QueryError("badRequest", "Source exceeds the native import limit.");
          const bytes = new Uint8Array(await readFile(absolute));
          const probe = JSON.parse(
            new TextDecoder().decode(await this.native.run("probe", bytes, signal, () => {})),
          ) as {
            format?: { duration?: string };
            streams?: { codec_type?: string; width?: number; height?: number }[];
          };
          const video = probe.streams?.find((s) => s.codec_type === "video"),
            audio = probe.streams?.some((s) => s.codec_type === "audio");
          const duration = Number(probe.format?.duration),
            image = /\.(png|jpe?g|webp|gif|avif|bmp|heic|svg)$/i.test(extname(path)),
            id = `med_${randomUUID()}`;
          commands.push({
            addMedia: {
              item: {
                id,
                path,
                kind: image ? "image" : video ? "video" : "audio",
                role: mediaRole(path, Number.isFinite(duration) ? duration : undefined),
                hasVideo: Boolean(video),
                hasAudio: Boolean(audio),
                ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
                ...(video?.width ? { width: video.width, height: video.height } : {}),
              },
            },
          });
          added.push(id);
        }
        signal.throwIfAborted();
        if (commands.length)
          this.project.request(
            JSON.stringify({
              type: "apply",
              projectID: file.project.id,
              generation: before.generation,
              batch: {
                label: "Refresh media",
                author: "agent",
                expectedRevision: file.revision,
                commands,
              },
            }),
          );
      }
      const file = this.file();
      const items = await Promise.all(
        file.project.media.map(async (m) => {
          let exists = false;
          try {
            exists = (await stat(await this.source(m.path))).isFile();
          } catch {
            /* Missing and out-of-root sources stay references. */
          }
          const analysis: Record<string, { state: string }> = {};
          for (const kind of [
            ...(m.hasVideo || m.kind === "image" ? ["thumbnails"] : []),
            ...(m.kind === "video" && m.hasVideo ? ["proxy"] : []),
            ...(m.hasAudio ? ["waveform", "loudness", "transcript"] : []),
            ...(m.role === "camera"
              ? [...(m.hasVideo ? ["matte"] : []), ...(m.hasAudio ? ["isolatedVoice"] : [])]
              : []),
          ])
            analysis[kind] = { state: "none" };
          const {
            id,
            path,
            kind,
            role,
            duration,
            width,
            height,
            hasVideo,
            hasAudio,
            undecodableCodec,
            livePhotoVideo,
            takeID,
            takeOffset,
            pictureDelay,
            pictureDelayCorrected,
          } = m;
          return {
            id,
            path,
            kind,
            role,
            duration,
            width,
            height,
            hasVideo,
            hasAudio,
            undecodableCodec,
            livePhotoVideo,
            takeID,
            takeOffset,
            pictureDelay,
            pictureDelayCorrected,
            frameRate: m.frameRate ? m.frameRate.numerator / m.frameRate.denominator : undefined,
            clips: [...file.project.videoTracks, ...file.project.audioTracks]
              .flatMap((t) => t.clips)
              .filter((c) => clipMediaID(c) === m.id).length,
            exists,
            analysis,
          };
        }),
      );
      return { revision: file.revision, added, items };
    }
    const file = this.file();
    if (operation === "clips") return queryClips(file, input);
    if (operation === "timeline") return queryTimeline(file, input);
    const snapshot = this.project.snapshot(),
      tracks = [...file.project.videoTracks, ...file.project.audioTracks];
    return {
      name: file.project.name,
      path: this.project.store.path,
      revision: file.revision,
      savedRevision: this.project.savedRevision,
      dirty: file.revision !== this.project.savedRevision,
      duration: Math.max(
        0,
        ...tracks.flatMap((t) => t.clips.map((c) => c.start.seconds + c.duration.seconds)),
      ),
      width: file.project.settings.width,
      height: file.project.settings.height,
      frameRate:
        file.project.settings.frameRate.numerator / file.project.settings.frameRate.denominator,
      tracks: tracks.length,
      clips: tracks.reduce((sum, t) => sum + t.clips.length, 0),
      media: file.project.media.length,
      markers: file.project.markers.length,
      undo: snapshot.undoLabel,
      redo: snapshot.redoLabel,
      headless: false,
      jobs: [],
      exports: [],
      recoveredEdits: false,
      apiVersion: "0.1.0",
      warnings: [
        ...validateProject(file.project)
          .filter((i) => i.severity === "warning")
          .map((i) => i.message),
        "Renderer media copies, analysis jobs and exports are not visible to the host query service.",
      ],
    };
  }

  private watch(request: Record<string, unknown>, signal: AbortSignal) {
    const initial = this.project.snapshot(),
      revision = Number(request.revision ?? this.file().revision),
      timeout = Number(request.timeout ?? 30);
    if (timeout <= 0 || timeout > 600)
      throw new QueryError(
        "badRequest",
        "Watch timeout must be greater than zero and at most 600 seconds.",
      );
    signal.throwIfAborted();
    return new Promise<unknown>((complete, reject) => {
      const result = (changed: boolean) => ({
        revision: this.file().revision,
        changed,
        events: [],
        jobs: [],
        resync: true,
        generation: this.project.snapshot().generation,
      });
      if (
        this.file().revision > revision ||
        (request.generation != null && request.generation !== initial.generation)
      ) {
        complete(result(true));
        return;
      }
      const finish = (changed: boolean, cancelled = false) => {
        clearTimeout(timer);
        stop();
        signal.removeEventListener("abort", abort);
        if (cancelled) reject(new QueryError("unavailable", "Watch cancelled."));
        else complete(result(changed));
      };
      const stop = this.project.subscribe((snapshot) => {
        if (
          snapshot.generation !== initial.generation ||
          JSON.parse(snapshot.json).revision > revision
        )
          finish(true);
      });
      const timer = setTimeout(() => finish(false), timeout * 1000);
      const abort = () => finish(false, true);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
