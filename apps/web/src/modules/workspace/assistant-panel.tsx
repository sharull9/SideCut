import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RiAddLine, RiRobot2Line, RiSendPlane2Line, RiStopLine } from "@remixicon/react";
import { useEveAgent, type EveMessagePart, type EveToolPart } from "eve/react";
import { Button } from "@sidecut/ui/components/button";
import { Tip } from "@sidecut/ui/components/tooltip";
import { Field, FieldDescription, FieldLabel } from "@sidecut/ui/components/field";
import { Input } from "@sidecut/ui/components/input";
import { OptionSelect, SelectItem } from "@sidecut/ui/components/option-select";
import { Textarea } from "@sidecut/ui/components/textarea";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@sidecut/ui/components/empty";
import { useEditorSession } from "./editor-session";
import {
  assistantBridge,
  type AssistantBridge,
  type AssistantSettings,
  type Connection,
} from "./assistant-bridge";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", example: "claude-sonnet-5-5" },
  { id: "openai", label: "OpenAI", example: "gpt-6-luna-fast" },
  { id: "openrouter", label: "OpenRouter", example: "anthropic/claude-sonnet-5.5" },
] as const;
const providerLabel = (id: string) => PROVIDERS.find((p) => p.id === id)?.label ?? id;
const SESSION_KEY = "sidecut.assistant.session";

export function AssistantPanel({ hideButton }: { hideButton?: ReactNode }) {
  const bridge = assistantBridge();
  const [connection, setConnection] = useState<Connection | "connecting">("connecting");
  const [settings, setSettings] = useState<AssistantSettings>({
    provider: null,
    model: null,
    keys: [],
  });
  const [editing, setEditing] = useState(false);
  const connect = useCallback(async () => {
    if (!bridge) return;
    setConnection("connecting");
    try {
      const [next, saved] = await Promise.all([
        bridge.assistantConnect(),
        bridge.assistantSettings(),
      ]);
      setSettings(saved);
      setConnection(next);
    } catch (error) {
      setConnection({
        status: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [bridge]);
  useEffect(() => {
    void connect();
  }, [connect]);

  const ready = typeof connection === "object" && connection.status === "ready" ? connection : null;
  return (
    <section aria-labelledby="assistant-title" className="editor-panel editor-side-section">
      <div className="editor-panel-heading">
        <h2 id="assistant-title">Assistant</h2>
        {ready && !editing && (
          <Tip label={`${providerLabel(ready.provider)} · ${ready.model}`}>
            <span className="editor-assistant-model">{ready.model}</span>
          </Tip>
        )}
        {ready && (
          <Button size="xs" variant="ghost" onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel" : "Settings"}
          </Button>
        )}
        {hideButton}
      </div>
      {!bridge ? (
        <AssistantEmpty title="Desktop only">
          The assistant runs in the raE.E desktop app, next to your project.
        </AssistantEmpty>
      ) : connection === "connecting" ? (
        <p role="status" className="editor-assistant-status">
          Starting the assistant…
        </p>
      ) : connection.status === "unavailable" && !editing ? (
        <div className="editor-assistant-status" role="alert">
          <p>{connection.message}</p>
          <div className="editor-assistant-actions">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Settings
            </Button>
            <Button size="sm" variant="outline" onClick={() => void connect()}>
              Try again
            </Button>
          </div>
        </div>
      ) : connection.status === "needs-setup" || editing ? (
        <AssistantSetup
          bridge={bridge}
          settings={settings}
          onSaved={async () => {
            setEditing(false);
            await connect();
          }}
        />
      ) : connection.status === "ready" ? (
        <AssistantChat key={`${connection.baseUrl}#${connection.token}`} connection={connection} />
      ) : null}
    </section>
  );
}

function AssistantEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="editor-panel-content editor-side-scroll">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RiRobot2Line aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

/** The user chooses the provider and model and gives that provider's key. Nothing is picked for them. */
function AssistantSetup({
  bridge,
  settings,
  onSaved,
}: {
  bridge: AssistantBridge;
  settings: AssistantSettings;
  onSaved: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<string>(settings.provider ?? "");
  const [model, setModel] = useState(settings.model ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keySaved = settings.keys.includes(provider);
  const example = PROVIDERS.find((p) => p.id === provider)?.example;
  const canSave =
    Boolean(provider) && Boolean(model.trim()) && (keySaved || Boolean(secret.trim()));
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="editor-panel-content editor-side-scroll editor-assistant-keys"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        const key = secret.trim();
        setSecret("");
        void act(async () => {
          if (key) await bridge.providerCredential(provider, "set", key);
          await bridge.assistantConfigure({ provider, model: model.trim() });
        });
      }}
    >
      <p>
        Set up the assistant with your own model provider. It edits this project through the same
        tools as the CLI and MCP server, and asks before applying changes.
      </p>
      <Field>
        <FieldLabel htmlFor="assistant-provider">Provider</FieldLabel>
        <OptionSelect
          id="assistant-provider"
          value={provider}
          placeholder="Choose a provider"
          disabled={busy}
          onValueChange={(value) => {
            // A model ID belongs to one provider, so switching clears it.
            if (value !== provider)
              setModel(value === settings.provider ? (settings.model ?? "") : "");
            setProvider(value);
            setSecret("");
          }}
        >
          {PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </OptionSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="assistant-model">Model</FieldLabel>
        <Input
          id="assistant-model"
          autoComplete="off"
          spellCheck={false}
          value={model}
          disabled={busy || !provider}
          placeholder={example ? `e.g. ${example}` : "Choose a provider first"}
          onChange={(event) => setModel(event.target.value)}
        />
        <FieldDescription>The model ID exactly as your provider lists it.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="assistant-key">API key</FieldLabel>
        <Input
          id="assistant-key"
          type="password"
          autoComplete="off"
          value={secret}
          disabled={busy || !provider}
          placeholder={keySaved ? "Saved. Enter a new key to replace it" : undefined}
          onChange={(event) => setSecret(event.target.value)}
        />
        <FieldDescription>Stored with your system's encryption.</FieldDescription>
      </Field>
      <div className="editor-assistant-actions">
        {keySaved && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() => void act(() => bridge.providerCredential(provider, "clear"))}
          >
            Remove {providerLabel(provider)} key
          </Button>
        )}
        <Button size="sm" type="submit" disabled={busy || !canSave}>
          Save
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function savedSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return value && typeof value.sessionId === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function AssistantChat({ connection }: { connection: Extract<Connection, { status: "ready" }> }) {
  const { snapshot } = useEditorSession();
  const revision = useRef(snapshot.revision);
  revision.current = snapshot.revision;
  const [initialSession] = useState(savedSession);
  const agent = useEveAgent({
    baseUrl: connection.baseUrl,
    headers: { authorization: `Bearer ${connection.token}` },
    ...(initialSession ? { initialSession, resume: true } : {}),
    // Tell the model which revision the user is looking at, without saving it to history.
    prepareSend: (input) => ({ ...input, clientContext: { projectRevision: revision.current } }),
    onSessionChange: (session) => {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    },
  });
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [agent.messages]);
  const resuming = agent.status === "resuming";
  // "busy" while a turn runs; a turn waiting only on an approval reads "idle", so Send stays.
  const working = agent.status === "busy";
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || resuming) return;
    setDraft("");
    void agent.send(message);
  };
  return (
    <>
      <div
        ref={scroller}
        className="editor-panel-content editor-side-scroll editor-assistant-log"
        role="log"
        aria-label="Assistant conversation"
        aria-live="polite"
        tabIndex={0}
      >
        {agent.messages.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiRobot2Line aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Ask for an edit</EmptyTitle>
              <EmptyDescription>
                Try “Remove pauses longer than half a second” or “Add captions to the intro”.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          agent.messages.map((message) => (
            <article
              key={message.id}
              className="editor-assistant-message"
              data-role={message.role}
              data-failed={message.metadata?.status === "failed" || undefined}
            >
              {message.parts.map((part, index) => (
                <MessagePart
                  key={partKey(part, index)}
                  part={part}
                  disabled={resuming}
                  respond={(interactionId, optionId) =>
                    void agent.respond([{ interactionId, optionId }])
                  }
                />
              ))}
            </article>
          ))
        )}
        {agent.error && (
          <p role="alert" className="editor-assistant-error">
            {agent.error.message}
          </p>
        )}
      </div>
      <form className="editor-assistant-compose" onSubmit={submit}>
        <Textarea
          aria-label="Message the assistant"
          placeholder="Ask the assistant to edit…"
          value={draft}
          rows={2}
          disabled={resuming}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // The editor's window shortcuts must not fire while typing a message.
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)
              submit(event);
          }}
        />
        <div className="editor-assistant-actions">
          <Tip label="New conversation">
            <Button
              size="icon-sm"
              variant="ghost"
              type="button"
              aria-label="New conversation"
              disabled={resuming}
              onClick={() => agent.newSession()}
            >
              <RiAddLine aria-hidden="true" />
            </Button>
          </Tip>
          {working ? (
            <Button size="sm" variant="outline" type="button" onClick={() => void agent.cancel()}>
              <RiStopLine aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button size="sm" type="submit" disabled={resuming || !draft.trim()}>
              <RiSendPlane2Line aria-hidden="true" />
              Send
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

function partKey(part: EveMessagePart, index: number) {
  if (part.type === "tool") return part.callId;
  if (part.type === "interaction") return part.interactionId;
  return ("id" in part && part.id) || `${part.type}-${index}`;
}

function MessagePart({
  part,
  disabled,
  respond,
}: {
  part: EveMessagePart;
  disabled: boolean;
  respond: (interactionId: string, optionId: string) => void;
}) {
  if (part.type === "text") return <p className="editor-assistant-text">{part.text}</p>;
  if (part.type === "tool")
    return part.hidden ? null : <ToolActivity part={part} disabled={disabled} respond={respond} />;
  if (part.type === "interaction" && part.status === "open")
    return (
      <Approval
        prompt={part.request.prompt}
        options={part.request.options ?? []}
        disabled={disabled || part.answer !== undefined}
        onAnswer={(optionId) => respond(part.interactionId, optionId)}
      />
    );
  return null;
}

const TOOL_STATE: Partial<Record<EveToolPart["state"], string>> = {
  streaming: "Preparing",
  requested: "Waiting",
  approval: "Needs approval",
  running: "Running",
  blocked: "Waiting",
  failed: "Failed",
  rejected: "Declined",
  cancelled: "Cancelled",
};

function ToolActivity({
  part,
  disabled,
  respond,
}: {
  part: EveToolPart;
  disabled: boolean;
  respond: (interactionId: string, optionId: string) => void;
}) {
  const open = part.interaction?.status === "open" ? part.interaction : undefined;
  return (
    <div className="editor-assistant-tool" data-state={part.state}>
      <span className="editor-side-text">{part.label}</span>
      {TOOL_STATE[part.state] && <span className="editor-side-meta">{TOOL_STATE[part.state]}</span>}
      {part.state === "failed" && part.error?.message && (
        <span className="editor-assistant-error">{part.error.message}</span>
      )}
      {open && (
        <Approval
          prompt={open.request.prompt}
          options={open.request.options ?? []}
          disabled={disabled || open.answer !== undefined}
          onAnswer={(optionId) => respond(open.interactionId, optionId)}
          input={part.input}
        />
      )}
    </div>
  );
}

function Approval({
  prompt,
  options,
  disabled,
  onAnswer,
  input,
}: {
  prompt: string;
  options: readonly { id: string; label: string }[];
  disabled: boolean;
  onAnswer: (optionId: string) => void;
  input?: unknown;
}) {
  return (
    <fieldset className="editor-assistant-approval" disabled={disabled}>
      <legend>{prompt}</legend>
      {input !== undefined && (
        <details>
          <summary>Details</summary>
          <pre>{JSON.stringify(input, null, 2)}</pre>
        </details>
      )}
      <div className="editor-assistant-actions">
        {options.map((option) => (
          <Button
            key={option.id}
            size="xs"
            variant={option.id === "approve" ? "default" : "outline"}
            type="button"
            onClick={() => onAnswer(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
