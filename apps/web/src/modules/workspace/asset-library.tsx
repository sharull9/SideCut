import { useEffect, useRef, useState } from "react";
import type { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { assetKinds, licenceClasses } from "@sidecut/contracts/assets";
import {
  AssetLibrary,
  normalizeAsset,
  libraryState,
  type LibraryEntry,
} from "@sidecut/platform-browser/asset-library";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { projectCredits, creditsText } from "@sidecut/core/asset-use";
import { RiFolderImageLine } from "@remixicon/react";
import { ProviderBrowser } from "./provider-browser";
import { MediaSection } from "./media-section";

export function LocalAssetLibrary() {
  const { session, snapshot } = useEditorSession();
  const [library, setLibrary] = useState<AssetLibrary | null>(null),
    [entries, setEntries] = useState<LibraryEntry[]>([]),
    [selected, setSelected] = useState<LibraryEntry | null>(null);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [filterLicence, setFilterLicence] = useState("");
  const [importKind, setImportKind] = useState("image"),
    [licenceClass, setLicenceClass] = useState("unknown"),
    [credit, setCredit] = useState(""),
    [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [licence, setLicence] = useState<File | undefined>(),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [optionalCredits, setOptionalCredits] = useState(false);
  const credits = projectCredits(
    snapshot.project,
    entries.map((e) => e.asset),
  );
  const preview = useRef<HTMLCanvasElement>(null);
  const disabled = busy || snapshot.busy || snapshot.readOnly;
  useEffect(() => {
    let active = true,
      store: AssetLibrary | undefined;
    void AssetLibrary.open()
      .then((v) => {
        store = v;
        if (active) setLibrary(v);
        else v.close();
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      store?.close();
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (library)
      void library
        .entries(query, kind, filterLicence)
        .then((v) => {
          if (active) setEntries(v);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [library, query, kind, filterLicence, version]);
  useEffect(() => {
    let active = true,
      reader: LocalMediaReader | undefined;
    const canvas = preview.current;
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (
      selected?.normalised &&
      ["image", "icon", "logo", "sticker", "overlay"].includes(selected.asset.kind)
    )
      void import("@sidecut/platform-browser/preview")
        .then(async ({ LocalMediaReader }) => {
          reader = await LocalMediaReader.open(selected.normalised!, "image");
          if (!active) {
            reader.close();
            return;
          }
          const frame = await reader.frame(0);
          if (active && frame && canvas) {
            canvas.width = frame.width;
            canvas.height = frame.height;
            canvas.getContext("2d")?.drawImage(frame.canvas, 0, 0);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
      reader?.close();
    };
  }, [selected]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (!file || !library) throw new Error("Choose an asset file first.");
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const previous = await library.get(`local:${digest}`);
      if (previous?.normalised)
        throw new Error("This asset is already in the library. Select it from the list.");
      const entry = await normalizeAsset(
        file,
        {
          provider: "local",
          providerID: digest,
          kind: importKind,
          name: file.name,
          tags: tags
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          licenceClass,
          creditLine: credit.trim() || undefined,
        },
        licence,
      );
      await library.put(entry);
      setSelected(entry);
      setVersion((v) => v + 1);
      setNotice("Imported into the local library.");
    });
  const use = () =>
    run(async () => {
      if (!selected) return;
      const result = await session.useLibraryAsset(selected);
      setNotice(
        "mediaID" in result
          ? "Added to Project media. Place it on a video track to preview or export."
          : "font" in result
            ? `Font registered: ${result.font}. Choose it in the Text inspector.`
            : `LUT imported: ${result.lut}. Choose it in the Effects inspector.`,
      );
    });
  return (
    <MediaSection
      icon={<RiFolderImageLine aria-hidden="true" />}
      title="Local asset library"
      count={entries.length}
    >
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !library}
          onClick={() =>
            void run(async () => {
              const { starterAssets } = await import("@sidecut/platform-browser/starter");
              await library!.mergeRemote(starterAssets());
              setVersion((v) => v + 1);
              setNotice("Starter catalogue installed. Existing assets and files were kept.");
            })
          }
        >
          Install starter catalogue
        </Button>
        <details>
          <summary>Project credits</summary>
          <div className="editor-trim-form">
            <label>
              <input
                type="checkbox"
                checked={optionalCredits}
                onChange={(e) => setOptionalCredits(e.target.checked)}
              />{" "}
              Include courtesy credits
            </label>
            <textarea
              aria-label="Project credit text"
              readOnly
              rows={6}
              value={
                creditsText(credits, optionalCredits) ||
                "No credit lines recorded for the current project."
              }
            />
            <ul>
              {credits.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p>{credits.assets.length} credited resource(s)</p>
          </div>
        </details>
        {library && (
          <ProviderBrowser
            library={library}
            onStored={(entry) => {
              setVersion((v) => v + 1);
              if (entry) setSelected(entry);
            }}
          />
        )}
        <FieldDescription>
          Stored in this browser across projects. Original files and licence companions stay
          together.
        </FieldDescription>
        <Field>
          <FieldLabel htmlFor="asset-search">Search library</FieldLabel>
          <Input
            id="asset-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, source or tags"
          />
        </Field>
        <div className="editor-picture-fields">
          <Field>
            <FieldLabel htmlFor="asset-filter-kind">Kind</FieldLabel>
            <select id="asset-filter-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {assetKinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="asset-filter-licence">Licence</FieldLabel>
            <select
              id="asset-filter-licence"
              value={filterLicence}
              onChange={(e) => setFilterLicence(e.target.value)}
            >
              <option value="">All licences</option>
              {licenceClasses.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {!entries.length ? (
          <p>{library ? "No matching assets. Import a local file below." : "Opening library…"}</p>
        ) : (
          <ul className="editor-asset-results">
            {entries.map((entry) => (
              <li key={entry.asset.id}>
                <Button
                  size="sm"
                  variant={selected?.asset.id === entry.asset.id ? "secondary" : "ghost"}
                  onClick={() => {
                    setSelected(entry);
                    setError(null);
                  }}
                >
                  {entry.asset.name}
                </Button>
                <small>
                  {entry.asset.kind} · {libraryState(entry)}
                </small>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <section aria-label="Asset details">
            <h3>{selected.asset.name}</h3>
            <canvas
              ref={preview}
              aria-label="Asset first frame"
              className="editor-asset-preview"
              width={256}
              height={144}
            />
            <dl className="editor-asset-details">
              {[
                ["Source", selected.asset.id],
                ["Kind", selected.asset.kind],
                ["Licence", selected.asset.licenceClass],
                ["Credit", selected.asset.creditLine ?? "No credit line recorded"],
                ["Tags", selected.asset.tags.join(", ") || "None"],
                ["Resource", selected.asset.files.normalised ?? "Missing file"],
                [
                  "Duration",
                  selected.asset.duration ? `${selected.asset.duration.toFixed(3)} s` : "Static",
                ],
                ["Licence file", selected.licence?.name ?? "Not supplied"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !selected.normalised}
              onClick={() => void use()}
            >
              Use in project
            </Button>
          </section>
        )}
        <details>
          <summary>Import asset</summary>
          <div className="editor-trim-form">
            <Field>
              <FieldLabel htmlFor="asset-import-kind">Import as</FieldLabel>
              <select
                id="asset-import-kind"
                value={importKind}
                disabled={disabled}
                onChange={(e) => setImportKind(e.target.value)}
              >
                {["image", "icon", "logo", "sticker", "overlay", "font", "lut"].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-file">Asset file</FieldLabel>
              <Input
                id="asset-file"
                type="file"
                disabled={disabled}
                accept="image/*,.svg,.json,.ttf,.otf,.woff,.woff2,.cube"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-licence-file">Licence file, required for fonts</FieldLabel>
              <Input
                id="asset-licence-file"
                type="file"
                disabled={disabled}
                accept="text/*,.txt,.md,.pdf"
                onChange={(e) => setLicence(e.target.files?.[0])}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-import-licence">Licence terms</FieldLabel>
              <select
                id="asset-import-licence"
                value={licenceClass}
                disabled={disabled}
                onChange={(e) => setLicenceClass(e.target.value)}
              >
                {licenceClasses.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-credit">Credit line</FieldLabel>
              <Input
                id="asset-credit"
                value={credit}
                disabled={disabled}
                onChange={(e) => setCredit(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="asset-tags">Tags, separated by commas</FieldLabel>
              <Input
                id="asset-tags"
                value={tags}
                disabled={disabled}
                onChange={(e) => setTags(e.target.value)}
              />
            </Field>
            <FieldDescription>
              SVG and images become PNG. Animated GIF/WebP/PNG and self-contained Lottie JSON keep
              alpha and timing. Font imports keep their licence file. Unknown licence terms stay
              marked unknown.
            </FieldDescription>
            <Button size="sm" disabled={disabled || !library || !file} onClick={() => void save()}>
              {busy ? "Importing…" : "Import to library"}
            </Button>
          </div>
        </details>
        {notice && <p role="status">{notice}</p>}
        {error && <FieldError>{error}</FieldError>}
      </>
    </MediaSection>
  );
}
