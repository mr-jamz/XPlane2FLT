import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Obj8Preview } from "./Obj8Preview";
import { convertArchive, inspectArchive } from "./core/archive";
import { downloadBytes } from "./core/download";
import { estimateOptimizedTriangles } from "./core/optimizer";
import { removeExtension, safeFileStem } from "./core/path";
import type { ArchiveInspection, ConversionOptions, ConversionResult, Diagnostic } from "./core/types";

type AppStage = "select" | "inspecting" | "ready" | "converting" | "complete";

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

const EXTERIOR_HINT = /(^|[\/_\-.])(exteriors?|fuselage|fuse|body|hull|wings?|tail|stabilizers?|rudders?|elevators?|ailerons?|flaps?|slats?|spoilers?|doors?|canopy|windows?|external[-_ ]?glass|engines?|nacelles?|cowlings?|gears?|wheels?|tires?|rotors?|props?|hook|ramp|light[s]?[-_ ]?out|antennas?|radome|probe|basket|flircam|flir|sensors?|esss|ball|rope[-_ ]?mount)([\/_\-.]|\d|$)/i;
const INTERIOR_HINT = /(^|[\/_\-.])(cockpit|interior|inside|cabin|panel|dash|seat|pilot|crew|pax|passenger|avionics|cdu|compass|medevac|vip|potus|toilet|galley)([\/_\-.]|\d|$)|\/(weapons|scenery|slungload|particles)\//i;

function suggestedExteriorPaths(inspection: ArchiveInspection): string[] {
  const positive = inspection.models.filter((model) => EXTERIOR_HINT.test(model.path) && !INTERIOR_HINT.test(model.path));
  const candidates = positive.length > 0 ? positive : inspection.models.filter((model) => !INTERIOR_HINT.test(model.path));
  return candidates.filter((model) => model.triangles.length > 0).map((model) => model.path);
}

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <li className={`diagnostic diagnostic--${diagnostic.severity}`}>
      <span className="diagnostic__marker" aria-hidden="true">
        {diagnostic.severity === "error" ? "×" : diagnostic.severity === "warning" ? "!" : "i"}
      </span>
      <span>
        <strong>{diagnostic.code.replaceAll("_", " ")}</strong>
        {diagnostic.file && <small>{diagnostic.file}</small>}
        <span>{diagnostic.message}</span>
      </span>
    </li>
  );
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<AppStage>("select");
  const [dragging, setDragging] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<ArchiveInspection | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [options, setOptions] = useState<ConversionOptions>({
    outputName: "aircraft",
    coordinateMode: "openflight-z-up",
    includeUnreferencedTextures: false,
    selectedModelPaths: [],
    optimization: {
      preset: "balanced", targetTriangles: 120_000, minTrianglesPerPart: 750,
      preserveThinParts: true, weldVertices: true, removeDegenerateFaces: true,
      removeDuplicateFaces: true, textureMaxSize: 0,
    },
  });

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setFatalError("Select a .zip archive containing an X-Plane 12 aircraft folder.");
      return;
    }
    setFatalError(null);
    setResult(null);
    setSourceFile(file);
    setStage("inspecting");
    try {
      const nextInspection = await inspectArchive(file, file.name);
      setInspection(nextInspection);
      setOptions((current) => ({
        ...current,
        outputName: safeFileStem(nextInspection.rootName || removeExtension(file.name)),
        selectedModelPaths: suggestedExteriorPaths(nextInspection),
      }));
      setStage("ready");
    } catch (error) {
      setInspection(null);
      setStage("select");
      setFatalError(error instanceof Error ? error.message : String(error));
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  };

  const runConversion = async () => {
    if (!sourceFile || !inspection) return;
    setFatalError(null);
    setStage("converting");
    try {
      const nextResult = await convertArchive(sourceFile, inspection, options);
      setResult(nextResult);
      setStage("complete");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
      setStage("ready");
    }
  };

  const reset = () => {
    setStage("select");
    setSourceFile(null);
    setInspection(null);
    setResult(null);
    setFatalError(null);
  };

  const blockingErrors = inspection?.diagnostics.some((diagnostic) => diagnostic.severity === "error") ?? false;
  const warnings = inspection?.diagnostics.filter((diagnostic) => diagnostic.severity !== "info") ?? [];
  const selectedSet = new Set(options.selectedModelPaths);
  const selectedModels = inspection?.models.filter((model) => selectedSet.has(model.path)) ?? [];
  const selectedTriangles = selectedModels.reduce((sum, model) => sum + model.triangles.length, 0);
  const estimatedOptimizedTriangles = estimateOptimizedTriangles(selectedModels, options.optimization);
  const ratio = selectedTriangles ? estimatedOptimizedTriangles / selectedTriangles : 1;
  const estimatedVertices = selectedModels.reduce((sum, model) => sum + model.vertices.length, 0) * Math.min(1, Math.max(.08, ratio));
  const estimatedFltBytes = 1_000 + estimatedVertices * 64 + estimatedOptimizedTriangles * 104 + selectedModels.length * 36;

  const toggleModel = (path: string) => setOptions((current) => ({
    ...current,
    selectedModelPaths: current.selectedModelPaths.includes(path)
      ? current.selectedModelPaths.filter((item) => item !== path)
      : [...current.selectedModelPaths, path],
  }));

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="XPlane2FLT home">
          <span className="brand__mark" aria-hidden="true">X2F</span>
          <span>
            <strong>XPlane2FLT</strong>
            <small>Local OpenFlight converter</small>
          </span>
        </a>
        <div className="topbar__status">
          <span className="status-dot" aria-hidden="true" />
          Private by design
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">X-Plane 12 → OpenFlight 16.0</p>
            <h1>Convert aircraft geometry without uploading a thing.</h1>
            <p className="hero__lede">
              Inspect an aircraft ZIP, translate OBJ8 meshes to a real binary <code>.flt</code>, and package the original textures beside it—all inside your browser.
            </p>
          </div>
          <ol className="process" aria-label="Conversion process">
            {[
              ["01", "Inspect"],
              ["02", "Convert"],
              ["03", "Validate"],
              ["04", "Export"],
            ].map(([number, label], index) => (
              <li key={number} className={stage === "select" ? (index === 0 ? "is-current" : "") : index <= (stage === "complete" ? 3 : stage === "converting" ? 1 : 0) ? "is-current" : ""}>
                <span>{number}</span>{label}
              </li>
            ))}
          </ol>
        </section>

        <section className="workspace" aria-live="polite">
          <div className="workspace__header">
            <div>
              <p className="section-kicker">Conversion workspace</p>
              <h2>{sourceFile ? sourceFile.name : "Choose an aircraft archive"}</h2>
            </div>
            {sourceFile && <button className="button button--quiet" onClick={reset}>Start over</button>}
          </div>

          {(stage === "select" || stage === "inspecting") && (
            <div
              className={`dropzone ${dragging ? "is-dragging" : ""} ${stage === "inspecting" ? "is-busy" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={inputRef} type="file" accept=".zip,application/zip" onChange={onFileChange} hidden />
              <span className="dropzone__icon" aria-hidden="true">{stage === "inspecting" ? "···" : "ZIP"}</span>
              <h3>{stage === "inspecting" ? "Inspecting aircraft assets…" : "Drop an X-Plane aircraft ZIP here"}</h3>
              <p>{stage === "inspecting" ? "Reading OBJ8 geometry and tracing texture references." : "The archive never leaves this device."}</p>
              {stage !== "inspecting" && (
                <button className="button button--primary" onClick={() => inputRef.current?.click()}>Select aircraft ZIP</button>
              )}
              <div className="format-row" aria-label="Recognized source assets">
                <span>ACF</span><span>OBJ8</span><span>PNG</span><span>DDS</span><span>ATTR</span>
              </div>
            </div>
          )}

          {inspection && stage !== "select" && stage !== "inspecting" && (
            <div className="results-grid">
              <div className="results-main">
                <div className="metric-grid">
                  <article><span>Objects</span><strong>{formatNumber(inspection.models.length)}</strong></article>
                  <article><span>Triangles</span><strong>{formatNumber(inspection.totals.triangles)}</strong></article>
                  <article><span>Textures</span><strong>{formatNumber(inspection.textureFiles.length)}</strong></article>
                  <article><span>Archive</span><strong>{formatBytes(inspection.totals.sourceBytes)}</strong></article>
                </div>

                <section className="panel">
                  <div className="panel__heading">
                    <div><p className="section-kicker">Exterior selection</p><h3>{selectedModels.length} of {inspection.models.length} OBJ8 meshes</h3></div>
                    <div className="selection-actions">
                      <button type="button" onClick={() => setOptions({ ...options, selectedModelPaths: suggestedExteriorPaths(inspection) })}>Exterior only</button>
                      <button type="button" onClick={() => setOptions({ ...options, selectedModelPaths: inspection.models.filter((model) => model.triangles.length > 0).map((model) => model.path) })}>All</button>
                      <button type="button" onClick={() => setOptions({ ...options, selectedModelPaths: [] })}>None</button>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Use</th><th>Object</th><th>Vertices</th><th>Triangles</th><th>Diffuse texture</th></tr></thead>
                      <tbody>
                        {inspection.models.map((model) => (
                          <tr key={model.path} className={selectedSet.has(model.path) ? "is-selected" : ""}>
                            <td><input className="model-check" type="checkbox" checked={selectedSet.has(model.path)} onChange={() => toggleModel(model.path)} aria-label={`Include ${model.name}`} /></td>
                            <td title={model.path}>{model.name}</td>
                            <td>{formatNumber(model.vertices.length)}</td>
                            <td>{formatNumber(model.triangles.length)}</td>
                            <td className={model.texturePath ? "" : "muted"}>{model.texturePath?.split("/").pop() ?? "None"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {sourceFile && (
                  <Obj8Preview
                    sourceFile={sourceFile}
                    models={selectedModels}
                    onToggleModel={toggleModel}
                  />
                )}

                {warnings.length > 0 && (
                  <section className="panel">
                    <div className="panel__heading"><div><p className="section-kicker">Preflight report</p><h3>{warnings.length} item{warnings.length === 1 ? "" : "s"} to review</h3></div></div>
                    <ul className="diagnostics">{warnings.map((diagnostic, index) => <DiagnosticRow key={`${diagnostic.code}-${diagnostic.file}-${index}`} diagnostic={diagnostic} />)}</ul>
                  </section>
                )}
              </div>

              <aside className="export-card">
                <p className="section-kicker">Export settings</p>
                <h3>OpenFlight package</h3>

                <label>
                  Output name
                  <input
                    value={options.outputName}
                    onChange={(event) => setOptions({ ...options, outputName: event.target.value })}
                    spellCheck={false}
                  />
                </label>

                <label>
                  Coordinates
                  <select value={options.coordinateMode} onChange={(event) => setOptions({ ...options, coordinateMode: event.target.value as ConversionOptions["coordinateMode"] })}>
                    <option value="openflight-z-up">OpenFlight Z-up (recommended)</option>
                    <option value="keep-xplane">Keep X-Plane axes</option>
                  </select>
                </label>

                <div className="settings-section">
                  <div className="settings-section__heading"><span>Geometry optimization</span><small>Every selected part is retained</small></div>
                  <label>
                    Detail preset
                    <select
                      value={options.optimization.preset}
                      onChange={(event) => {
                        const preset = event.target.value as ConversionOptions["optimization"]["preset"];
                        const targets = { original: selectedTriangles, balanced: 120_000, performance: 65_000, aggressive: 35_000, custom: options.optimization.targetTriangles };
                        setOptions({ ...options, optimization: { ...options.optimization, preset, targetTriangles: targets[preset] } });
                      }}
                    >
                      <option value="original">Original geometry</option>
                      <option value="balanced">Balanced · ~120k triangles</option>
                      <option value="performance">Performance · ~65k triangles</option>
                      <option value="aggressive">Aggressive · ~35k triangles</option>
                      <option value="custom">Custom target</option>
                    </select>
                  </label>
                  <label className="range-label">
                    <span><span>Target triangles</span><strong>{formatNumber(Math.min(selectedTriangles, estimatedOptimizedTriangles))}</strong></span>
                    <input
                      type="range"
                      min={Math.min(selectedTriangles, Math.max(5_000, selectedModels.length * options.optimization.minTrianglesPerPart))}
                      max={Math.max(5_001, selectedTriangles)}
                      step={1_000}
                      value={Math.min(selectedTriangles, Math.max(5_000, options.optimization.targetTriangles))}
                      disabled={options.optimization.preset === "original" || selectedTriangles < 5_001}
                      onChange={(event) => setOptions({ ...options, optimization: { ...options.optimization, preset: "custom", targetTriangles: Number(event.target.value) } })}
                    />
                  </label>
                  <label>
                    Minimum per part
                    <input type="number" min={4} max={10_000} step={100} value={options.optimization.minTrianglesPerPart}
                      onChange={(event) => setOptions({ ...options, optimization: { ...options.optimization, minTrianglesPerPart: Math.max(4, Number(event.target.value) || 4) } })} />
                  </label>
                  {[
                    ["preserveThinParts", "Preserve thin parts", "Protects blades, gear, probes, and antennas."],
                    ["weldVertices", "Weld duplicate vertices", "Merges identical vertices without crossing UV seams or hard edges."],
                    ["removeDegenerateFaces", "Remove invisible faces", "Drops zero-area and collapsed triangles."],
                    ["removeDuplicateFaces", "Remove duplicate faces", "Removes repeated triangles while keeping every part."],
                  ].map(([key, title, description]) => (
                    <label className="checkbox-row checkbox-row--compact" key={key}>
                      <input type="checkbox" checked={Boolean(options.optimization[key as keyof typeof options.optimization])}
                        onChange={(event) => setOptions({ ...options, optimization: { ...options.optimization, [key]: event.target.checked } })} />
                      <span><strong>{title}</strong><small>{description}</small></span>
                    </label>
                  ))}
                  <label>
                    Maximum texture size
                    <select value={options.optimization.textureMaxSize}
                      onChange={(event) => setOptions({ ...options, optimization: { ...options.optimization, textureMaxSize: Number(event.target.value) as ConversionOptions["optimization"]["textureMaxSize"] } })}>
                      <option value={0}>Keep original textures</option>
                      <option value={4096}>4K maximum</option>
                      <option value={2048}>2K maximum</option>
                      <option value={1024}>1K maximum</option>
                    </select>
                    <small className="field-help">PNG/JPEG textures resize locally. DDS stays unchanged for MCX compatibility.</small>
                  </label>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={options.includeUnreferencedTextures}
                    onChange={(event) => setOptions({ ...options, includeUnreferencedTextures: event.target.checked })}
                  />
                  <span><strong>Include every texture</strong><small>Also copy textures not referenced by an OBJ8 file.</small></span>
                </label>

                <div className="export-note">
                  <span aria-hidden="true">✓</span>
                  <p><strong>Stationary geometry guard.</strong> Export stops if a face, coordinate, UV, normal, object bound, texture, or material relationship changes unexpectedly.</p>
                </div>

                <div className="export-summary">
                  <span>{selectedModels.length} exterior objects</span>
                  <span>{formatNumber(selectedTriangles)} → ≈ {formatNumber(estimatedOptimizedTriangles)} triangles</span>
                  <span>≈ {formatBytes(estimatedFltBytes)} FLT</span>
                </div>

                {stage !== "complete" && (
                  <button className="button button--primary button--full" disabled={blockingErrors || stage === "converting" || !options.outputName.trim() || selectedModels.length === 0} onClick={() => void runConversion()}>
                    {stage === "converting" ? "Building OpenFlight package…" : blockingErrors ? "Resolve blocking errors" : "Convert aircraft"}
                  </button>
                )}

                {stage === "complete" && result && (
                  <div className="complete-box">
                    <span className="complete-box__icon" aria-hidden="true">✓</span>
                    <h4>Package validated</h4>
                    <p>{formatNumber(result.optimization.originalTriangles)} → {formatNumber(result.triangleCount)} triangles across {result.objectCount} parts, with {result.textureCount} texture files.</p>
                    <button className="button button--primary button--full" onClick={() => downloadBytes(result.packageZip, result.packageFileName, "application/zip")}>Download texture-complete ZIP</button>
                    <button className="button button--secondary button--full" onClick={() => downloadBytes(result.flt, result.fltFileName, "model/vnd.openflight")}>Download .FLT only</button>
                  </div>
                )}
              </aside>
            </div>
          )}

          {fatalError && <div className="fatal-error" role="alert"><strong>Couldn’t continue</strong><span>{fatalError}</span></div>}
        </section>

        <section className="privacy-strip">
          <div><span aria-hidden="true">⌁</span><p><strong>Local processing</strong><small>ZIP extraction, geometry conversion, validation, and packaging run in your browser.</small></p></div>
          <div><span aria-hidden="true">◇</span><p><strong>OpenFlight 16.0</strong><small>Big-endian binary records with vertex normals, UVs, faces, and texture palette references.</small></p></div>
          <div><span aria-hidden="true">↗</span><p><strong>MCX material-safe</strong><small>White texture modulation, material palettes, UV seams, transparency, culling, and surface state are preserved.</small></p></div>
        </section>
      </main>

      <footer>
        <span>XPlane2FLT · MIT licensed</span>
        <a href="https://github.com/mr-jamz/XPlane2FLT" target="_blank" rel="noreferrer">View source on GitHub</a>
      </footer>
    </div>
  );
}

export default App;
