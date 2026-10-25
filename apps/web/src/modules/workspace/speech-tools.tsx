import { useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { RiMicLine } from "@remixicon/react";
import { Time } from "@sidecut/contracts/time";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@sidecut/ui/components/dialog";
import {
  findPauses,
  planCaptions,
  planTighten,
  searchSpeech,
  speechMap,
  DEFAULT_PAUSE_KEEP,
  DEFAULT_PAUSE_MINIMUM,
  REFERENCE_SPEECH_RULES,
  type TightenRequest,
} from "@sidecut/core/speech";
import { useEditorSession } from "./editor-session";
import { ToolTip } from "./tool-tip";
import "./dialogs.css";

const TABS = [
  ["search", "Search"],
  ["pauses", "Pauses"],
  ["captions", "Captions"],
] as const;
type Tab = (typeof TABS)[number][0];
const fmt = (s: number) => `${s.toFixed(2)} s`;
const optional = (value: string) => {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Enter times in seconds.");
  return n;
};
const attempt = <T,>(task: () => T): { value: T; error: null } | { value: null; error: string } => {
  try {
    return { value: task(), error: null };
  } catch (cause) {
    return { value: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
};

export function SpeechToolsDialog() {
  const { session, snapshot } = useEditorSession();
  const analysis = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<Tab>("search"),
    [preparing, setPreparing] = useState(false);
  // `analysis` changes whenever a transcript or waveform arrives, so queries rerun.
  const transcripts = useMemo(
    () => (item: { id: string }) =>
      analysis[item.id] ? session.analysis.transcriptFor(item) : undefined,
    [analysis, session],
  );
  const disabled = snapshot.readOnly || snapshot.busy;
  // Roving focus: only the selected tab is in the tab order, arrows move between tabs.
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex(([id]) => id === tab),
      last = TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = TABS[next]![0];
    setTab(id);
    event.currentTarget.querySelector<HTMLElement>(`#speech-tab-${id}`)?.focus();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setPreparing(true);
          void session.analysis.prepareSpeech().finally(() => setPreparing(false));
        }
      }}
    >
      <ToolTip label="Speech tools">
        <DialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Speech" />}>
          <RiMicLine aria-hidden="true" />
        </DialogTrigger>
      </ToolTip>
      <DialogContent className="dark editor-dialog editor-dialog-wide">
        <DialogHeader>
          <DialogTitle>Speech tools</DialogTitle>
          <DialogDescription>
            Uses local transcripts with word edges aligned to each source's waveform. Results use
            the same queries as the project service. Transcribe sources under Local analysis.
          </DialogDescription>
        </DialogHeader>
        <div
          className="editor-inspector-tabs editor-speech-tabs"
          role="tablist"
          aria-label="Speech tools"
          onKeyDown={moveTab}
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              id={`speech-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={id === tab}
              aria-controls="speech-tab-panel"
              tabIndex={id === tab ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div id="speech-tab-panel" role="tabpanel" aria-labelledby={`speech-tab-${tab}`}>
          {preparing && <p role="status">Loading cached transcripts and waveforms…</p>}
          {tab === "search" && <SearchPanel transcripts={transcripts} />}
          {tab === "pauses" && <PausesPanel transcripts={transcripts} disabled={disabled} />}
          {tab === "captions" && <CaptionsPanel transcripts={transcripts} disabled={disabled} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Transcripts = Parameters<typeof searchSpeech>[2];

function Missing({ ids }: { ids: readonly string[] }) {
  const { snapshot } = useEditorSession();
  if (!ids.length) return null;
  return (
    <FieldDescription>
      No transcript yet for{" "}
      {ids.map((id) => snapshot.project.media.find((m) => m.id === id)?.path ?? id).join(", ")}.
      Speech there is not searched, measured, or captioned.
    </FieldDescription>
  );
}

function SearchPanel({ transcripts }: { transcripts: Transcripts }) {
  const { snapshot, editor } = useEditorSession();
  const [phrase, setPhrase] = useState(""),
    [query, setQuery] = useState("");
  const result = useMemo(
    () => (query ? attempt(() => searchSpeech(snapshot, query, transcripts, 200)) : null),
    [query, snapshot, transcripts],
  );
  return (
    <form
      className="editor-speech-panel"
      onSubmit={(event) => {
        event.preventDefault();
        setQuery(phrase);
      }}
    >
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="speech-search" className="sr-only">
            Phrase
          </FieldLabel>
          <Input
            id="speech-search"
            type="search"
            placeholder="Find a phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </Field>
        {result?.error && <FieldError role="alert">{result.error}</FieldError>}
        {result?.value && (
          <>
            <p role="status">
              {result.value.hits.length} on the timeline · {result.value.unused.length} in unused
              source material
            </p>
            <ol className="editor-speech-results" aria-label="Timeline matches">
              {result.value.hits.map((hit) => (
                <li key={`${hit.start}:${hit.clipIDs.join()}`}>
                  <button
                    type="button"
                    onClick={() => {
                      const view = editor.getState();
                      view.seek(Time.fromSeconds(hit.start));
                      hit.clipIDs.forEach((id, i) => view.select(id, i > 0));
                    }}
                  >
                    <span className="editor-speech-time">
                      {fmt(hit.start)}–{fmt(hit.end)}
                    </span>
                    <span>
                      <span className="text-muted-foreground">{hit.before} </span>
                      <mark>{hit.text}</mark>
                      <span className="text-muted-foreground"> {hit.after}</span>
                    </span>
                    {hit.partial && <span className="editor-speech-badge">partly cut</span>}
                  </button>
                </li>
              ))}
            </ol>
            {result.value.unused.length > 0 && (
              <>
                <h4>Not on the timeline</h4>
                <ol className="editor-speech-results" aria-label="Unused source matches">
                  {result.value.unused.map((hit) => (
                    <li key={`${hit.mediaID}:${hit.mediaStart}`}>
                      <span className="editor-speech-time">
                        {hit.path} {fmt(hit.mediaStart)}–{fmt(hit.mediaEnd)}
                      </span>
                      <span>
                        <span className="text-muted-foreground">{hit.before} </span>
                        <mark>{hit.text}</mark>
                        <span className="text-muted-foreground"> {hit.after}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <Missing ids={result.value.missing} />
          </>
        )}
      </FieldGroup>
    </form>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.01"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function PausesPanel({ transcripts, disabled }: { transcripts: Transcripts; disabled: boolean }) {
  const { session, snapshot } = useEditorSession();
  const [mode, setMode] = useState<"uniform" | "punctuation">("uniform");
  const [values, setValues] = useState({
    min: String(DEFAULT_PAUSE_MINIMUM),
    keep: String(DEFAULT_PAUSE_KEEP),
    sentence: String(REFERENCE_SPEECH_RULES.sentence),
    comma: String(REFERENCE_SPEECH_RULES.comma),
    mid: String(REFERENCE_SPEECH_RULES.mid),
    midMin: String(REFERENCE_SPEECH_RULES.midMinimum),
    from: "",
    to: "",
  });
  const [widen, setWiden] = useState(false),
    [error, setError] = useState<string | null>(null),
    [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  // Each plan is checked on a scratch copy of the project, so it only reruns when inputs change.
  const plan = useMemo(
    () =>
      attempt(() => {
        const range = { from: optional(values.from), to: optional(values.to) };
        const request: TightenRequest =
          mode === "uniform"
            ? { min: optional(values.min), keep: optional(values.keep), widen, ...range }
            : {
                min: optional(values.min),
                sentence: optional(values.sentence),
                comma: optional(values.comma),
                mid: optional(values.mid),
                midMin: optional(values.midMin),
                widen,
                ...range,
              };
        const tighten = planTighten(snapshot, request, transcripts);
        const pauses = findPauses(
          speechMap(snapshot.project, transcripts),
          tighten.midMinimum == null
            ? tighten.minimum
            : Math.min(tighten.minimum, tighten.midMinimum),
          range.from ?? undefined,
          range.to ?? undefined,
        );
        return { tighten, pauses };
      }),
    [mode, values, widen, snapshot, transcripts],
  );
  return (
    <div className="editor-speech-panel">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="tighten-mode">Keep</FieldLabel>
          <select
            id="tighten-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="uniform">The same silence in every pause</option>
            <option value="punctuation">Silence by what each pause follows</option>
          </select>
        </Field>
        <div className="editor-speech-grid">
          <NumberField
            id="tighten-min"
            label={mode === "uniform" ? "Pauses longer than (s)" : "Sentence pauses from (s)"}
            value={values.min}
            onChange={set("min")}
          />
          {mode === "uniform" ? (
            <NumberField
              id="tighten-keep"
              label="Leave (s)"
              value={values.keep}
              onChange={set("keep")}
            />
          ) : (
            <>
              <NumberField
                id="tighten-mid-min"
                label="Other pauses from (s)"
                value={values.midMin}
                onChange={set("midMin")}
              />
              <NumberField
                id="tighten-sentence"
                label="After a sentence (s)"
                value={values.sentence}
                placeholder="Leave alone"
                onChange={set("sentence")}
              />
              <NumberField
                id="tighten-comma"
                label="After , ; : (s)"
                value={values.comma}
                placeholder="Mid-sentence value"
                onChange={set("comma")}
              />
              <NumberField
                id="tighten-mid"
                label="Mid-sentence (s)"
                value={values.mid}
                placeholder="Leave alone"
                onChange={set("mid")}
              />
            </>
          )}
          <NumberField
            id="tighten-from"
            label="From (s)"
            value={values.from}
            placeholder="Start"
            onChange={set("from")}
          />
          <NumberField
            id="tighten-to"
            label="To (s)"
            value={values.to}
            placeholder="End"
            onChange={set("to")}
          />
        </div>
        {mode === "punctuation" && (
          <FieldDescription>
            Defaults follow the reference speech rules: {REFERENCE_SPEECH_RULES.sentence} s between
            sentences, {REFERENCE_SPEECH_RULES.comma} s after a comma, and{" "}
            {REFERENCE_SPEECH_RULES.mid} s mid-sentence, from {REFERENCE_SPEECH_RULES.minimum} s.
            Clear a value to leave that kind of pause alone.
          </FieldDescription>
        )}
        <Field orientation="horizontal">
          <input
            id="tighten-widen"
            type="checkbox"
            checked={widen}
            onChange={(event) => setWiden(event.target.checked)}
          />
          <FieldLabel htmlFor="tighten-widen">
            Widen tight joins between speech clips back to the kept silence
          </FieldLabel>
        </Field>
        {plan.error && <FieldError role="alert">{plan.error}</FieldError>}
        {plan.value && (
          <>
            <p role="status">
              {plan.value.pauses.length} pause{plan.value.pauses.length === 1 ? "" : "s"} found ·{" "}
              {plan.value.tighten.cuts.length} cut{plan.value.tighten.cuts.length === 1 ? "" : "s"}{" "}
              remove {fmt(plan.value.tighten.removed)}
              {plan.value.tighten.widened.length > 0 &&
                ` · ${plan.value.tighten.widened.length} widened by ${fmt(plan.value.tighten.added)}`}{" "}
              · {fmt(plan.value.tighten.durationBefore)} → {fmt(plan.value.tighten.durationAfter)}
            </p>
            <ol className="editor-speech-results" aria-label="Planned pause cuts">
              {plan.value.tighten.cuts.map((cut) => (
                <li key={cut.cut.start}>
                  <span className="editor-speech-time">
                    {fmt(cut.pause.start)}–{fmt(cut.pause.end)}
                  </span>
                  <span>
                    <span className="text-muted-foreground">{cut.pause.before}</span> ▸{" "}
                    <span className="text-muted-foreground">{cut.pause.after}</span>
                  </span>
                  <span className="editor-speech-badge">
                    cut {fmt(cut.cut.end - cut.cut.start)}
                    {cut.kind && mode === "punctuation" ? ` · ${cut.kind}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            {plan.value.tighten.warnings.map((warning) => (
              <FieldDescription key={warning}>{warning}</FieldDescription>
            ))}
            <Missing ids={plan.value.tighten.missing} />
            <Button
              size="sm"
              disabled={
                disabled || !plan.value.tighten.commands.length || !!plan.value.tighten.locked
              }
              onClick={() => {
                setError(null);
                try {
                  const tighten = plan.value!.tighten;
                  session.apply({
                    label: tighten.label,
                    expectedRevision: tighten.revision,
                    commands: tighten.commands,
                  });
                  setDone(`${tighten.label}. One undo restores every track.`);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Apply {plan.value.tighten.commands.length ? "these cuts" : ""}
            </Button>
          </>
        )}
        {done && <p role="status">{done}</p>}
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </div>
  );
}

function CaptionsPanel({ transcripts, disabled }: { transcripts: Transcripts; disabled: boolean }) {
  const { session, snapshot } = useEditorSession();
  const [words, setWords] = useState("3"),
    [y, setY] = useState(""),
    [track, setTrack] = useState("Captions"),
    [error, setError] = useState<string | null>(null),
    [done, setDone] = useState<string | null>(null);
  const plan = useMemo(
    () =>
      attempt(() =>
        planCaptions(
          snapshot,
          { words: Number(words), y: optional(y), track: track.trim() || null },
          transcripts,
        ),
      ),
    [words, y, track, snapshot, transcripts],
  );
  return (
    <div className="editor-speech-panel">
      <FieldGroup>
        <div className="editor-speech-grid">
          <Field>
            <FieldLabel htmlFor="captions-words">Most words on screen</FieldLabel>
            <Input
              id="captions-words"
              type="number"
              min="1"
              max="12"
              step="1"
              value={words}
              onChange={(event) => setWords(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="captions-y">Height (0 top, 1 bottom)</FieldLabel>
            <Input
              id="captions-y"
              type="number"
              min="0"
              max="1"
              step="0.01"
              placeholder="Preset 0.42"
              value={y}
              onChange={(event) => setY(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="captions-track">Track</FieldLabel>
            <Input
              id="captions-track"
              value={track}
              onChange={(event) => setTrack(event.target.value)}
            />
          </Field>
        </div>
        <FieldDescription>
          Captions follow the transcript lane's word rules, use the Word caption preset, and
          highlight each word as it is spoken. A new track follows ripple edits.
        </FieldDescription>
        {plan.error && <FieldError role="alert">{plan.error}</FieldError>}
        {plan.value && (
          <>
            <p role="status">
              {plan.value.captions.length} caption{plan.value.captions.length === 1 ? "" : "s"} on “
              {plan.value.track}”
            </p>
            <ol className="editor-speech-results" aria-label="Planned captions">
              {plan.value.captions.slice(0, 200).map((caption) => (
                <li key={caption.start}>
                  <span className="editor-speech-time">
                    {fmt(caption.start)}–{fmt(caption.end)}
                  </span>
                  <span>{caption.text}</span>
                </li>
              ))}
            </ol>
            {plan.value.warnings.map((warning) => (
              <FieldDescription key={warning}>{warning}</FieldDescription>
            ))}
            <Button
              size="sm"
              disabled={disabled || !plan.value.captions.length}
              onClick={() => {
                setError(null);
                try {
                  const value = plan.value!;
                  session.apply({
                    label: value.label,
                    expectedRevision: value.revision,
                    commands: value.commands,
                  });
                  setDone(`${value.label}. Undo removes them in one step.`);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            >
              Add captions
            </Button>
          </>
        )}
        {done && <p role="status">{done}</p>}
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </div>
  );
}
