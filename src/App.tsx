import { useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  FileArchive,
  Layers3,
  Moon,
  PaintBucket,
  Plane,
  Search,
  SlidersHorizontal,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { filesFromList, loadAircraft } from "./core/files";
import type { LoadedAircraft, Obj8Model, SourceFile } from "./core/types";
import { Viewer, type ViewMode } from "./viewer/Viewer";
import { ConversionPanel } from "./ConversionPanel";

const BUILD_VERSION = "v1.0.12";
const HIGHLIGHT_COLORS = [
  { name: "Red", value: "#ff6b6b" },
  { name: "Orange", value: "#ff9f43" },
  { name: "Yellow", value: "#ffd93d" },
  { name: "Green", value: "#63e6be" },
  { name: "Blue", value: "#74c0fc" },
  { name: "Purple", value: "#b197fc" },
  { name: "White", value: "#f8f9fa" },
] as const;

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

function EmptyState({ onZip, busy, error }: { onZip: (files: FileList | File[]) => void; busy: boolean; error: string | null }) {
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
        onZip(event.dataTransfer.files);
      }}
    >
      <header className="brand-header">
        <div className="brand-mark"><Plane size={20} /></div>
        <div>
          <strong>XPlane2FLT</strong>
          <span>Model Viewer + Converter · {BUILD_VERSION}</span>
        </div>
        <span className="local-badge">LOCAL · PRIVATE</span>
      </header>

      <section className="drop-card">
        <div className="drop-visual">
          <div className="radar-ring ring-one" />
          <div className="radar-ring ring-two" />
          <Plane size={58} strokeWidth={1.25} />
        </div>
        <p className="eyebrow">AIRCRAFT ZIP INPUT</p>
        <h1>View and convert<br />X‑Plane 12 aircraft.</h1>
        <p className="drop-copy">
          Drop a complete aircraft ZIP to inspect its authored scene, select objects,
          and export a ModelConverterX-compatible OpenFlight package.
        </p>
        <div className="drop-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => zipRef.current?.click()}>
            <FileArchive size={18} /> {busy ? "Reading aircraft…" : "Open aircraft ZIP"}
          </button>
        </div>
        <input ref={zipRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => event.target.files && onZip(event.target.files)} />
        <div className="drop-hint"><Upload size={15} /> Or drag one aircraft ZIP anywhere onto this page</div>
        {error && <div className="load-error"><CircleAlert size={17} /> {error}</div>}
      </section>

      <footer className="empty-footer">
        <span>Runs entirely in your browser</span>
        <span>OBJ8 · FLT · PNG · DDS · TGA</span>
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
  const [highlightColor, setHighlightColor] = useState(() => localStorage.getItem("xplane2flt-highlight-color") ?? HIGHLIGHT_COLORS[0].value);
  const [dragging, setDragging] = useState(false);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The aircraft could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const openZip = async (files: FileList | File[]) => {
    const selected = [...files];
    if (selected.length !== 1 || !/\.zip$/i.test(selected[0].name)) {
      setError("Choose or drop exactly one .zip aircraft package.");
      return;
    }
    setError(null);
    try {
      await openSources(await filesFromList(selected));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ZIP could not be read.");
    }
  };

  const ranges = useMemo(() => aircraft ? datarefRanges(aircraft) : new Map(), [aircraft]);
  const selected = aircraft?.models.find((model) => model.path === selectedPath) ?? null;
  const filteredModels = aircraft?.models.filter((model) => model.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  const warnings = aircraft
    ? [...aircraft.manifest.warnings, ...aircraft.models.flatMap((model) => model.warnings.map((warning) => `${model.name}: ${warning}`))]
    : [];

  if (!aircraft) return <EmptyState onZip={openZip} busy={busy} error={error} />;

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
        await openZip(event.dataTransfer.files);
      }}
    >
      <div className="drop-overlay"><Upload size={30} /><strong>Load another aircraft</strong><span>Drop one aircraft ZIP</span></div>
      <header className="app-header">
        <div className="brand-compact">
          <div className="brand-mark"><Plane size={19} /></div>
          <strong>XPlane2FLT <span>Viewer + Converter · {BUILD_VERSION}</span></strong>
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
          selectedPath={selectedPath}
          highlightColor={highlightColor}
          onSelect={setSelectedPath}
        />
      </section>

      <aside className="inspector-panel">
        <div className="tab-bar">
          <button type="button" className={rightTab === "scene" ? "active" : ""} onClick={() => setRightTab("scene")}><SlidersHorizontal size={15} /> Scene</button>
          <button type="button" className={rightTab === "datarefs" ? "active" : ""} onClick={() => setRightTab("datarefs")}><Layers3 size={15} /> Datarefs <span>{ranges.size}</span></button>
          <button type="button" className={rightTab === "export" ? "active" : ""} onClick={() => setRightTab("export")}><FileArchive size={15} /> Export</button>
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
                <div className="highlight-control">
                  <span><PaintBucket size={14} /> Highlight color</span>
                  <div className="highlight-palette" role="radiogroup" aria-label="Selection highlight color">
                    {HIGHLIGHT_COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        role="radio"
                        aria-checked={highlightColor === color.value}
                        aria-label={color.name}
                        className={highlightColor === color.value ? "active" : ""}
                        style={{ backgroundColor: color.value }}
                        onClick={() => {
                          setHighlightColor(color.value);
                          localStorage.setItem("xplane2flt-highlight-color", color.value);
                        }}
                      />
                    ))}
                  </div>
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
        ) : <ConversionPanel aircraft={aircraft} visiblePaths={visible} />}
      </aside>

      {busy && <div className="busy-toast"><span className="spinner" /> Reading aircraft package…</div>}
      {error && <button type="button" className="error-toast" onClick={() => setError(null)}><CircleAlert size={17} /> {error}<X size={15} /></button>}
    </main>
  );
}
