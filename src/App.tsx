import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  FileArchive,
  FileDown,
  FolderOpen,
  Layers3,
  Moon,
  Plane,
  Search,
  SlidersHorizontal,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { filesFromDrop, filesFromList, loadAircraft } from "./core/files";
import { downloadBytes } from "./core/download";
import { exportAircraftToFlt } from "./core/export";
import type {
  FltCoordinateMode,
  FltExportResult,
  LoadedAircraft,
  Obj8Model,
  SourceFile,
} from "./core/types";
import { Viewer, type ViewMode } from "./viewer/Viewer";

interface DatarefRange {
  min: number;
  max: number;
}

function datarefRanges(aircraft: LoadedAircraft): Map<string, DatarefRange> {
  const ranges = new Map<string, DatarefRange>();
  const add = (name: string, values: number[]) => {
    if (!name) return;
    const existing = ranges.get(name);
    const min = Math.min(...values);
    const max = Math.max(...values);
    ranges.set(name, {
      min: existing ? Math.min(existing.min, min) : min,
      max: existing ? Math.max(existing.max, max) : max,
    });
  };
  for (const model of aircraft.models) {
    for (const group of model.animations) {
      for (const transform of group.transforms) add(transform.dataref, transform.keys.map((key) => key.value));
      for (const rule of group.visibility) add(rule.dataref, [rule.min, rule.max]);
    }
    for (const batch of model.batches) {
      for (const rule of batch.visibility) add(rule.dataref, [rule.min, rule.max]);
      const level = batch.material.lightLevel;
      if (level) add(level.dataref, [level.min, level.max]);
    }
  }
  for (const attachment of aircraft.manifest.attachments) {
    if (attachment.hideDataref) add(attachment.hideDataref, [0, 1]);
  }
  return ranges;
}

function modelLabel(model: Obj8Model): string {
  return model.path.split("/").pop()?.replace(/\.obj$/i, "") ?? model.name;
}

function safeExportStem(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "aircraft";
}

function EmptyState({ onSources, busy, error }: { onSources: (files: SourceFile[]) => void; busy: boolean; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <main
      className={`empty-state ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        const sources = await filesFromDrop(event.dataTransfer);
        onSources(sources);
      }}
    >
      <header className="brand-header">
        <div className="brand-mark"><Plane size={20} /></div>
        <div>
          <strong>XPlane2FLT <span className="build-number">v1.0.4</span></strong>
          <span>Aircraft viewer and OpenFlight converter</span>
        </div>
        <span className="local-badge">LOCAL · PRIVATE</span>
      </header>

      <section className="drop-card">
        <div className="drop-visual">
          <div className="radar-ring ring-one" />
          <div className="radar-ring ring-two" />
          <Plane size={58} strokeWidth={1.25} />
        </div>
        <p className="eyebrow">AIRCRAFT FOLDER INPUT</p>
        <h1>View and convert<br />X-Plane aircraft.</h1>
        <p className="drop-copy">
          Drop a complete X‑Plane 12 aircraft folder. The viewer reads its ACF attachment list,
          OBJ8 render commands, textures, materials, LODs, lights, and dataref animations.
        </p>
        <div className="drop-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => inputRef.current?.click()}>
            <FolderOpen size={18} /> {busy ? "Reading aircraft…" : "Choose aircraft folder"}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => zipRef.current?.click()}>
            <FileArchive size={18} /> Open ZIP
          </button>
        </div>
        <input
          ref={inputRef}
          hidden
          type="file"
          multiple
          {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={async (event) => event.target.files && onSources(await filesFromList(event.target.files))}
        />
        <input ref={zipRef} hidden type="file" accept=".zip" onChange={async (event) => event.target.files && onSources(await filesFromList(event.target.files))} />
        <div className="drop-hint"><Upload size={15} /> Or drag the folder or ZIP anywhere onto this page</div>
        {error && <div className="load-error"><CircleAlert size={17} /> {error}</div>}
      </section>

      <footer className="empty-footer">
        <span>Runs entirely in your browser</span>
        <span>OBJ8 · PNG · DDS · TGA</span>
        <span>Built for GitHub Pages</span>
      </footer>
    </main>
  );
}

export default function App() {
  const [aircraft, setAircraft] = useState<LoadedAircraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [datarefs, setDatarefs] = useState<Record<string, number>>({});
  const [night, setNight] = useState(0.08);
  const [lodDistance, setLodDistance] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [lightsEnabled, setLightsEnabled] = useState(true);
  const [unlit, setUnlit] = useState(true);
  const [rightTab, setRightTab] = useState<"scene" | "datarefs" | "export">("scene");
  const [dragging, setDragging] = useState(false);
  const [exportName, setExportName] = useState("aircraft");
  const [coordinateMode, setCoordinateMode] = useState<FltCoordinateMode>("openflight-z-up");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<FltExportResult | null>(null);

  const openSources = async (sources: SourceFile[]) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadAircraft(sources);
      setAircraft(loaded);
      setVisible(new Set(loaded.models.map((model) => model.path)));
      // Only persisted aircraft configuration values are explicit at load
      // time. Simulator and plugin-driven datarefs are unavailable in a
      // static browser viewer and must remain absent so Viewer can preserve
      // each OBJ8 group's authored (identity) transform. Pre-filling every
      // discovered dataref with zero posed unrelated rotor, door, cockpit,
      // and equipment groups into their numeric-zero animation states.
      setDatarefs({ ...loaded.defaultDatarefs });
      setUnlit(true);
      setSelectedPath(null);
      setExportName(safeExportStem(loaded.name));
      setExportResult(null);
      setExportError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The aircraft could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const ranges = useMemo(() => aircraft ? datarefRanges(aircraft) : new Map(), [aircraft]);
  const selected = aircraft?.models.find((model) => model.path === selectedPath) ?? null;
  const filteredModels = aircraft?.models.filter((model) => model.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  const warnings = aircraft
    ? [...aircraft.manifest.warnings, ...aircraft.models.flatMap((model) => model.warnings.map((warning) => `${model.name}: ${warning}`))]
    : [];

  useEffect(() => {
    setExportResult(null);
    setExportError(null);
  }, [aircraft, visible, datarefs, lodDistance, coordinateMode]);

  const runExport = async () => {
    if (!aircraft) return;
    setExportBusy(true);
    setExportError(null);
    try {
      setExportResult(await exportAircraftToFlt(aircraft, {
        outputName: exportName,
        coordinateMode,
        visiblePaths: visible,
        datarefs,
        lodDistance,
      }));
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "The OpenFlight export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  if (!aircraft) return <EmptyState onSources={openSources} busy={busy} error={error} />;

  return (
    <main
      className={`app-shell ${dragging ? "show-drop-overlay" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        await openSources(await filesFromDrop(event.dataTransfer));
      }}
    >
      <div className="drop-overlay"><Upload size={30} /><strong>Load another aircraft</strong><span>Drop folder or ZIP</span></div>
      <header className="app-header">
        <div className="brand-compact">
          <div className="brand-mark"><Plane size={19} /></div>
          <strong>XPlane2FLT <span>Viewer + converter</span> <em className="build-number">v1.0.4</em></strong>
        </div>
        <div className="aircraft-title">
          <span className="status-light" />
          <div><strong>{aircraft.name}</strong><span>{aircraft.models.length} OBJ8 files · {aircraft.files.length} source files</span></div>
        </div>
        <div className="header-actions">
          <span className="local-badge">LOCAL · PRIVATE</span>
          <button className="icon-text-button" type="button" onClick={() => setAircraft(null)}><X size={16} /> Close</button>
        </div>
      </header>

      <aside className="parts-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">AIRCRAFT OBJECTS</p><h2>Parts</h2></div>
          <span className="count-chip">{visible.size}/{aircraft.models.length}</span>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter OBJ files" />
        </label>
        <div className="bulk-actions">
          <button type="button" onClick={() => setVisible(new Set(aircraft.models.map((model) => model.path)))}>Show all</button>
          <button type="button" onClick={() => setVisible(new Set())}>Hide all</button>
        </div>
        <div className="parts-list">
          {filteredModels.map((model) => {
            const isVisible = visible.has(model.path);
            const isSelected = selectedPath === model.path;
            const attachment = aircraft.manifest.attachments.find(({ path }) => model.path.toLowerCase().endsWith(path.toLowerCase()));
            const tris = model.batches.reduce((sum, batch) => sum + Math.floor(batch.indices.length / 3), 0);
            return (
              <button
                type="button"
                className={`part-row ${isSelected ? "is-selected" : ""}`}
                key={model.path}
                onClick={() => setSelectedPath(model.path)}
              >
                <span
                  className="visibility-toggle"
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={isVisible}
                  aria-label={`${isVisible ? "Hide" : "Show"} ${modelLabel(model)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setVisible((current) => {
                      const next = new Set(current);
                      if (next.has(model.path)) next.delete(model.path);
                      else next.add(model.path);
                      return next;
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setVisible((current) => {
                      const next = new Set(current);
                      if (next.has(model.path)) next.delete(model.path);
                      else next.add(model.path);
                      return next;
                    });
                  }}
                >
                  {isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                </span>
                <span className="part-name"><strong>{modelLabel(model)}</strong><small>{attachment?.role ?? "unattached"} · {tris.toLocaleString()} tris</small></span>
                {model.warnings.length > 0 && <CircleAlert className="warning-icon" size={15} />}
              </button>
            );
          })}
        </div>
        <div className="source-note">
          <Box size={15} />
          <span>{aircraft.manifest.acfPath ? "Placement and view roles read from the ACF." : "No ACF placement data; native OBJ coordinates used."}</span>
        </div>
      </aside>

      <section className="viewer-panel">
        <div className="view-switcher">
          {(["all", "external", "cockpit"] as ViewMode[]).map((mode) => (
            <button className={viewMode === mode ? "active" : ""} type="button" key={mode} onClick={() => setViewMode(mode)}>
              {mode === "all" ? "Complete" : mode === "external" ? "Exterior" : "Cockpit"}
            </button>
          ))}
        </div>
        <Viewer
          aircraft={aircraft}
          visiblePaths={visible}
          viewMode={viewMode}
          datarefs={datarefs}
          night={night}
          lodDistance={lodDistance}
          wireframe={wireframe}
          lightsEnabled={lightsEnabled}
          unlit={unlit}
          onSelect={setSelectedPath}
        />
      </section>

      <aside className="inspector-panel">
        <div className="tab-bar">
          <button type="button" className={rightTab === "scene" ? "active" : ""} onClick={() => setRightTab("scene")}><SlidersHorizontal size={15} /> Scene</button>
          <button type="button" className={rightTab === "datarefs" ? "active" : ""} onClick={() => setRightTab("datarefs")}><Layers3 size={15} /> Datarefs <span>{ranges.size}</span></button>
          <button type="button" className={rightTab === "export" ? "active" : ""} onClick={() => setRightTab("export")}><FileDown size={15} /> Export</button>
        </div>

        {rightTab === "scene" ? (
          <div className="inspector-scroll">
            <section className="control-section">
              <p className="eyebrow">LIGHTING</p>
              <label className="toggle-row"><span><strong>Flat / unlit textures</strong><small>Display texture colors without scene lighting</small></span><input type="checkbox" checked={unlit} onChange={(event) => setUnlit(event.target.checked)} /><i /></label>
              <div className="range-label"><Sun size={16} /><span>Day / night mix</span><Moon size={15} /></div>
              <input className="range" type="range" min="0" max="1" step="0.01" value={night} disabled={unlit} onChange={(event) => setNight(Number(event.target.value))} />
              <div className="range-scale"><span>Day</span><strong>{Math.round(night * 100)}%</strong><span>Night</span></div>
              {unlit && <p className="field-help">Day/night lighting is available in Lit mode.</p>}
            </section>
            <section className="control-section">
              <p className="eyebrow">LEVEL OF DETAIL</p>
              <div className="range-label"><span>Camera distance</span><strong>{lodDistance.toLocaleString()} m</strong></div>
              <input className="range" type="range" min="0" max="10000" step="10" value={lodDistance} onChange={(event) => setLodDistance(Number(event.target.value))} />
              <p className="field-help">Selects the same ATTR_LOD range X‑Plane would use at this distance.</p>
            </section>
            <section className="control-section">
              <p className="eyebrow">RENDER OPTIONS</p>
              <label className="toggle-row"><span><strong>Named lights</strong><small>Show OBJ8 light points</small></span><input type="checkbox" checked={lightsEnabled} onChange={(event) => setLightsEnabled(event.target.checked)} /><i /></label>
              <label className="toggle-row"><span><strong>Wireframe</strong><small>Inspect triangle topology</small></span><input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} /><i /></label>
            </section>
            {selected ? (
              <section className="selection-card">
                <p className="eyebrow">SELECTED OBJECT</p>
                <h3>{modelLabel(selected)}</h3>
                <p>{selected.path}</p>
                <dl>
                  <div><dt>Vertices</dt><dd>{selected.vertices.length.toLocaleString()}</dd></div>
                  <div><dt>Draw batches</dt><dd>{selected.batches.length}</dd></div>
                  <div><dt>Animations</dt><dd>{Math.max(0, selected.animations.length - 1)}</dd></div>
                  <div><dt>Lights</dt><dd>{selected.lights.length}</dd></div>
                </dl>
                <div className="texture-list">
                  {[selected.texture, selected.textureLit, selected.textureNormal, ...Object.values(selected.textureMaps)].filter(Boolean).map((texture) => (
                    <span key={texture}><Check size={13} /> {texture}</span>
                  ))}
                </div>
              </section>
            ) : (
              <section className="selection-placeholder"><Box size={24} /><span>Click an aircraft part to inspect its OBJ8 state.</span></section>
            )}
            {warnings.length > 0 && (
              <details className="warnings">
                <summary><CircleAlert size={16} /> {warnings.length} compatibility note{warnings.length === 1 ? "" : "s"} <ChevronDown size={15} /></summary>
                {warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
              </details>
            )}
          </div>
        ) : rightTab === "datarefs" ? (
          <div className="inspector-scroll dataref-list">
            <div className="dataref-intro">
              <p className="eyebrow">ANIMATION STATE</p>
              <h3>Drive the OBJ8 datarefs</h3>
              <p>These controls evaluate authored keyframes, nested transforms, and show/hide ranges.</p>
            </div>
            {ranges.size === 0 && <div className="selection-placeholder"><Layers3 size={24} /><span>No animated datarefs were found.</span></div>}
            {[...ranges].map(([name, range]) => {
              const span = range.max - range.min;
              const step = span > 20 ? span / 200 : span > 2 ? 0.1 : 0.01;
              const value = datarefs[name] ?? Math.max(range.min, Math.min(0, range.max));
              return (
                <label className="dataref-control" key={name}>
                  <span className="dataref-name">{name}</span>
                  <span className="dataref-value">{value.toFixed(step < 0.1 ? 2 : 1)}</span>
                  <input className="range" type="range" min={range.min} max={range.max} step={step} value={value} onChange={(event) => setDatarefs((current) => ({ ...current, [name]: Number(event.target.value) }))} />
                  <span className="dataref-range"><i>{range.min}</i><i>{range.max}</i></span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="inspector-scroll export-panel">
            <div className="dataref-intro">
              <p className="eyebrow">OPENFLIGHT 16.0</p>
              <h3>Convert the assembled aircraft</h3>
              <p>The exporter bakes the same ACF placement, saved configuration, OBJ8 animation state, LOD, UVs, and material mapping shown in the viewer.</p>
            </div>
            <section className="control-section export-controls">
              <label className="export-field">
                <span>Output name</span>
                <input value={exportName} spellCheck={false} onChange={(event) => setExportName(event.target.value)} />
              </label>
              <label className="export-field">
                <span>Coordinates</span>
                <select value={coordinateMode} onChange={(event) => setCoordinateMode(event.target.value as FltCoordinateMode)}>
                  <option value="openflight-z-up">OpenFlight Z-up · recommended</option>
                  <option value="keep-xplane">Keep X-Plane axes</option>
                </select>
              </label>
              <div className="export-state">
                <div><span>OBJ8 objects</span><strong>{visible.size} / {aircraft.models.length}</strong></div>
                <div><span>LOD state</span><strong>{lodDistance.toLocaleString()} m</strong></div>
                <div><span>Datarefs</span><strong>{Object.keys(datarefs).length} set</strong></div>
                <div><span>Texture mode</span><strong>Original UVs</strong></div>
              </div>
              <p className="export-note">
                Eye toggles control which OBJ files enter the FLT. ACF hide datarefs and OBJ8 show/hide rules still remove disabled configuration variants.
              </p>
              <button
                type="button"
                className="primary-button export-button"
                disabled={exportBusy || visible.size === 0 || !exportName.trim()}
                onClick={() => void runExport()}
              >
                <FileDown size={17} />
                {exportBusy ? "Building OpenFlight…" : "Build OpenFlight package"}
              </button>
              {exportError && <div className="export-error" role="alert"><CircleAlert size={15} /> {exportError}</div>}
            </section>
            {exportResult && (
              <section className="export-complete">
                <div className="export-complete__mark"><Check size={18} /></div>
                <p className="eyebrow">VALIDATED EXPORT</p>
                <h3>{exportResult.fltFileName}</h3>
                <div className="export-state">
                  <div><span>Parts</span><strong>{exportResult.objectCount.toLocaleString()}</strong></div>
                  <div><span>Triangles</span><strong>{exportResult.triangleCount.toLocaleString()}</strong></div>
                  <div><span>Vertices</span><strong>{exportResult.vertexCount.toLocaleString()}</strong></div>
                  <div><span>Textures</span><strong>{exportResult.textureCount.toLocaleString()}</strong></div>
                </div>
                <button type="button" className="primary-button export-button" onClick={() => downloadBytes(exportResult.packageZip, exportResult.packageFileName, "application/zip")}>
                  <FileArchive size={17} /> Download FLT + textures
                </button>
                <button type="button" className="secondary-button export-button" onClick={() => downloadBytes(exportResult.flt, exportResult.fltFileName, "model/vnd.openflight")}>
                  <FileDown size={17} /> Download .FLT only
                </button>
              </section>
            )}
          </div>
        )}
      </aside>

      {busy && <div className="busy-toast"><span className="spinner" /> Reading aircraft package…</div>}
      {error && <button type="button" className="error-toast" onClick={() => setError(null)}><CircleAlert size={17} /> {error}<X size={15} /></button>}
    </main>
  );
}
