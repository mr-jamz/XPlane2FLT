import { useMemo, useState } from "react";
import JSZip from "jszip";
import { Check, CircleAlert, Download, FileArchive, LoaderCircle } from "lucide-react";
import type { LoadedAircraft } from "./core/types";
import { convertArchive, inspectArchive } from "./converter/archive";
import { downloadBytes } from "./converter/download";
import { safeFileStem } from "./converter/path";
import type { ConversionProgress, ConversionResult, OptimizationPreset } from "./converter/types";

interface ConversionPanelProps {
  aircraft: LoadedAircraft;
  visiblePaths: Set<string>;
}

const PRESETS: Record<OptimizationPreset, { targetTriangles: number; minTrianglesPerPart: number }> = {
  original: { targetTriangles: 10_000_000, minTrianglesPerPart: 0 },
  balanced: { targetTriangles: 120_000, minTrianglesPerPart: 750 },
  performance: { targetTriangles: 70_000, minTrianglesPerPart: 500 },
  aggressive: { targetTriangles: 35_000, minTrianglesPerPart: 300 },
  custom: { targetTriangles: 120_000, minTrianglesPerPart: 750 },
};

async function makeSourceArchive(aircraft: LoadedAircraft): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const source of aircraft.files) zip.file(source.path, source.file);
  // This archive is only an in-memory handoff to the converter. STORE avoids
  // compressing every aircraft asset only to inflate it again immediately.
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

function selectedConverterPaths(paths: string[], visiblePaths: Set<string>): string[] {
  const visible = [...visiblePaths].map((path) => path.replaceAll("\\", "/").toLowerCase());
  return paths.filter((path) => {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    return visible.some((candidate) => normalized === candidate || normalized.endsWith(`/${candidate}`) || candidate.endsWith(`/${normalized}`));
  });
}

export function ConversionPanel({ aircraft, visiblePaths }: ConversionPanelProps) {
  const [outputName, setOutputName] = useState(() => safeFileStem(aircraft.name || "aircraft"));
  const [preset, setPreset] = useState<OptimizationPreset>("original");
  const [includeAllTextures, setIncludeAllTextures] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingTextureWarning, setMissingTextureWarning] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const visibleCount = useMemo(() => aircraft.models.filter((model) => visiblePaths.has(model.path)).length, [aircraft, visiblePaths]);

  const convert = async (allowMissingDiffuseTextures = false) => {
    setBusy(true);
    setError(null);
    setMissingTextureWarning(null);
    setResult(null);
    setProgress({ percent: 0, stage: "Preparing aircraft" });
    try {
      const source = await makeSourceArchive(aircraft);
      const inspection = await inspectArchive(source, `${outputName || "aircraft"}.zip`);
      const selectedModelPaths = selectedConverterPaths(inspection.models.map((model) => model.path), visiblePaths);
      if (!selectedModelPaths.length) throw new Error("Show at least one textured OBJ8 object before converting.");
      const settings = PRESETS[preset];
      const next = await convertArchive(source, inspection, {
        outputName,
        coordinateMode: "openflight-z-up",
        includeUnreferencedTextures: includeAllTextures,
        selectedModelPaths,
        allowMissingDiffuseTextures,
        optimization: {
          preset,
          targetTriangles: settings.targetTriangles,
          minTrianglesPerPart: settings.minTrianglesPerPart,
          preserveThinParts: true,
          weldVertices: preset !== "original",
          removeDegenerateFaces: true,
          removeDuplicateFaces: true,
          textureMaxSize: 0,
        },
        onProgress: setProgress,
      });
      setResult(next);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Conversion failed.";
      if (message.includes("no resolvable diffuse texture")) setMissingTextureWarning(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inspector-scroll conversion-panel">
      <div className="dataref-intro">
        <p className="eyebrow">OPENFLIGHT EXPORT</p>
        <h3>Convert the visible aircraft</h3>
        <p>The objects currently shown in Parts are exported to a ModelConverterX-compatible FLT package.</p>
      </div>
      <section className="control-section">
        <label className="conversion-field">
          <span>Output name</span>
          <input value={outputName} onChange={(event) => setOutputName(safeFileStem(event.target.value))} />
        </label>
        <label className="conversion-field">
          <span>Geometry detail</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value as OptimizationPreset)}>
            <option value="original">Original / maximum</option>
            <option value="balanced">Balanced</option>
            <option value="performance">Performance</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
        <label className="toggle-row">
          <span><strong>Include every texture</strong><small>Also package textures not referenced by selected objects</small></span>
          <input type="checkbox" checked={includeAllTextures} onChange={(event) => setIncludeAllTextures(event.target.checked)} /><i />
        </label>
      </section>
      <section className="conversion-summary">
        <div><span>Selected objects</span><strong>{visibleCount}</strong></div>
        <div><span>Coordinates</span><strong>OpenFlight Z-up</strong></div>
        <div><span>Aircraft pose</span><strong>Saved X-Plane configuration</strong></div>
        <p>Saved options control the initial selection. You can turn any part back on to override it before export. Configuration, OBJ8 pivots, and ACF placement are baked into the FLT.</p>
        <button type="button" className="primary-button conversion-button" disabled={busy || visibleCount === 0} onClick={() => void convert(false)}>
          {busy ? <LoaderCircle className="spinner-icon" size={17} /> : <FileArchive size={17} />}
          {busy ? `${progress?.stage ?? "Building FLT package"}…` : "Convert visible objects"}
        </button>
        {busy && progress && (
          <div className="conversion-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
            <div className="conversion-progress-label"><span>{progress.stage}</span><strong>{progress.percent}%</strong></div>
            <div className="conversion-progress-track"><i style={{ width: `${progress.percent}%` }} /></div>
          </div>
        )}
      </section>
      {missingTextureWarning && (
        <div className="conversion-message is-warning">
          <CircleAlert size={16} />
          <span>{missingTextureWarning} The affected geometry will still be included, but it may appear untextured.</span>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void convert(true)}>
            {busy ? "Exporting…" : "Export anyway"}
          </button>
        </div>
      )}
      {error && <div className="conversion-message is-error"><CircleAlert size={16} /><span>{error}</span></div>}
      {result && (
        <section className="conversion-result">
          <p className="eyebrow"><Check size={13} /> CONVERSION COMPLETE</p>
          <h3>{result.triangleCount.toLocaleString()} triangles</h3>
          <p>{result.objectCount} objects · {result.textureCount} textures</p>
          <button type="button" className="primary-button" onClick={() => downloadBytes(result.packageZip, result.packageFileName, "application/zip")}><Download size={16} /> Download package</button>
          <button type="button" className="secondary-button" onClick={() => downloadBytes(result.flt, result.fltFileName, "application/octet-stream")}><Download size={16} /> FLT only</button>
        </section>
      )}
    </div>
  );
}
