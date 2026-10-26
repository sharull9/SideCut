import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve, relative, isAbsolute, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeProjectFile } from "@sidecut/contracts/project";
import {
  queryRequest,
  queryClips,
  queryTimeline,
  QueryError,
  clipMediaID,
  queryDefinitions,
} from "@sidecut/core/project-queries";
import { validateProject } from "@sidecut/core/validation";
import { freshProject, type HostProjectService } from "./project-service.ts";
import { scanFolder, mediaRole } from "./folder-scanner.ts";
import type { NativeMedia } from "./native-media.ts";
import {
  serviceRequest,
  serviceFields,
  requestJsonSchema,
  serviceRequired,
} from "@sidecut/core/service-requests";
import {
  clipChanges,
  editOutcome,
  revisionFile,
  restorePlan,
  diffEdits,
} from "@sidecut/core/service-edits";
import { ProjectCoordinator, EditError, type JournalEntry } from "@sidecut/core/coordinator";
import { helperPlan } from "@sidecut/core/service-speech";
import { serviceOutput } from "./service-output.ts";
import { encodeProjectFile } from "@sidecut/contracts/project";
import { safeArchivePath } from "@sidecut/core/archive";
import { checkRanges } from "@sidecut/core/quality-check";
import { reviewQuery } from "@sidecut/core/service-review";
import { effectsCatalog } from "@sidecut/core/effects";
import { importEDL, object } from "@sidecut/core/interchange";
import { readFilmoraSource } from "./filmora-import.ts";
import { analysisKinds, decodeQueryState } from "@sidecut/core/query-state";
import { serviceExportPlan } from "@sidecut/core/service-export";
import { speechTracks } from "@sidecut/core/speech";
import { resolveServiceMedia, isCameraTake } from "@sidecut/core/service-sync";
import { folderArchive } from "./service-archive.ts";
import { writeProjectCommandOutput } from "./project-command-output.ts";
import { relinkPlan, fileFingerprint } from "./service-relink.ts";
import { ServiceEvents } from "./service-events.ts";
type RendererOperations = {
  ready?: () => boolean;
  activate?: () => void;
  run: (
    operation: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    progress?: (value: number) => void,
  ) => Promise<unknown>;
  screenshot: () => Promise<Uint8Array>;
};

export class ProjectAPI {
  readonly events = new ServiceEvents();
  ready() {
    return this.renderer?.ready?.() ?? true;
  }
  async readProjectResource(id: unknown) {
    if (typeof id !== "string") throw new QueryError("badRequest", "Invalid media ID.");
    const media = this.file().project.media.find((item) => item.id === id);
    if (!media) throw new QueryError("notFound", "Unknown media ID.");
    const path = await this.source(media.path);
    if (!(await stat(path)).isFile() || (await stat(path)).size > 256 * 1024 * 1024)
      throw new QueryError("badRequest", "Native source must be a file up to 256 MiB.");
    return { bytes: new Uint8Array(await readFile(path)), name: basename(path) };
  }
  private exports = new Map<
    string,
    { kind: string; path: string; state: string; progress: number; message?: string }
  >();
  private async waitExports(request: Record<string, unknown>, signal: AbortSignal) {
    const started = Date.now(),
      timeout = Math.min(86400, Math.max(0, Number(request.timeout ?? 600)));
    const seen = new Set<string>();
    const observe = async () => {
      while (true) {
        signal.throwIfAborted();
        for (const [id, job] of this.exports) if (job.state === "running") seen.add(id);
        const all = [...seen].flatMap((id) => this.exports.get(id) ?? []),
          pending = all.filter((j) => j.state === "running");
        if (!pending.length || Date.now() - started >= timeout * 1000)
          return { finished: all.filter((j) => j.state !== "running"), pending };
        await new Promise<void>((complete, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new QueryError("unavailable", "Wait cancelled."));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            complete();
          }, 100);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
    };
    const [api, renderer] = await Promise.all([
      observe(),
      this.renderer?.run("wait", request, signal),
    ]);
    const ui = object(renderer ?? {}),
      finished = [...api.finished, ...(Array.isArray(ui.finished) ? ui.finished : [])],
      pending = [...api.pending, ...(Array.isArray(ui.pending) ? ui.pending : [])];
    return {
      what: "export",
      ok: !pending.length && !finished.some((item) => object(item).state === "failed"),
      done: !pending.length,
      timedOut: !!pending.length,
      elapsed: (Date.now() - started) / 1000,
      finished,
      pending,
    };
  }
  private mediaRoot: string | null = null;
  private readonly started = new Date().toISOString();
  private port: number | undefined;
  setOwnerPort(port: number) {
    this.port = port;
  }
  private async queryState(signal: AbortSignal, includeMedia: boolean) {
    signal.throwIfAborted();
    if (!this.renderer || this.renderer.ready?.() === false) return null;
    const before = this.project.snapshot(),
      file = this.file();
    const raw = await this.renderer.run("query-state", { includeMedia }, signal);
    signal.throwIfAborted();
    let state;
    try {
      state = decodeQueryState(raw);
    } catch {
      throw new QueryError("unavailable", "Invalid editor query snapshot.");
    }
    if (
      state.projectID !== file.project.id ||
      state.revision !== file.revision ||
      this.project.snapshot().generation !== before.generation ||
      this.file().revision !== file.revision
    )
      throw new QueryError("unavailable", "Editor query snapshot is stale. Retry the query.");
    return state;
  }
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
    if (operation === "apply") return this.apply(request, file, snapshot.generation);
    if (request.expectedRevision != null && request.expectedRevision !== file.revision)
      throw new EditError(
        "stale-revision",
        `Stale revision: expected ${request.expectedRevision}, actual ${file.revision}.`,
      );
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
    const numeric = reference.trim() === "reviewed" || /^r?\d+$/.test(reference.trim());
    let known = numeric;
    if (!known) {
      try {
        known = clipChanges(revisionFile(file, source.revision), source).length === 0;
      } catch {
        /* Snapshots can outlive their journal. */
      }
    }
    const description = numeric
      ? `revision ${source.revision}`
      : `${/\.(mp4|webm|m4a|wav)$/i.test(reference) ? "the export snapshot" : "the project file"} ${reference.trim()}${known ? ` (revision ${source.revision})` : ""}`;
    if (operation === "diff")
      return {
        revision: file.revision,
        since: description,
        ...(known ? { sinceRevision: source.revision } : {}),
        changes: clipChanges(source, file),
        ...(known ? { edits: diffEdits(file, source.revision) } : {}),
      };
    const plan = restorePlan(file, source, request);
    plan.from = description;
    if (request.apply === true && plan.commands.length) {
      if (plan.problem) throw new QueryError("badRequest", plan.problem);
      const count = plan.items.filter((item) => item.action !== "unchanged").length;
      return {
        ...plan,
        applied: this.apply(
          {
            commands: plan.commands,
            label:
              request.label ??
              `Restore ${count} clip${count === 1 ? "" : "s"} from ${numeric ? `revision ${source.revision}` : reference.trim()}`,
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
    reference = reference.trim();
    if (reference === "reviewed")
      return revisionFile(file, this.project.store.reviewedRevision(file.project.id));
    if (/^r?-?\d+$/.test(reference)) {
      const revision = Number(reference.replace(/^r/, ""));
      if (!Number.isSafeInteger(revision) || revision < 0 || revision > file.revision)
        throw new QueryError(
          "badRequest",
          "Revision is outside the project history.",
          file.revision,
        );
      return revisionFile(file, revision);
    }
    const name = safeArchivePath(
      reference.match(/\.(mp4|webm|m4a|wav)$/i) ? reference + ".tandem" : reference,
    );
    const root = await realpath(dirname(this.project.store.path));
    let path: string;
    try {
      path = await realpath(resolve(root, name));
    } catch {
      throw new QueryError("notFound", `Baseline ${name} was not found.`, file.revision);
    }
    const within = relative(root, path);
    if (within.startsWith("..") || isAbsolute(within) || (await stat(path)).size > 20 * 1024 * 1024)
      throw new QueryError("badRequest", "Unsafe or oversized baseline project.");
    try {
      return decodeProjectFile(JSON.parse(await readFile(path, "utf8")));
    } catch {
      throw new QueryError(
        "badRequest",
        "The baseline could not be read as a project.",
        file.revision,
      );
    }
  }
  private async rendererOperation(
    operation: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
    progress: (value: number) => void = () => {},
  ) {
    signal.throwIfAborted();
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
      const plan = ["join", "short"].includes(operation)
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
            commands: [...result.commands, { adoptFormat: { format: "portrait" } }],
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
        const copyName = String(
          request.copyPath ?? `${file.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")} Short.tandem`,
        );
        const warnings = [...result.warnings];
        if (this.renderer && this.renderer.ready?.() !== false)
          await this.renderer.run(
            "short-copy-resources",
            { projectID: copyFile.project.id },
            signal,
          );
        else if (file.project.media.length)
          warnings.push(
            "No ready editor is attached; browser resources were not copied. Open the source in the editor and retry with a new output name.",
          );
        if (
          this.project.snapshot().generation !== snapshot.generation ||
          this.file().revision !== file.revision
        )
          throw new EditError("stale-revision", "Project changed while preparing the short copy.");
        const path = await serviceOutput(
          this.project.store.path,
          copyName,
          new TextEncoder().encode(
            encodeProjectFile({
              revision: file.revision,
              project: {
                ...copy.projectFile().project,
                name: copyName
                  .split(/[\\/]/)
                  .at(-1)!
                  .replace(/\.tandem$/i, ""),
              },
            }),
          ),
          signal,
        );
        return { ...result, warnings, copy: path };
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
    const renderStarted = performance.now();
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
      if (!ids.length) throw new QueryError("badRequest", "Name the media to transcribe.");
      if (ids.some((id) => !id))
        throw new QueryError("notFound", "A transcription source was not found.");
      if (ids.some((id) => !file.project.media.find((m) => m.id === id)?.hasAudio))
        throw new QueryError("badRequest", "Transcription requires audio media.");
      const speech = new Set(speechTracks(file.project).flatMap((t) => t.clips.map(clipMediaID)));
      const commands = [...new Set(ids)]
        .filter((id) => {
          const item = file.project.media.find((m) => m.id === id)!;
          return item.transcribe !== true && item.role !== "camera" && !speech.has(id);
        })
        .map((mediaID) => ({ updateMedia: { mediaID, patch: { transcribe: true } } }));
      if (commands.length)
        applied = this.apply(
          {
            commands,
            label:
              request.label ??
              (commands.length === 1
                ? `Transcribe ${file.project.media
                    .find((m) => m.id === commands[0]!.updateMedia.mediaID)!
                    .path.split(/[\\/]/)
                    .at(-1)}`
                : `Transcribe ${commands.length} files`),
            author: request.author ?? "agent",
          },
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
    const result = (await this.renderer.run(operation, request, signal, (value) =>
      progress(value * 0.7),
    )) as Record<string, unknown>;
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
          (value) => progress(0.7 + value * 0.3),
          0,
          Number(metadata.duration),
          extension === ".mp4" ? serviceExportPlan(file.project, request, operation) : undefined,
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
      elapsed: (performance.now() - renderStarted) / 1000,
      path,
      codec:
        extension === ".mp4"
          ? serviceExportPlan(file.project, request, operation).codec
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
      const operations = { ...queryDefinitions, ...serviceFields };
      return {
        apiVersion: "0.1.0",
        jsonSchemas: Object.fromEntries(
          Object.entries(operations).map(([name, fields]) => [
            name,
            requestJsonSchema(fields, serviceRequired[name]),
          ]),
        ),
        operations,
      };
    }
    if (Object.hasOwn(serviceFields, operation)) {
      const request = serviceRequest(operation, input);
      if (operation === "app") {
        if (!this.renderer?.activate)
          throw new QueryError(
            "notImplemented",
            "Application activation requires the native desktop host.",
          );
        this.renderer.activate();
        return { opened: true, projectID: this.file().project.id };
      }
      if (["new", "open", "import-edl", "import-filmora"].includes(operation)) {
        const before = this.project.snapshot();
        if (request.expectedRevision == null)
          throw new QueryError(
            "badRequest",
            "Replacing the active project requires expectedRevision. The current project is saved before replacement.",
          );
        let next;
        let report;
        if (operation === "new") {
          let name = request.name;
          if (name == null && typeof request.path === "string") {
            const target = resolve(dirname(this.project.store.path), request.path);
            name = (await stat(target).catch(() => null))?.isDirectory()
              ? basename(target)
              : basename(target, ".tandem");
          }
          next = decodeProjectFile({
            revision: 0,
            project: {
              ...freshProject().project,
              name: name ?? "Untitled sequence",
              settings: {
                ...freshProject().project.settings,
                width: request.width ?? 3840,
                height: request.height ?? 2160,
              },
            },
          });
        } else {
          if (typeof request.path !== "string")
            throw new QueryError("badRequest", "A source path is required.");
          const path = await this.source(request.path);
          if (operation === "import-filmora") {
            const imported = await readFilmoraSource(path, request.keepLevels === true, signal);
            next = imported.file;
            report = imported.report;
          } else {
            if ((await stat(path)).size > 20 * 1024 * 1024)
              throw new QueryError("badRequest", "Project import exceeds 20 MiB.");
            const bytes = await readFile(path);
            if (operation === "open") next = decodeProjectFile(JSON.parse(bytes.toString("utf8")));
            else {
              const parsed = object(JSON.parse(bytes.toString("utf8")));
              const recipePath =
                typeof request.recipe === "string" ? await this.source(request.recipe) : undefined;
              if (recipePath && (await stat(recipePath)).size > 20 * 1024 * 1024)
                throw new QueryError("badRequest", "Import recipe exceeds 20 MiB.");
              const recipe = recipePath
                ? JSON.parse(await readFile(recipePath, { encoding: "utf8", signal }))
                : parsed.recipe;
              const imported = importEDL(request.recipe ? parsed : parsed.edl, recipe);
              next = imported.file;
              report = imported.report;
            }
          }
        }
        if (typeof request.name === "string") {
          if (next.project.name !== request.name) {
            const renamed = new ProjectCoordinator(next);
            renamed.apply({
              label: "Name imported project",
              author: "agent",
              commands: [{ updateProject: { patch: { name: request.name } } }],
            });
            next = renamed.projectFile();
          }
        }
        const output = operation === "new" ? request.path : request.output;
        await this.project.flush();
        if (
          JSON.parse(this.project.snapshot().json).revision !== request.expectedRevision ||
          this.project.snapshot().generation !== before.generation
        )
          throw new EditError("stale-revision", "Project changed before replacement.");
        signal.throwIfAborted();
        const written =
          typeof output === "string"
            ? await writeProjectCommandOutput(
                this.project.store.path,
                output,
                encodeProjectFile(next),
                signal,
              )
            : undefined;
        try {
          signal.throwIfAborted();
          await this.project.replace(encodeProjectFile(next), false, {
            generation: before.generation,
            revision: Number(request.expectedRevision),
          });
        } catch (error) {
          if (written) await unlink(written).catch(() => {});
          throw error;
        }
        this.mediaRoot = null;
        return {
          ...(written ? { path: written } : {}),
          ...(report ? { report } : {}),
          width: next.project.settings.width,
          height: next.project.settings.height,
          tracks: [...next.project.videoTracks, ...next.project.audioTracks].map(
            (track) => track.name,
          ),
          revision: this.file().revision,
          projectID: this.file().project.id,
          name: this.file().project.name,
        };
      }
      if (operation === "check") {
        const file = this.file();
        const changed =
          diffEdits(file, this.project.store.reviewedRevision(file.project.id))?.flatMap((e) =>
            !["human", "user"].includes(e.author) && e.start != null && e.end != null
              ? [{ start: e.start, end: e.end }]
              : [],
          ) ?? [];
        const ranges = checkRanges(file.project, request, changed);
        if (request.quick === true || !ranges.length)
          return reviewQuery(file, operation, request, changed);
        if (!this.renderer)
          throw new QueryError(
            "unavailable",
            "Rendered and speech-cut checks require an attached editor.",
          );
        return this.renderer.run("check-state", { request, ranges }, signal);
      }
      if (operation === "comments" && this.renderer && this.renderer.ready?.() !== false)
        return this.renderer.run(operation, request, signal);
      if (["validate", "check", "comments"].includes(operation))
        return reviewQuery(this.file(), operation, request);
      if (operation === "effects") {
        return effectsCatalog(typeof request.type === "string" ? request.type : undefined);
      }
      if (operation === "watch") {
        const result = await this.watch(request, signal);
        const state = await this.queryState(signal, false);
        return { ...result, jobs: state?.jobs ?? [] };
      }
      if (operation === "wait" && request.what === "export")
        return this.waitExports(request, signal);
      if (operation === "sync") {
        const file = this.file(),
          generation = this.project.snapshot().generation;
        if (request.expectedRevision != null && request.expectedRevision !== file.revision)
          throw new EditError("stale-revision", "Stale revision. Retry with the latest project.");
        const result = () => ({
          revision: this.file().revision,
          files: this.file()
            .project.media.filter((m) => m.kind === "video" && m.hasVideo)
            .toSorted(
              (a, b) =>
                Number(isCameraTake(b)) - Number(isCameraTake(a)) || a.path.localeCompare(b.path),
            )
            .map((m) => ({
              id: m.id,
              path: m.path,
              role: m.role,
              pictureDelay: m.pictureDelay?.seconds,
              pictureDelayCorrected: m.pictureDelayCorrected?.seconds,
            })),
          defaultDelay: this.project.store.cameraPictureDelay(),
        });
        if ((request.files as string[] | undefined)?.length) {
          if (!this.renderer)
            throw new QueryError("unavailable", "Sound sync requires a ready editor.");
          const raw = object(await this.renderer.run("sync", request, signal));
          if (!Array.isArray(raw.commands) || raw.revision !== file.revision)
            throw new QueryError("unavailable", "Invalid sound sync plan.");
          signal.throwIfAborted();
          const applied = raw.commands.length
            ? this.apply(
                {
                  commands: raw.commands,
                  label: request.label ?? "Sync by sound",
                  author: request.author ?? "agent",
                  dryRun: request.dryRun,
                  expectedRevision: file.revision,
                },
                file,
                generation,
              )
            : undefined;
          return {
            ...result(),
            matches: raw.matches,
            reference: raw.reference,
            warnings: raw.warnings,
            ...(applied ? { applied } : {}),
          };
        }
        if (request.to != null || request.place != null)
          throw new QueryError("badRequest", "to and place require files to align by sound.");
        if (request.delay == null && (request.media != null || request.makeDefault === true))
          throw new QueryError("badRequest", "Give the picture delay in seconds too.");
        if (request.delay != null && Math.abs(Number(request.delay)) > 1)
          throw new QueryError(
            "badRequest",
            "Picture delay must be within one second; 80 ms is 0.08.",
          );
        const items =
          request.media != null
            ? resolveServiceMedia(file.project, request.media as string[])
            : file.project.media.filter((m) => isCameraTake(m) && m.pictureDelayCorrected == null);
        if (request.delay != null && items.some((m) => m.kind !== "video" || !m.hasVideo))
          throw new QueryError("badRequest", "Picture delay requires moving picture sources.");
        const changed = items.filter((m) => (m.pictureDelay?.seconds ?? 0) !== request.delay);
        const applied =
          request.delay == null || !changed.length
            ? undefined
            : this.apply({
                expectedRevision: request.expectedRevision,
                dryRun: request.dryRun,
                label: request.label ?? "Set picture delay",
                author: request.author ?? "agent",
                commands: changed.map((m) => ({
                  updateMedia: {
                    mediaID: m.id,
                    patch: { pictureDelay: request.delay === 0 ? null : request.delay },
                  },
                })),
              });
        if (request.makeDefault === true && request.dryRun !== true)
          this.project.store.cameraPictureDelay(Number(request.delay));
        return {
          ...result(),
          ...(applied ? { applied } : {}),
          warnings: [],
        };
      }
      if (operation === "archive") {
        if (
          request.output != null &&
          (request.to != null || request.dryRun != null || request.withCache != null)
        )
          throw new QueryError(
            "badRequest",
            "Use output for ZIP export, or to/dryRun/withCache for a folder archive.",
          );
        const file = this.file(),
          generation = this.project.snapshot().generation;
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
        if (request.output == null)
          return folderArchive(
            this.project.store.path,
            file,
            Buffer.from(result.data, "base64"),
            request,
            signal,
            (commands) =>
              this.apply(
                {
                  commands,
                  label: request.label ?? "Consolidate project resources",
                  author: request.author ?? "agent",
                  expectedRevision: file.revision,
                },
                file,
                generation,
              ),
          );
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
        if (request.path == null && request.mediaID == null) {
          const before = this.project.snapshot(),
            file = this.file();
          if (request.expectedRevision != null && request.expectedRevision !== file.revision)
            throw new EditError("stale-revision", "Project revision changed.");
          const plan = await relinkPlan(
            file,
            this.mediaRoot ?? dirname(this.project.store.path),
            request,
            signal,
          );
          if (request.dryRun === true || !plan.found.length) return plan.result;
          if (!this.renderer)
            throw new QueryError(
              "unavailable",
              "A ready editor is required to stage relinked resources.",
            );
          for (const match of plan.found) {
            signal.throwIfAborted();
            const bytes = await readFile(match.absolute);
            if (
              bytes.length > 64 * 1024 * 1024 ||
              (await fileFingerprint(match.absolute, signal)) !== match.fingerprint
            )
              throw new QueryError("unavailable", "Relink source changed during the scan. Retry.");
            const current = this.project.snapshot();
            if (current.generation !== before.generation || this.file().revision !== file.revision)
              throw new EditError("stale-revision", "Project changed during relink. Retry.");
            await this.renderer.run(
              "relink-stage",
              {
                projectID: file.project.id,
                mediaID: match.mediaID,
                name: match.to.split(/[\\/]/).at(-1),
                bytes: Array.from(bytes),
              },
              signal,
            );
          }
          signal.throwIfAborted();
          const applied = this.apply(
            {
              commands: plan.commands,
              label: request.label ?? `Relink ${plan.found.length} missing files`,
              author: request.author,
              expectedRevision: file.revision,
            },
            file,
            before.generation,
          );
          return { ...plan.result, revision: this.file().revision, applied };
        }
        if (
          request.search != null ||
          request.dryRun != null ||
          request.label != null ||
          request.author != null ||
          request.expectedRevision != null
        )
          throw new QueryError(
            "badRequest",
            "Use folder relink options separately from legacy mediaID/path replacement.",
          );
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
        if (
          ["assets-use", "insert-segment"].includes(operation) &&
          request.expectedRevision != null &&
          request.expectedRevision !== this.file().revision
        )
          throw new EditError("stale-revision", "Stale revision. Retry with the latest project.");
        if (!this.renderer)
          throw new QueryError(
            "unavailable",
            "A ready editor is required for library and job operations.",
          );
        return this.renderer.run(operation, request, signal);
      }
      if (["apply", "undo", "redo", "history", "diff", "restore"].includes(operation))
        return this.edit(operation, request);
      if (["export", "clip"].includes(operation)) {
        const id = randomUUID(),
          job = {
            kind: "export",
            path: String(request.output ?? operation),
            state: "running",
            progress: 0,
          };
        this.exports.set(id, job);
        const publish = () =>
          this.events.publish({
            kind: "export",
            revision: this.file().revision,
            export: {
              ...this.exports.get(id),
              id,
              output: job.path,
              preset: request.preset ?? "review",
            },
          });
        publish();
        try {
          const result = await this.rendererOperation(operation, request, signal, (progress) => {
            this.exports.set(id, { ...job, progress });
            publish();
          });
          this.exports.set(id, { ...job, state: "done", progress: 1 });
          publish();
          return result;
        } catch (error) {
          this.exports.set(id, {
            ...job,
            state: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
          publish();
          throw error;
        } finally {
          for (const [key, value] of this.exports)
            if (this.exports.size > 64 && value.state !== "running" && key !== id)
              this.exports.delete(key);
        }
      }
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
      const rendererState = await this.queryState(signal, true);
      const items = await Promise.all(
        file.project.media.map(async (m) => {
          let exists = false;
          try {
            exists = (await stat(await this.source(m.path))).isFile();
          } catch {
            /* Missing and out-of-root sources stay references. */
          }
          const cached = rendererState?.media[m.id];
          const analysis =
            cached?.analysis ??
            Object.fromEntries(analysisKinds(m).map((kind) => [kind, { state: "none" }]));
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
            exists: exists || cached?.exists === true,
            analysis,
          };
        }),
      );
      return {
        revision: file.revision,
        added,
        items,
        ...(!rendererState
          ? {
              warnings: [
                "No ready editor is attached; renderer media copies and analysis caches are unavailable.",
              ],
            }
          : {}),
      };
    }
    const file = this.file();
    if (operation === "clips") return queryClips(file, input);
    if (operation === "timeline") {
      if (
        request.words === true &&
        request.summary !== true &&
        request.format !== "json" &&
        this.renderer &&
        this.renderer.ready?.() !== false
      )
        return this.renderer.run("timeline", request, signal);
      return queryTimeline(file, input);
    }
    const rendererState = await this.queryState(signal, false);
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
      openIn: {
        owner: "app",
        pid: process.pid,
        started: this.started,
        ...(this.port ? { port: this.port } : {}),
      },
      jobs: rendererState?.jobs ?? [],
      exports: rendererState?.exports ?? [],
      recoveredEdits: typeof file.sidecutRecovery === "string",
      reviewPending: this.project.reviewPending(),
      apiVersion: "0.1.0",
      warnings: [
        ...validateProject(file.project)
          .filter((i) => i.severity === "warning")
          .map((i) => i.message),
        ...(rendererState?.warnings ?? [
          "No ready editor is attached; font availability, analysis jobs and exports cannot be inspected.",
        ]),
      ],
    };
  }

  private watch(request: Record<string, unknown>, signal: AbortSignal) {
    const initial = this.project.snapshot(),
      revision = Number(request.revision ?? this.file().revision),
      timeout = Math.min(600, Math.max(0, Number(request.timeout ?? 30)));
    signal.throwIfAborted();
    return new Promise<Record<string, unknown>>((complete, reject) => {
      const result = (changed: boolean) => ({
        revision: this.file().revision,
        changed,
        events: this.project
          .recentEvents()
          .filter(
            (event) =>
              event.generation === this.project.snapshot().generation && event.revision > revision,
          ),
        resync:
          this.project.snapshot().generation !== (request.generation ?? initial.generation) ||
          revision > this.file().revision ||
          (this.file().revision > revision &&
            !this.project
              .recentEvents()
              .some(
                (event) =>
                  event.generation === this.project.snapshot().generation &&
                  event.revision === revision + 1,
              )),
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
