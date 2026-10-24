import { useEffect, useMemo, useState, useRef } from "react";
import type { Asset } from "@sidecut/contracts/assets";
import type { ProviderInfo } from "@sidecut/contracts/providers";
import { BrowserAssetProviders, providerBridge } from "@sidecut/platform-browser/asset-providers";
import type { AssetLibrary, LibraryEntry } from "@sidecut/platform-browser/asset-library";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@sidecut/ui/components/field";
export function ProviderBrowser({
  library,
  onStored,
}: {
  library: AssetLibrary;
  onStored: (entry?: LibraryEntry) => void;
}) {
  const service = useMemo(() => new BrowserAssetProviders(library), [library]),
    controller = useRef<AbortController | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]),
    [id, setID] = useState("iconify"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Asset[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [secret, setSecret] = useState(""),
    [prompt, setPrompt] = useState(""),
    [kind, setKind] = useState<"sfx" | "music">("sfx"),
    [duration, setDuration] = useState("2"),
    [variations, setVariations] = useState("1"),
    [loop, setLoop] = useState(false),
    [instrumental, setInstrumental] = useState(true),
    [influence, setInfluence] = useState("0.3"),
    [model, setModel] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const current = providers.find((p) => p.id === id),
    available = current?.status.state === "ready" || current?.status.state === "limited",
    host = Boolean(providerBridge());
  useEffect(() => {
    let active = true;
    void service
      .list()
      .then((v) => {
        if (active) setProviders(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [service]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const work = new AbortController();
    controller.current = work;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(work.signal);
    } catch (e) {
      setError(
        work.signal.aborted
          ? "Cancelled. Completed downloads and generated takes are retained."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      controller.current = null;
      setBusy(false);
      onStored();
      void service
        .list()
        .then(setProviders)
        .catch(() => {});
    }
  };
  const search = (targetPage: number) =>
    run(async (signal) => {
      const result = await service.search(
        id,
        { text: query, page: targetPage, perPage: 20 },
        signal,
      );
      setRows(result);
      setPage(targetPage);
      setNotice(`${result.length} results from ${current?.displayName ?? id}`);
    });
  const change = () => setConfirmed(false);
  return (
    <details className="editor-provider-browser">
      <summary>Browse providers</summary>
      <div className="editor-trim-form">
        <Field>
          <FieldLabel htmlFor="provider-source">Source</FieldLabel>
          <select
            id="provider-source"
            value={id}
            disabled={busy}
            onChange={(e) => {
              setID(e.target.value);
              setRows([]);
              setPage(1);
              setSecret("");
              setError("");
              setConfirmed(false);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </Field>
        <p role="status">
          {current
            ? `${current.status.state}${current.status.message ? `: ${current.status.message}` : ""}`
            : "Loading providers…"}
        </p>
        {current?.rules.notes.map((note) => (
          <FieldDescription key={note}>{note}</FieldDescription>
        ))}
        {host && ["pixabay", "pexels", "freesound", "elevenlabs"].includes(id) && (
          <details>
            <summary>Provider settings</summary>
            <div className="editor-trim-form">
              <Field>
                <FieldLabel htmlFor="provider-credential">API credential</FieldLabel>
                <Input
                  id="provider-credential"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  disabled={busy}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </Field>
              <Button
                size="sm"
                disabled={busy || !secret}
                onClick={() => {
                  const value = secret;
                  setSecret("");
                  void run(async () => {
                    await providerBridge()!.providerCredential(id, "set", value);
                    setNotice("Credential saved with OS encryption.");
                  });
                }}
              >
                Save credential
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await providerBridge()!.providerCredential(id, "clear");
                    setNotice("Credential removed.");
                  })
                }
              >
                Remove credential
              </Button>
              {id === "freesound" && (
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={current?.status.state !== "disabled"}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      void run(async () => {
                        await providerBridge()!.providerCall(crypto.randomUUID(), {
                          operation: "configure",
                          provider: "freesound",
                          enabled,
                        });
                      });
                    }}
                  />{" "}
                  I have permission for this Freesound API use
                </label>
              )}
            </div>
          </details>
        )}
        {["shared", "import"].includes(id) && (
          <Field>
            <FieldLabel htmlFor="provider-folder">Choose folder</FieldLabel>
            <Input
              id="provider-folder"
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void run(async (signal) => {
                  const imported = await service.importFolder(
                    files,
                    id as "shared" | "import",
                    signal,
                  );
                  setNotice(`${imported.length} local assets indexed. Existing assets were kept.`);
                });
              }}
            />
            <FieldDescription>
              Only selected files are read. A nearest tandem-licence.json supplies their terms.
              Browser folders are copied into local storage.
            </FieldDescription>
          </Field>
        )}
        {current?.capabilities.search && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search(1);
            }}
          >
            <Field>
              <FieldLabel htmlFor="provider-query">Search {current.displayName}</FieldLabel>
              <Input
                id="provider-query"
                value={query}
                disabled={busy}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <div className="editor-take-actions">
              <Button size="sm" disabled={busy || !available} type="submit">
                Search provider
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy || page <= 1 || !available}
                onClick={() => void search(page - 1)}
              >
                Previous page
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={busy || !rows.length || !available}
                onClick={() => void search(page + 1)}
              >
                Next page
              </Button>
            </div>
          </form>
        )}
        {current?.capabilities.generate && (
          <div className="editor-trim-form">
            <h4>Generate audio</h4>
            <Field>
              <FieldLabel htmlFor="generation-prompt">Prompt</FieldLabel>
              <textarea
                id="generation-prompt"
                value={prompt}
                maxLength={16000}
                disabled={busy}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  change();
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="generation-kind">Kind</FieldLabel>
              <select
                id="generation-kind"
                value={kind}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value as "sfx" | "music";
                  setKind(value);
                  setDuration(value === "sfx" ? "2" : "10");
                  change();
                }}
              >
                <option value="sfx">Sound effect</option>
                <option value="music">Music</option>
              </select>
            </Field>
            <div className="editor-picture-fields">
              <Field>
                <FieldLabel htmlFor="generation-duration">Duration, seconds</FieldLabel>
                <Input
                  id="generation-duration"
                  type="number"
                  min={kind === "sfx" ? 0.5 : 3}
                  max={kind === "sfx" ? 30 : 600}
                  step="0.1"
                  value={duration}
                  disabled={busy}
                  onChange={(e) => {
                    setDuration(e.target.value);
                    change();
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="generation-variations">Variations</FieldLabel>
                <Input
                  id="generation-variations"
                  type="number"
                  min={1}
                  max={4}
                  value={variations}
                  disabled={busy}
                  onChange={(e) => {
                    setVariations(e.target.value);
                    change();
                  }}
                />
              </Field>
            </div>
            {kind === "sfx" ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={loop}
                    disabled={busy}
                    onChange={(e) => {
                      setLoop(e.target.checked);
                      change();
                    }}
                  />{" "}
                  Seamless loop
                </label>
                <Field>
                  <FieldLabel htmlFor="generation-influence">Prompt influence, 0–1</FieldLabel>
                  <Input
                    id="generation-influence"
                    type="number"
                    min={0}
                    max={1}
                    step="0.1"
                    value={influence}
                    disabled={busy}
                    onChange={(e) => {
                      setInfluence(e.target.value);
                      change();
                    }}
                  />
                </Field>
              </>
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={instrumental}
                  disabled={busy}
                  onChange={(e) => {
                    setInstrumental(e.target.checked);
                    change();
                  }}
                />{" "}
                Instrumental, without vocals
              </label>
            )}
            <Field>
              <FieldLabel htmlFor="generation-model">Model override, optional</FieldLabel>
              <Input
                id="generation-model"
                value={model}
                disabled={busy}
                onChange={(e) => {
                  setModel(e.target.value);
                  change();
                }}
              />
            </Field>
            <FieldDescription>
              {variations || "1"} separate paid request(s). Check{" "}
              <a href="https://elevenlabs.io/pricing" target="_blank" rel="noreferrer">
                current ElevenLabs pricing
              </a>{" "}
              and your plan's terms. Cancellation stops later variations; an in-flight request may
              still be charged.
            </FieldDescription>
            <label>
              <input
                id="generation-confirm"
                type="checkbox"
                checked={confirmed}
                disabled={busy || !available}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I confirm this paid request and variation count
            </label>
            <Button
              size="sm"
              disabled={busy || !available || !confirmed || !prompt.trim()}
              onClick={() =>
                void run(async (signal) => {
                  setConfirmed(false);
                  const result = await service.generate(
                    {
                      kind,
                      prompt,
                      duration: duration ? Number(duration) : undefined,
                      variations: Number(variations),
                      loop,
                      instrumental,
                      promptInfluence: kind === "sfx" && influence ? Number(influence) : undefined,
                      model: model || undefined,
                    },
                    true,
                    signal,
                  );
                  for (const entry of result.entries) onStored(entry);
                  setNotice(
                    `${result.entries.length} take(s) saved.${result.failures.length ? ` ${result.failures.join(" ")}` : ""}`,
                  );
                })
              }
            >
              Generate paid takes
            </Button>
            {host && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    setRows(await service.recoverGenerated(signal));
                    setNotice("Completed takes retained by the desktop host.");
                  })
                }
              >
                Recover generated takes
              </Button>
            )}
          </div>
        )}
        <ul className="editor-asset-results">
          {rows.map((asset) => (
            <li key={asset.id}>
              <strong>{asset.name}</strong>
              <small>
                {asset.id} · {asset.licenceClass}
              </small>
              {asset.creditLine && <small>{asset.creditLine}</small>}
              {asset.pageURL && (
                <a href={asset.pageURL} target="_blank" rel="noreferrer">
                  View source
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    const entry = await service.fetch(asset, signal);
                    onStored(entry);
                    setNotice(`Saved ${entry.asset.name} to the local library.`);
                  })
                }
              >
                Download to library
              </Button>
            </li>
          ))}
        </ul>
        {busy && (
          <Button size="sm" variant="outline" onClick={() => controller.current?.abort()}>
            Cancel provider request
          </Button>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </details>
  );
}
