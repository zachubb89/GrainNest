import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderOpen, 
  Camera, 
  RotateCw, 
  Play, 
  Download, 
  RefreshCw, 
  X, 
  CheckCircle, 
  AlertTriangle, 
  Trash2, 
  HelpCircle, 
  Sparkles,
  Info
} from 'lucide-react';
import { FileRecord, PartRecord, PhotoData, MockupData, SheetGrid, Placement, LastNest } from './types';
import { 
  extractPartsFromSvg, 
  autoCropPhoto, 
  detectGrainDirection, 
  preRasterizeParts, 
  placeSingleInstance, 
  exportSvg,
  loadImageFromSvgString,
  createThumbnailUrl
} from './nestingEngine';
import { demoSvgContent, demoQuantities } from './demoData';

// Seeded PRNG for procedural wood grain (Section 9.1)
function createSeededRandom(seed: number) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

interface SpeciesConfig {
  gradStart: string;
  gradEnd: string;
  grainColor: string;
  knotColor: string;
  minLines: number;
  maxLines: number;
  minKnots: number;
  maxKnots: number;
  waveAmpMin: number;
  waveAmpMax: number;
  waveFreqMin: number;
  waveFreqMax: number;
}

const SPECIES_PRESETS: Record<string, SpeciesConfig> = {
  walnut: {
    gradStart: '#4a3224',
    gradEnd: '#2e1c12',
    grainColor: 'rgba(24, 12, 6, 0.28)',
    knotColor: 'rgba(24, 12, 6, 0.18)',
    minLines: 40,
    maxLines: 55,
    minKnots: 1,
    maxKnots: 2,
    waveAmpMin: 6,
    waveAmpMax: 18,
    waveFreqMin: 0.001,
    waveFreqMax: 0.003,
  },
  maple: {
    gradStart: '#faf3e5',
    gradEnd: '#eedebc',
    grainColor: 'rgba(180, 145, 100, 0.12)',
    knotColor: 'rgba(180, 145, 100, 0.08)',
    minLines: 25,
    maxLines: 35,
    minKnots: 0,
    maxKnots: 1,
    waveAmpMin: 1,
    waveAmpMax: 4,
    waveFreqMin: 0.003,
    waveFreqMax: 0.006,
  },
  cherry: {
    gradStart: '#d48454',
    gradEnd: '#a65429',
    grainColor: 'rgba(100, 32, 12, 0.20)',
    knotColor: 'rgba(100, 32, 12, 0.14)',
    minLines: 35,
    maxLines: 48,
    minKnots: 1,
    maxKnots: 3,
    waveAmpMin: 3,
    waveAmpMax: 12,
    waveFreqMin: 0.002,
    waveFreqMax: 0.004,
  },
  mahogany: {
    gradStart: '#8c381a',
    gradEnd: '#61220c',
    grainColor: 'rgba(46, 12, 4, 0.26)',
    knotColor: 'rgba(46, 12, 4, 0.18)',
    minLines: 40,
    maxLines: 60,
    minKnots: 0,
    maxKnots: 1,
    waveAmpMin: 1.5,
    waveAmpMax: 5,
    waveFreqMin: 0.002,
    waveFreqMax: 0.003,
  },
  oak: {
    gradStart: '#ecd2ad',
    gradEnd: '#c9ad7c',
    grainColor: 'rgba(115, 84, 48, 0.26)',
    knotColor: 'rgba(115, 84, 48, 0.18)',
    minLines: 45,
    maxLines: 65,
    minKnots: 2,
    maxKnots: 4,
    waveAmpMin: 4,
    waveAmpMax: 16,
    waveFreqMin: 0.002,
    waveFreqMax: 0.005,
  }
};

// Draw procedural wood grain background on sheet canvas (Section 9.2)
function drawProceduralWood(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grainAngleDeg: number,
  grainLockOn: boolean,
  sheetIndex: number,
  species: string = 'walnut'
) {
  const spec = SPECIES_PRESETS[species] || SPECIES_PRESETS.walnut;

  // Linear base gradient matching the species colors
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, spec.gradStart);
  grad.addColorStop(1, spec.gradEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const seed = 12345 + sheetIndex * 6789;
  const rand = createSeededRandom(seed);

  ctx.save();

  if (grainLockOn) {
    // Translate and rotate about canvas center
    ctx.translate(w / 2, h / 2);
    ctx.rotate((grainAngleDeg * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
  }

  const diagonal = Math.sqrt(w * w + h * h);
  const startX = -diagonal / 2;
  const endX = w + diagonal / 2;
  const startY = -diagonal / 2;
  const endY = h + diagonal / 2;

  // Render wavy wood lines with species config
  ctx.strokeStyle = spec.grainColor;
  ctx.lineCap = 'round';

  const numLines = spec.minLines + Math.floor(rand() * (spec.maxLines - spec.minLines + 1));
  for (let i = 0; i < numLines; i++) {
    const cy = startY + (endY - startY) * (i / numLines);
    const amp = spec.waveAmpMin + rand() * (spec.waveAmpMax - spec.waveAmpMin);
    const freq = spec.waveFreqMin + rand() * (spec.waveFreqMax - spec.waveFreqMin);
    const phase = rand() * Math.PI * 2;
    const lineWidth = 1 + rand() * 2.5;
    ctx.lineWidth = lineWidth;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += 15) {
      const y = cy + Math.sin(x * freq + phase) * amp;
      if (x === startX) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Draw knots matching species config
  const numKnots = spec.minKnots + Math.floor(rand() * (spec.maxKnots - spec.minKnots + 1));
  for (let k = 0; k < numKnots; k++) {
    const kx = startX + (endX - startX) * rand();
    const ky = startY + (endY - startY) * rand();
    const rX = 25 + rand() * 25;
    const rY = 6 + rand() * 8;
    const rot = rand() * Math.PI * 2;

    ctx.strokeStyle = spec.knotColor;
    ctx.lineWidth = 1 + rand() * 1.5;

    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, rX * ring * 0.25, rY * ring * 0.25, rot, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// Helper to draw double-headed grain direction arrow (Section 6.4 / 9.3)
function drawDoubleArrow(ctx: CanvasRenderingContext2D, x: number, y: number, length: number, angleDeg: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.fillStyle = '#ffffff';

  // Draw shaft
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.lineTo(length / 2, 0);
  ctx.stroke();

  // Draw arrowheads
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.lineTo(-length / 2 + 6, -5);
  ctx.lineTo(-length / 2 + 6, 5);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(length / 2, 0);
  ctx.lineTo(length / 2 - 6, -5);
  ctx.lineTo(length / 2 - 6, 5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Drawing tinted silhouettes synchronously for preview layers (Section 9.5)
const drawTintedRaster = (
  ctx: CanvasRenderingContext2D,
  rasterCanvas: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  tintColor: string
) => {
  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = rasterCanvas.width;
  tintCanvas.height = rasterCanvas.height;
  const tCtx = tintCanvas.getContext('2d')!;

  tCtx.drawImage(rasterCanvas, 0, 0);

  // Apply tint via source-in composite
  tCtx.globalCompositeOperation = 'source-in';
  tCtx.fillStyle = tintColor;
  tCtx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);

  ctx.save();
  ctx.globalAlpha = 0.85; // Alpha level specified in Section 9
  ctx.drawImage(tintCanvas, dx, dy, dw, dh);
  ctx.restore();
};

// Sheet Preview React Canvas Component (Section 9)
const SheetPreviewCanvas = ({
  sheet,
  sheetIdx,
  lastNest,
  photo,
  parts,
  cell,
  grainOn,
  grainA,
  species
}: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const ppi = 40; // 40 pixels per inch results in 800px width for 20" sheet
    const Win = sheet.W * cell;
    const Hin = sheet.H * cell;

    const cw = Win * ppi;
    const ch = Hin * ppi;

    // Draw at 2x for retina crispness (Section 9.1)
    canvas.width = cw * 2;
    canvas.height = ch * 2;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    ctx.scale(2, 2);

    // 1. Draw Background Wood
    if (species === 'custom' && photo) {
      // Cover mapping (Section 6.3)
      const ppiPhoto = Math.max(photo.w / Win, photo.h / Hin);
      const sx0 = (photo.w - Win * ppiPhoto) / 2;
      const sy0 = (photo.h - Hin * ppiPhoto) / 2;
      ctx.drawImage(photo.img, sx0, sy0, Win * ppiPhoto, Hin * ppiPhoto, 0, 0, cw, ch);
    } else {
      drawProceduralWood(ctx, cw, ch, grainA, grainOn, sheetIdx, species);
    }

    // 2. Inset Margin dashed rectangle
    const marginC = Math.round(lastNest.marginIn / cell);
    const marginPx = marginC * cell * ppi;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(marginPx, marginPx, cw - 2 * marginPx, ch - 2 * marginPx);
    ctx.setLineDash([]);

    // 3. Grain Indicator Arrow (Section 9.3)
    if (grainOn) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(`GRAIN DIRECTION: ${grainA}°`, 20, 24);
      drawDoubleArrow(ctx, 165, 20, 22, grainA);
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText("GRAIN LOCK: FREE", 20, 24);
      ctx.restore();
    }

    // 4. Tinted Placements (Section 9.5)
    const placements = lastNest.placed.filter((p: any) => p.sheet === sheetIdx);
    placements.forEach((p: any) => {
      const part = parts.find(pt => pt.id === p.partId);
      if (!part) return;

      const pWidthIn = p.rasterW ? p.rasterW * cell : (cw / ppi); // fallback
      const pHeightIn = p.rasterH ? p.rasterH * cell : (ch / ppi);

      // Unique part color based on Golden-angle HSL (Section 9.5)
      const colorHue = (part.id * 47 + 20) % 360;
      const tintColor = `hsl(${colorHue}, 62%, 58%)`;

      if (p.rasterCanvas) {
        drawTintedRaster(
          ctx,
          p.rasterCanvas,
          p.X * ppi,
          p.Y * ppi,
          p.rasterW * cell * ppi,
          p.rasterH * cell * ppi,
          tintColor
        );
      }
    });

  }, [sheet, sheetIdx, lastNest, photo, parts, cell, grainOn, grainA]);

  return (
    <div className="flex flex-col items-center bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6 shadow-xl w-full">
      <div className="overflow-x-auto w-full flex justify-center py-2">
        <canvas ref={canvasRef} className="rounded border border-zinc-700 bg-zinc-950 shadow-inner" />
      </div>
      <div className="w-full max-w-3xl flex justify-between items-center mt-3 text-zinc-400 text-xs px-2">
        <div>
          <span className="font-semibold text-zinc-200">Sheet #{sheetIdx + 1}</span>: {sheet.W * cell}" × {sheet.H * cell}" ({sheet.W} × {sheet.H} cells)
        </div>
        <div>
          Grain Alignment: <span className="text-amber-400 font-semibold">{grainOn ? `${grainA}°` : 'unlocked'}</span>
        </div>
        <div>
          Material Util: <span className="text-emerald-400 font-bold text-sm">{Math.round((sheet.used / (sheet.W * sheet.H)) * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // Global states (Section 2.1)
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [parts, setParts] = useState<PartRecord[]>([]);
  const [lastNest, setLastNest] = useState<LastNest | null>(null);
  const [rawPhoto, setRawPhoto] = useState<{ img: HTMLImageElement; w: number; h: number } | null>(null);
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const [mockups, setMockups] = useState<MockupData[]>([]);
  const [nesting, setNesting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("Ready to nest. Load files or try the demo!");
  const [nestingProgress, setNestingProgress] = useState<{ current: number; total: number; msg: string } | null>(null);

  // Sidebar Controls state
  const [preset, setPreset] = useState<string>("19x12");
  const [shW, setShW] = useState<number>(19);
  const [shH, setShH] = useState<number>(12);
  const [woodSpecies, setWoodSpecies] = useState<string>("walnut");
  const [margin, setMargin] = useState<number>(0.25);
  const [spacing, setSpacing] = useState<number>(0.15);
  const [maxSheets, setMaxSheets] = useState<number>(5);
  const [precision, setPrecision] = useState<number>(0.05); // Default 0.05 normal
  const [grainOn, setGrainOn] = useState<boolean>(true);
  const [grainA, setGrainA] = useState<number>(0);
  const [grainTol, setGrainTol] = useState<number>(3);
  const [flip180, setFlip180] = useState<boolean>(true);
  const [allGrainA, setAllGrainA] = useState<number>(0);
  const [inHoles, setInHoles] = useState<boolean>(false);
  const [importScale, setImportScale] = useState<number>(72);
  const [treatAsOne, setTreatAsOne] = useState<boolean>(false);
  const [autoCrop, setAutoCrop] = useState<boolean>(true);
  const [mockDpi, setMockDpi] = useState<number>(150);
  const [burnAmt, setBurnAmt] = useState<number>(70);

  // Tabs
  const [activeTab, setActiveTab] = useState<string>("sheets");

  // DOM elements references
  const hiddenContainerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoThumbRef = useRef<HTMLCanvasElement>(null);

  // Manage presets update
  useEffect(() => {
    if (preset === "19x12") {
      setShW(19);
      setShH(12);
    } else if (preset === "12x20") {
      setShW(20);
      setShH(12);
    } else if (preset === "12x24") {
      setShW(24);
      setShH(12);
    } else if (preset === "18x32") {
      setShW(32);
      setShH(18);
    }
  }, [preset]);

  // Effect to handle manual resizing of shW or shH to custom preset
  const handleShWChange = (val: number) => {
    setShW(val);
    setPreset("custom");
  };
  const handleShHChange = (val: number) => {
    setShH(val);
    setPreset("custom");
  };

  // Build the annotated side-panel photo crop thumbnail (Section 6.4)
  useEffect(() => {
    if (photoThumbRef.current && rawPhoto && photo) {
      const canvas = photoThumbRef.current;
      const ctx = canvas.getContext('2d')!;
      
      const thumbSize = 250;
      const aspect = rawPhoto.w / rawPhoto.h;
      let w = thumbSize;
      let h = thumbSize;
      if (aspect > 1) {
        h = Math.round(thumbSize / aspect);
      } else {
        w = Math.round(thumbSize * aspect);
      }

      canvas.width = w;
      canvas.height = h;

      // Draw full raw photo
      ctx.drawImage(rawPhoto.img, 0, 0, w, h);

      // Dim cropped areas
      const scaleX = w / rawPhoto.w;
      const scaleY = h / rawPhoto.h;

      const cropX = photo.crop.x * scaleX;
      const cropY = photo.crop.y * scaleY;
      const cropW = photo.crop.w * scaleX;
      const cropH = photo.crop.h * scaleY;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, w, cropY); // Top
      ctx.fillRect(0, cropY + cropH, w, h - (cropY + cropH)); // Bottom
      ctx.fillRect(0, cropY, cropX, cropH); // Left
      ctx.fillRect(cropX + cropW, cropY, w - (cropX + cropW), cropH); // Right

      // Amber dashed border
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(cropX, cropY, cropW, cropH);
      ctx.setLineDash([]);

      // Grain pointer arrow
      const cx = cropX + cropW / 2;
      const cy = cropY + cropH / 2;
      const arrowLength = Math.min(cropW, cropH) * 0.45;
      drawDoubleArrow(ctx, cx, cy, arrowLength, photo.grainDeg);
    }
  }, [rawPhoto, photo]);

  // Bulk set parts grain angles (Section 10.3)
  const applyBulkGrainA = () => {
    setParts(prev => prev.map(p => ({ ...p, grainA: allGrainA })));
    setStatusMsg(`Applied grain direction of ${allGrainA}° to all parts.`);
  };

  // Remove a part
  const removePart = (id: number) => {
    setParts(prev => prev.filter(p => p.id !== id));
    setStatusMsg("Part removed.");
  };

  // Update part quantity
  const updatePartQty = (id: number, qty: number) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, qty: Math.max(1, qty) } : p));
  };

  // Update individual part grain angle
  const updatePartGrain = (id: number, angle: number) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, grainA: angle } : p));
  };

  // Clear all states
  const clearAll = () => {
    setFiles([]);
    setParts([]);
    setLastNest(null);
    setRawPhoto(null);
    setPhoto(null);
    setMockups([]);
    setNesting(false);
    setWoodSpecies("walnut");
    setStatusMsg("All workspace data cleared.");
  };

  // Import SVG file workflow (Section 3)
  const handleSvgImport = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setStatusMsg("Importing SVGs...");

    const newFiles: FileRecord[] = [];
    const newParts: PartRecord[] = [];
    let startId = parts.length > 0 ? Math.max(...parts.map(p => p.id)) + 1 : 1;

    try {
      const hiddenContainer = hiddenContainerRef.current;
      if (!hiddenContainer) {
        throw new Error("Internal measurements DOM node not available");
      }

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file.name.toLowerCase().endsWith('.svg')) {
          setStatusMsg(`Rejected file "${file.name}": Only SVG files are supported.`);
          continue;
        }

        const text = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');

        const parserError = doc.getElementsByTagName('parsererror');
        if (parserError.length > 0) {
          setStatusMsg(`Failed to parse file "${file.name}": Invalid XML/SVG structure.`);
          continue;
        }

        const fileIdx = files.length + newFiles.length;
        const res = extractPartsFromSvg(
          doc,
          file.name,
          importScale,
          treatAsOne,
          hiddenContainer,
          startId,
          fileIdx
        );

        if (res.parts.length === 0) {
          setStatusMsg(`No valid shapes with area found in file "${file.name}".`);
          continue;
        }

        // Generate list thumbnails asynchronously
        for (let j = 0; j < res.parts.length; j++) {
          const pt = res.parts[j];
          const thumbUrl = await createThumbnailUrl(pt, res.file.style, res.file.defs);
          pt.thumb = thumbUrl;
        }

        newFiles.push(res.file);
        newParts.push(...res.parts);
        startId += res.parts.length;
      }

      if (newParts.length > 0) {
        setFiles(prev => [...prev, ...newFiles]);
        setParts(prev => [...prev, ...newParts]);
        setStatusMsg(`Imported ${newParts.length} parts successfully.`);
      }
    } catch (err: any) {
      console.error(err);
      setStatusMsg(`Import error: ${err?.message || err}`);
    }
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleSvgImport(e.dataTransfer.files);
  };

  // Load Wood Photo process (Section 6)
  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg("Loading wood photo...");
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        processUploadedImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const processUploadedImage = (img: HTMLImageElement) => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    setRawPhoto({ img, w, h });

    let crop = { x: 0, y: 0, w, h };
    let success = false;
    if (autoCrop) {
      const cropRes = autoCropPhoto(img);
      crop = { x: cropRes.x, y: cropRes.y, w: cropRes.w, h: cropRes.h };
      success = cropRes.success;
    }

    const grainRes = detectGrainDirection(img, crop);

    // Bake and cap resolution at 2400px (Section 6.3)
    const maxDim = 2400;
    let scale = 1;
    if (Math.max(crop.w, crop.h) > maxDim) {
      scale = maxDim / Math.max(crop.w, crop.h);
    }

    const bakedW = Math.round(crop.w * scale);
    const bakedH = Math.round(crop.h * scale);

    const bakedCanvas = document.createElement('canvas');
    bakedCanvas.width = bakedW;
    bakedCanvas.height = bakedH;
    const bakedCtx = bakedCanvas.getContext('2d')!;
    bakedCtx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, bakedW, bakedH);

    setPhoto({
      img: bakedCanvas,
      w: bakedW,
      h: bakedH,
      grainDeg: grainRes.angleDeg,
      coherence: grainRes.coherence,
      crop
    });
    setWoodSpecies("custom");

    if (grainRes.coherence >= 0.12) {
      setGrainA(grainRes.angleDeg);
      setStatusMsg(`Wood loaded. Auto-crop: ${success ? 'success' : 'fallback'}. Detected grain: ${grainRes.angleDeg}°.`);
    } else {
      setStatusMsg(`Wood loaded. Low grain confidence (${grainRes.angleDeg.toFixed(1)}°, conf: ${grainRes.coherence.toFixed(2)}).`);
    }
  };

  // Rotate photo 90 degrees
  const rotatePhoto90 = () => {
    if (!rawPhoto) return;
    setStatusMsg("Rotating photo...");

    const canvas = document.createElement('canvas');
    canvas.width = rawPhoto.h;
    canvas.height = rawPhoto.w;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(rawPhoto.h / 2, rawPhoto.w / 2);
    ctx.rotate(90 * Math.PI / 180);
    ctx.drawImage(rawPhoto.img, -rawPhoto.w / 2, -rawPhoto.h / 2);

    const img = new Image();
    img.onload = () => {
      processUploadedImage(img);
    };
    img.src = canvas.toDataURL();
  };

  // Load Demo Parts and Trigger Nesting (Section 10.4)
  const loadDemoParts = async () => {
    setStatusMsg("Loading demo parts...");
    clearAll();

    try {
      const hiddenContainer = hiddenContainerRef.current;
      if (!hiddenContainer) {
        throw new Error("Internal measurement canvas not ready");
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(demoSvgContent, 'image/svg+xml');

      const res = extractPartsFromSvg(
        doc,
        "demo_parts.svg",
        72,
        false,
        hiddenContainer,
        1,
        0
      );

      // Map demo quantities
      res.parts.forEach(pt => {
        const qtyKey = pt.name as keyof typeof demoQuantities;
        if (demoQuantities[qtyKey]) {
          pt.qty = demoQuantities[qtyKey];
        }
      });

      for (let j = 0; j < res.parts.length; j++) {
        const pt = res.parts[j];
        const thumbUrl = await createThumbnailUrl(pt, res.file.style, res.file.defs);
        pt.thumb = thumbUrl;
      }

      setFiles([res.file]);
      setParts(res.parts);
      setStatusMsg("Demo parts loaded. Initializing auto-nest...");

      // Automatically trigger nesting
      setTimeout(() => {
        triggerNesting(res.parts, [res.file]);
      }, 300);

    } catch (err: any) {
      console.error(err);
      setStatusMsg(`Demo load error: ${err?.message || err}`);
    }
  };

  // Standard Nesting Loop (Section 5)
  const triggerNesting = async (activeParts: PartRecord[], activeFiles: FileRecord[]) => {
    if (activeParts.length === 0 || nesting) return;
    setNesting(true);
    setStatusMsg("Preparing silhouettes and raster caches...");

    try {
      // 1. Pre-rasterize all required angles for fast collision checks
      const rastersCache = await preRasterizeParts(
        activeParts,
        activeFiles,
        precision,
        spacing,
        inHoles,
        grainOn ? grainA : 0,
        grainOn ? grainTol : 0,
        flip180,
        grainOn,
        (msg) => {
          setStatusMsg(msg);
          setNestingProgress({ current: 0, total: 100, msg });
        }
      );

      // 2. Expand parts to individual instances & sort by size descending (FDD)
      const instances: { part: PartRecord; bboxArea: number }[] = [];
      activeParts.forEach(part => {
        const s = 1 / part.unitsPerIn;
        const area = part.bbox.width * part.bbox.height * s * s;
        for (let i = 0; i < part.qty; i++) {
          instances.push({ part, bboxArea: area });
        }
      });

      instances.sort((a, b) => b.bboxArea - a.bboxArea);

      const totalInstances = instances.length;
      let placedCount = 0;
      const placedList: Placement[] = [];
      const unplaced: string[] = [];

      // Grid specifications
      const cell = precision;
      const W_cells = Math.round(shW / cell);
      const H_cells = Math.round(shH / cell);
      let currentSheets: SheetGrid[] = [
        {
          W: W_cells,
          H: H_cells,
          occ: new Uint8Array(W_cells * H_cells),
          free: W_cells * H_cells,
          used: 0
        }
      ];

      setStatusMsg(`Packing 0/${totalInstances} parts on sheet...`);
      setNestingProgress({ current: 0, total: totalInstances, msg: `Nesting parts...` });

      let index = 0;

      const step = () => {
        if (index >= totalInstances) {
          // Nesting run complete
          setNesting(false);
          setNestingProgress(null);

          const finalNest: LastNest = {
            Win: shW,
            Hin: shH,
            cell,
            marginIn: margin,
            gapIn: spacing,
            grainA: grainOn ? grainA : null,
            sheets: currentSheets,
            placed: placedList,
            unplaced
          };

          setLastNest(finalNest);
          setMockups([]); // invalidate mockups

          const fitPct = Math.round((placedList.length / totalInstances) * 100);
          if (unplaced.length > 0) {
            setStatusMsg(`Nest complete. Placed ${placedList.length}/${totalInstances} (${fitPct}%). Unplaced: ${unplaced.join(', ')}.`);
          } else {
            setStatusMsg(`Nest complete. Placed all ${placedList.length} parts on ${currentSheets.length} sheet(s)!`);
          }
          setActiveTab("sheets");
          return;
        }

        const inst = instances[index];
        const res = placeSingleInstance(
          inst,
          currentSheets,
          maxSheets,
          margin,
          cell,
          rastersCache,
          grainOn ? grainA : 0,
          grainOn ? grainTol : 0,
          flip180,
          grainOn
        );

        if (res) {
          const actualRaster = rastersCache.get(`${inst.part.id}_${res.placement.angle}`)!;
          placedList.push({
            ...res.placement,
            // Attach canvas and trimmed size to render placement synchronously on preview
            rasterCanvas: actualRaster.canvas,
            rasterW: actualRaster.wC,
            rasterH: actualRaster.hC
          } as any);
          currentSheets = res.sheetsUpdated;
          placedCount++;
        } else {
          if (!unplaced.includes(inst.part.name)) {
            unplaced.push(inst.part.name);
          }
        }

        index++;
        setNestingProgress({
          current: index,
          total: totalInstances,
          msg: `Nesting: Placed ${placedCount}/${index} of ${totalInstances}...`
        });

        // Live refresh preview of active packing
        setLastNest({
          Win: shW,
          Hin: shH,
          cell,
          marginIn: margin,
          gapIn: spacing,
          grainA: grainOn ? grainA : null,
          sheets: [...currentSheets],
          placed: [...placedList],
          unplaced: [...unplaced]
        });

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);

    } catch (err: any) {
      console.error(err);
      setNesting(false);
      setNestingProgress(null);
      setStatusMsg(`Nesting failure: ${err?.message || err}`);
    }
  };

  // Download complete high-res nested SVG back to Illustrator (Section 8)
  const triggerExportSvg = () => {
    if (!lastNest || lastNest.placed.length === 0) return;
    setStatusMsg("Preparing export SVG file...");

    try {
      const output = exportSvg(lastNest, parts, files);
      const blob = new Blob([output], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `nest_layout_${shW}x${shH}_${lastNest.sheets.length}sheets.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setStatusMsg("Exported nest layout SVG successfully at physical scale!");
    } catch (err: any) {
      console.error(err);
      setStatusMsg(`Export failed: ${err?.message || err}`);
    }
  };

  // Render photographic mockup transparent PNGs (Section 7)
  const renderMockups = async () => {
    if ((woodSpecies === 'custom' && !photo) || !lastNest || lastNest.placed.length === 0) return;
    setNesting(true);
    setStatusMsg("Starting photorealistic mockup render pipeline...");

    try {
      const Win = lastNest.Win;
      const Hin = lastNest.Hin;
      const DPI = mockDpi;
      const burnSetting = burnAmt;

      const computedMockups: MockupData[] = [];
      const total = lastNest.placed.length;

      for (let i = 0; i < total; i++) {
        const p = lastNest.placed[i];
        const part = parts.find(pt => pt.id === p.partId);
        if (!part) continue;

        setStatusMsg(`Compositing mockup ${i + 1}/${total}: "${part.name}"...`);

        const file = files[part.fileIdx];
        const s = 1 / part.unitsPerIn;

        const cw = Math.ceil(p.rasterW * lastNest.cell * DPI);
        const ch = Math.ceil(p.rasterH * lastNest.cell * DPI);

        const halfW_px = (part.bbox.width / 2) * s * DPI;
        const halfH_px = (part.bbox.height / 2) * s * DPI;

        // Generate output canvas
        const cv = document.createElement('canvas');
        cv.width = cw;
        cv.height = ch;
        const ctx = cv.getContext('2d')!;

        // 1. Render high-res silhouette mask at DPI
        const silSvgStr = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${part.bbox.width * s * DPI}" height="${part.bbox.height * s * DPI}" viewBox="${part.bbox.x} ${part.bbox.y} ${part.bbox.width} ${part.bbox.height}">
            <style>
              ${file.style}
              * { fill:#000 !important; fill-opacity:1 !important; opacity:1 !important;
                  stroke-opacity:1 !important; visibility:visible !important; display:inline !important }
            </style>
            ${file.defs}
            ${part.markup}
          </svg>
        `;
        const silImg = await loadImageFromSvgString(silSvgStr);

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = cw;
        maskCanvas.height = ch;
        const maskCtx = maskCanvas.getContext('2d')!;
        maskCtx.translate(-p.orgX * DPI, -p.orgY * DPI);
        maskCtx.rotate((p.angle * Math.PI) / 180);
        maskCtx.drawImage(silImg, -halfW_px, -halfH_px, part.bbox.width * s * DPI, part.bbox.height * s * DPI);

        // 2. Draw cropped Wood texture matching sheet placement
        const woodCanvas = document.createElement('canvas');
        woodCanvas.width = cw;
        woodCanvas.height = ch;
        const woodCtx = woodCanvas.getContext('2d')!;

        if (woodSpecies === 'custom' && photo) {
          const ppi = Math.max(photo.w / Win, photo.h / Hin);
          const sx0 = (photo.w - Win * ppi) / 2;
          const sy0 = (photo.h - Hin * ppi) / 2;

          const sx = sx0 + p.X * ppi;
          const sy = sy0 + p.Y * ppi;
          const sw = (p.rasterW * lastNest.cell) * ppi;
          const sh = (p.rasterH * lastNest.cell) * ppi;
          woodCtx.drawImage(photo.img, sx, sy, sw, sh, 0, 0, cw, ch);
        } else {
          // No photo, use procedural wood grain!
          const sheetW_px = Math.round(Win * DPI);
          const sheetH_px = Math.round(Hin * DPI);
          const fullSheetCanvas = document.createElement('canvas');
          fullSheetCanvas.width = sheetW_px;
          fullSheetCanvas.height = sheetH_px;
          const fullSheetCtx = fullSheetCanvas.getContext('2d')!;
          
          // Draw procedural wood on full sheet
          drawProceduralWood(
            fullSheetCtx, 
            sheetW_px, 
            sheetH_px, 
            lastNest.grainA || 0, 
            (lastNest.grainA !== null), 
            p.sheet, 
            woodSpecies
          );
          
          // Now copy the cropped region from fullSheetCanvas to woodCanvas
          const sx = p.X * DPI;
          const sy = p.Y * DPI;
          const sw = p.rasterW * lastNest.cell * DPI;
          const sh = p.rasterH * lastNest.cell * DPI;
          woodCtx.drawImage(fullSheetCanvas, sx, sy, sw, sh, 0, 0, cw, ch);
        }

        // Crop wood to the silhouette mask
        woodCtx.globalCompositeOperation = 'destination-in';
        woodCtx.drawImage(maskCanvas, 0, 0);

        ctx.drawImage(woodCanvas, 0, 0);

        // 3. Render as-authored vector lines & engravings (Section 7.1.3)
        const artSvgStr = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${part.bbox.width * s * DPI}" height="${part.bbox.height * s * DPI}" viewBox="${part.bbox.x} ${part.bbox.y} ${part.bbox.width} ${part.bbox.height}">
            <style>
              ${file.style}
            </style>
            ${file.defs}
            ${part.markup}
          </svg>
        `;
        const artImg = await loadImageFromSvgString(artSvgStr);

        const artCanvas = document.createElement('canvas');
        artCanvas.width = cw;
        artCanvas.height = ch;
        const artCtx = artCanvas.getContext('2d')!;
        artCtx.translate(-p.orgX * DPI, -p.orgY * DPI);
        artCtx.rotate((p.angle * Math.PI) / 180);
        artCtx.drawImage(artImg, -halfW_px, -halfH_px, part.bbox.width * s * DPI, part.bbox.height * s * DPI);

        // Per-pixel burn simulation (Section 7.1.3)
        const artData = artCtx.getImageData(0, 0, cw, ch);
        const artPixels = artData.data;

        for (let j = 0; j < artPixels.length; j += 4) {
          const r = artPixels[j];
          const g = artPixels[j+1];
          const b = artPixels[j+2];
          const alpha = artPixels[j+3] / 255;

          if (alpha > 0) {
            const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const burnOpacity = Math.min(1, (1 - luma) * alpha * (burnSetting / 100) * 1.25);
            artPixels[j] = 52;     // Char wood brown RGB
            artPixels[j+1] = 32;
            artPixels[j+2] = 14;
            artPixels[j+3] = Math.round(burnOpacity * 255);
          }
        }
        artCtx.putImageData(artData, 0, 0);

        // Layer burn atop wood
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.drawImage(artCanvas, 0, 0);
        // second pass for depth charring
        ctx.globalAlpha = 0.55;
        ctx.drawImage(artCanvas, 0, 0);
        ctx.restore();

        // 4. Inner-shadow edge charring (Section 7.1.4)
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = cw;
        shadowCanvas.height = ch;
        const shadowCtx = shadowCanvas.getContext('2d')!;
        shadowCtx.fillStyle = '#1c120c';
        shadowCtx.fillRect(0, 0, cw, ch);
        shadowCtx.globalCompositeOperation = 'destination-out';
        shadowCtx.drawImage(maskCanvas, 0, 0);

        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.shadowColor = 'rgba(20, 10, 5, 0.95)';
        ctx.shadowBlur = Math.max(2, 0.02 * DPI);
        ctx.drawImage(shadowCanvas, 0, 0);
        ctx.restore();

        computedMockups.push({
          name: `${part.name}_mockup`,
          cv
        });
      }

      setMockups(computedMockups);
      setStatusMsg(`Generated ${computedMockups.length} realistic part mockups!`);
      setActiveTab("mockups");
    } catch (err: any) {
      console.error(err);
      setStatusMsg(`Mockup render failure: ${err?.message || err}`);
    } finally {
      setNesting(false);
    }
  };

  // Download all mockup images in sequence (Section 7.2)
  const downloadAllMockups = async () => {
    if (mockups.length === 0) return;
    setStatusMsg("Downloading mockup images...");

    for (let i = 0; i < mockups.length; i++) {
      const mock = mockups[i];
      const filename = `${mock.name}-${i + 1}.png`;
      
      // Convert to blob and trigger download
      mock.cv.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Revoke after a grace period
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1500);
      }, 'image/png');

      // Add a 350ms delay to dodge browser multi-download block gates (Section 7.2)
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    setStatusMsg("Mockup batch downloads finished!");
  };

  const triggerDownloadSingleMock = (mock: MockupData, idx: number) => {
    mock.cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${mock.name}-${idx + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      
      {/* Hidden container for getBBox measurements (Section 3.4) */}
      <div 
        ref={hiddenContainerRef} 
        id="measure" 
        className="absolute w-0 h-0 overflow-hidden opacity-0 pointer-events-none" 
      />

      {/* Sidebar - fixed 330px scrollable sidebar (Section 10) */}
      <aside className="w-[330px] flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full z-10 select-none">
        
        {/* Sidebar Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-amber-500 flex items-center justify-center text-zinc-950 font-black text-lg shadow">
              GN
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight text-zinc-50">GrainNest</h1>
              <p className="text-[10px] text-zinc-400">Wood-grain aware laser nester</p>
            </div>
          </div>
          <button 
            id="demoBtn"
            onClick={loadDemoParts}
            className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded flex items-center gap-1 transition font-semibold"
            title="Load built-in parts instantly"
          >
            <Sparkles className="w-3 h-3" /> Demo
          </button>
        </div>

        {/* Scrollable Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 text-xs">
          
          {/* File drop and import (Section 10.2) */}
          <section className="space-y-3">
            <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Import Vector Parts</h2>
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-zinc-700 hover:border-amber-500/50 bg-zinc-950/50 hover:bg-zinc-950 p-5 rounded-lg text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
            >
              <FolderOpen className="w-8 h-8 text-zinc-500 group-hover:text-amber-500 transition" />
              <div>
                <span className="text-amber-400 font-medium">Click to upload</span> or drag SVGs
              </div>
              <div className="text-[10px] text-zinc-500">Group each part (⌘G) in Illustrator</div>
              <input 
                ref={fileInputRef}
                id="fileInput"
                type="file" 
                multiple 
                accept=".svg" 
                onChange={(e) => handleSvgImport(e.target.files)} 
                className="hidden" 
              />
            </div>
            <div className="flex items-center justify-between bg-zinc-950 p-2.5 rounded border border-zinc-800">
              <label htmlFor="onePart" className="text-zinc-300 font-medium">Treat file as ONE part</label>
              <input 
                id="onePart"
                type="checkbox" 
                checked={treatAsOne} 
                onChange={(e) => setTreatAsOne(e.target.checked)} 
                className="w-4 h-4 rounded text-amber-500 accent-amber-500"
              />
            </div>
          </section>

          {/* Sheet Settings (Section 10.2) */}
          <section className="space-y-3">
            <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Virtual Sheet Dimensions</h2>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label htmlFor="preset" className="text-zinc-500 block mb-1">Sheet Preset</label>
                <select 
                  id="preset"
                  value={preset} 
                  onChange={(e) => setPreset(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 focus:border-amber-500 text-zinc-200 outline-none"
                >
                  <option value="19x12">Standard Sheet (19" × 12")</option>
                  <option value="12x20">Glowforge Bed (20" × 12")</option>
                  <option value="12x24">Laser Bed (24" × 12")</option>
                  <option value="18x32">Commercial Bed (32" × 18")</option>
                  <option value="custom">Custom Dimensions</option>
                </select>
              </div>

              <div>
                <label htmlFor="shW" className="text-zinc-500 block mb-1">Width (inches)</label>
                <input 
                  id="shW"
                  type="number" 
                  step="0.1" 
                  value={shW} 
                  onChange={(e) => handleShWChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none text-right"
                />
              </div>

              <div>
                <label htmlFor="shH" className="text-zinc-500 block mb-1">Height (inches)</label>
                <input 
                  id="shH"
                  type="number" 
                  step="0.1" 
                  value={shH} 
                  onChange={(e) => handleShHChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none text-right"
                />
              </div>

              <div>
                <label htmlFor="margin" className="text-zinc-500 block mb-1">Border Margin</label>
                <input 
                  id="margin"
                  type="number" 
                  step="0.05" 
                  value={margin} 
                  onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none text-right"
                />
              </div>

              <div>
                <label htmlFor="spacing" className="text-zinc-500 block mb-1">Part Spacing</label>
                <input 
                  id="spacing"
                  type="number" 
                  step="0.05" 
                  value={spacing} 
                  onChange={(e) => setSpacing(parseFloat(e.target.value) || 0)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none text-right"
                />
              </div>

              <div>
                <label htmlFor="maxSheets" className="text-zinc-500 block mb-1">Max Sheet Count</label>
                <input 
                  id="maxSheets"
                  type="number" 
                  min="1" 
                  max="20" 
                  value={maxSheets} 
                  onChange={(e) => setMaxSheets(Math.min(20, parseInt(e.target.value) || 1))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none text-right"
                />
              </div>

              <div>
                <label htmlFor="precision" className="text-zinc-500 block mb-1">Resolution / Speed</label>
                <select 
                  id="precision"
                  value={precision} 
                  onChange={(e) => setPrecision(parseFloat(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 focus:border-amber-500 outline-none"
                >
                  <option value={0.1}>Fast (0.1")</option>
                  <option value={0.05}>Normal (0.05")</option>
                  <option value={0.025}>Fine (0.025")</option>
                </select>
              </div>
            </div>
          </section>

          {/* Wood Grain (Section 10.2) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Wood Grain Alignment</h2>
              <div className="flex items-center gap-1">
                <input 
                  id="grainOn"
                  type="checkbox" 
                  checked={grainOn} 
                  onChange={(e) => setGrainOn(e.target.checked)} 
                  className="w-3.5 h-3.5 text-amber-500 accent-amber-500 rounded"
                />
                <label htmlFor="grainOn" className="text-zinc-400 font-medium">Lock Grain</label>
              </div>
            </div>

            {grainOn && (
              <div className="space-y-2.5 bg-zinc-950 p-3 rounded border border-zinc-800">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="grainA" className="text-zinc-500 block mb-0.5">Sheet Grain</label>
                    <input 
                      id="grainA"
                      type="number" 
                      min="-180" 
                      max="180" 
                      value={grainA} 
                      onChange={(e) => setGrainA(parseInt(e.target.value) || 0)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 text-right outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="grainTol" className="text-zinc-500 block mb-0.5">Tolerance</label>
                    <select 
                      id="grainTol"
                      value={grainTol} 
                      onChange={(e) => setGrainTol(parseInt(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 outline-none"
                    >
                      <option value={0}>Exact (0°)</option>
                      <option value={1}>±1°</option>
                      <option value={3}>±3°</option>
                      <option value={5}>±5°</option>
                      <option value={10}>±10°</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-900 pt-2">
                  <label htmlFor="flip180" className="text-zinc-400">Allow 180° flips (Symmetric)</label>
                  <input 
                    id="flip180"
                    type="checkbox" 
                    checked={flip180} 
                    onChange={(e) => setFlip180(e.target.checked)}
                    className="w-3.5 h-3.5 text-amber-500 accent-amber-500 rounded"
                  />
                </div>

                <div className="border-t border-zinc-900 pt-2 flex items-center gap-2">
                  <div className="flex-1">
                    <label htmlFor="allGrainA" className="text-zinc-500 block mb-0.5 text-[9px] uppercase">Set All Parts Grain</label>
                    <select 
                      id="allGrainA"
                      value={allGrainA} 
                      onChange={(e) => setAllGrainA(parseInt(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 outline-none"
                    >
                      <option value={0}>Horizontal (0°)</option>
                      <option value={90}>Vertical (90°)</option>
                      <option value={45}>Diagonal (45°)</option>
                      <option value={-45}>Diagonal (-45°)</option>
                    </select>
                  </div>
                  <button 
                    id="applyGrainAll"
                    onClick={applyBulkGrainA}
                    className="self-end bg-amber-500 text-zinc-950 font-bold px-2 py-1 rounded hover:bg-amber-400 transition"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Extras and Import Fallback (Section 10.2) */}
          <section className="space-y-3">
            <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Import & Nesting Extras</h2>
            <div className="space-y-2 bg-zinc-950 p-3 rounded border border-zinc-800">
              <div className="flex items-center justify-between">
                <label htmlFor="inHoles" className="text-zinc-300">Nest inside interior voids</label>
                <input 
                  id="inHoles"
                  type="checkbox" 
                  checked={inHoles} 
                  onChange={(e) => setInHoles(e.target.checked)}
                  className="w-3.5 h-3.5 text-amber-500 accent-amber-500 rounded"
                />
              </div>
              <div className="flex items-center justify-between border-t border-zinc-900 pt-2">
                <label htmlFor="importScale" className="text-zinc-400">Import Scale Fallback</label>
                <select 
                  id="importScale"
                  value={importScale} 
                  onChange={(e) => setImportScale(parseInt(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 outline-none"
                >
                  <option value={72}>Illustrator standard (72 dpi)</option>
                  <option value={96}>Inkscape / CSS standard (96 dpi)</option>
                  <option value={25.4}>Metric drawings (25.4/mm)</option>
                </select>
              </div>
            </div>
          </section>

          {/* Wood Material & Photo Detector (Section 10.2) */}
          <section className="space-y-3">
            <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Wood Material & Photo Detector</h2>
            
            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-3">
              <div>
                <label htmlFor="woodSpecies" className="text-zinc-500 block mb-1 font-bold uppercase text-[9px]">Select Material / Wood Species</label>
                <select 
                  id="woodSpecies"
                  value={woodSpecies} 
                  onChange={(e) => setWoodSpecies(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 focus:border-amber-500 text-zinc-200 outline-none text-xs"
                >
                  <option value="walnut">Walnut (Dark, Rich Grain)</option>
                  <option value="maple">Maple (Light, Subtle Grain)</option>
                  <option value="cherry">Cherry (Warm Reddish Grain)</option>
                  <option value="mahogany">Mahogany (Deep Red-Brown)</option>
                  <option value="oak">Oak (Golden, Prominent Grain)</option>
                  {photo && <option value="custom">★ Custom Uploaded Photo</option>}
                </select>
              </div>

              <div className="border-t border-zinc-900/80 pt-3 space-y-2">
                <div className="text-zinc-500 text-[10px] uppercase font-bold">Or Upload Custom Photo</div>
                <div className="flex gap-1.5">
                  <button 
                    id="photoBtn"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold py-1 px-2.5 rounded border border-zinc-700 transition flex items-center justify-center gap-1"
                  >
                    <Camera className="w-3 h-3 text-amber-500" /> {photo ? "Change Photo" : "Upload Wood Photo"}
                  </button>
                  <input 
                    ref={photoInputRef}
                    id="photoInput"
                    type="file" 
                    accept="image/*" 
                    onChange={handlePhotoFile} 
                    className="hidden" 
                  />
                  {photo && (
                    <>
                      <button 
                        id="photoRot"
                        onClick={rotatePhoto90}
                        className="p-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded transition"
                        title="Rotate 90 degrees"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        id="photoClear"
                        onClick={() => { 
                          setPhoto(null); 
                          setRawPhoto(null); 
                          if (woodSpecies === 'custom') {
                            setWoodSpecies('walnut');
                          }
                        }}
                        className="p-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-red-400 rounded transition"
                        title="Clear photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label htmlFor="autoCrop" className="text-zinc-400">Background Auto-Crop</label>
                  <input 
                    id="autoCrop"
                    type="checkbox" 
                    checked={autoCrop} 
                    onChange={(e) => setAutoCrop(e.target.checked)}
                    className="w-3.5 h-3.5 text-amber-500 accent-amber-500 rounded"
                  />
                </div>
              </div>
            </div>

            {woodSpecies === 'custom' && photo && (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800 flex flex-col items-center gap-3">
                <canvas 
                  ref={photoThumbRef} 
                  id="photoThumb" 
                  className="rounded border border-zinc-700 w-[200px] bg-zinc-900 shadow-inner" 
                />
                <div className="w-full space-y-1.5 text-left">
                  <div className="flex justify-between items-center text-zinc-400">
                    <span>Detected Grain:</span>
                    <span id="grainDet" className="text-amber-400 font-bold text-xs">
                      {photo.grainDeg}° ({photo.coherence >= 0.3 ? 'High' : photo.coherence >= 0.12 ? 'Med' : 'Low'} conf)
                    </span>
                  </div>
                  {photo.coherence >= 0.12 && (
                    <button 
                      id="useGrain"
                      onClick={() => setGrainA(photo.grainDeg)}
                      className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/40 py-1 rounded transition text-center font-semibold text-[10px] uppercase tracking-wider"
                    >
                      Use as Sheet Grain
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Photo Mockup controls (Section 10.2) */}
          {((woodSpecies === 'custom' && photo) || (woodSpecies !== 'custom')) && lastNest && lastNest.placed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Photorealistic Mockups</h2>
              <div className="space-y-2.5 bg-zinc-950 p-3 rounded border border-zinc-800">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="mockDpi" className="text-zinc-500 block mb-0.5">Render Quality</label>
                    <select 
                      id="mockDpi"
                      value={mockDpi} 
                      onChange={(e) => setMockDpi(parseInt(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-200 outline-none"
                    >
                      <option value={96}>Draft (96 DPI)</option>
                      <option value={150}>Standard (150 DPI)</option>
                      <option value={300}>High-Res (300 DPI)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="burnAmt" className="text-zinc-500 block mb-0.5">Burn Darkness: {burnAmt}%</label>
                    <input 
                      id="burnAmt"
                      type="range" 
                      min="20" 
                      max="100" 
                      value={burnAmt} 
                      onChange={(e) => setBurnAmt(parseInt(e.target.value))}
                      className="w-full accent-amber-500 bg-zinc-800 h-1.5 rounded cursor-pointer mt-2"
                    />
                  </div>
                </div>

                <button 
                  id="mockBtn"
                  onClick={renderMockups}
                  disabled={nesting}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-1.5 rounded shadow transition uppercase tracking-wider text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" /> Generate Wood Mockups
                </button>
              </div>
            </section>
          )}

          {/* Parts List Container (Section 10.3) */}
          {parts.length > 0 && (
            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Vector Parts List</h2>
                <span className="text-zinc-500 font-bold">{parts.length} parts</span>
              </div>
              
              <div id="partsList" className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {parts.map(part => {
                  const s = 1 / part.unitsPerIn;
                  const pW = part.bbox.width * s;
                  const pH = part.bbox.height * s;
                  const colorHue = (part.id * 47 + 20) % 360;

                  return (
                    <div key={part.id} className="bg-zinc-950 border border-zinc-800/80 rounded p-2 flex items-center gap-2.5 shadow-sm hover:border-zinc-700 transition">
                      {/* Color marker thumbnail */}
                      <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center relative flex-shrink-0">
                        {part.thumb ? (
                          <img src={part.thumb} alt={part.name} className="max-w-[34px] max-h-[34px] object-contain" />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `hsl(${colorHue}, 62%, 58%)` }} />
                        )}
                        <span 
                          className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full border border-zinc-950" 
                          style={{ backgroundColor: `hsl(${colorHue}, 62%, 58%)` }} 
                        />
                      </div>

                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="font-semibold text-zinc-200 truncate" title={part.name}>{part.name}</div>
                        <div className="text-[10px] text-zinc-500">{pW.toFixed(2)}" × {pH.toFixed(2)}"</div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Qty spinner */}
                        <div className="flex flex-col items-center">
                          <span className="text-[8px] text-zinc-600 font-bold uppercase mb-0.5">Qty</span>
                          <input 
                            type="number" 
                            min="1" 
                            value={part.qty} 
                            onChange={(e) => updatePartQty(part.id, parseInt(e.target.value) || 1)}
                            className="w-10 bg-zinc-900 border border-zinc-800 text-center py-0.5 font-bold rounded text-zinc-200 focus:border-amber-500 outline-none text-xs"
                          />
                        </div>

                        {/* Grain adjustment */}
                        {grainOn && (
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] text-zinc-600 font-bold uppercase mb-0.5">Grain</span>
                            <input 
                              type="number" 
                              value={part.grainA} 
                              onChange={(e) => updatePartGrain(part.id, parseInt(e.target.value) || 0)}
                              className="w-10 bg-zinc-900 border border-zinc-800 text-center py-0.5 font-bold rounded text-zinc-200 focus:border-amber-500 outline-none text-xs"
                            />
                          </div>
                        )}

                        <button 
                          onClick={() => removePart(part.id)}
                          className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-zinc-900 transition"
                          title="Remove part"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

        </div>

        {/* Global Action controls footer (Section 10.3) */}
        <div className="p-4 bg-zinc-950 border-t border-zinc-800 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button 
              id="nestBtn"
              onClick={() => triggerNesting(parts, files)}
              disabled={parts.length === 0 || nesting}
              className="col-span-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-2.5 rounded shadow-lg transition flex items-center justify-center gap-1.5 uppercase tracking-wider text-xs disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-zinc-950" /> Pack & Nest Parts
            </button>
            <button 
              id="exportBtn"
              onClick={triggerExportSvg}
              disabled={!lastNest || lastNest.placed.length === 0 || nesting}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold py-1.5 px-3 rounded border border-zinc-700 transition flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" /> Export SVG
            </button>
            <button 
              id="clearBtn"
              onClick={clearAll}
              className="bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-red-400 font-semibold py-1.5 px-3 rounded border border-zinc-800 hover:border-red-500/30 transition flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All
            </button>
          </div>

          {/* Status feedback line (Section 10) */}
          <div 
            id="status"
            className="text-[10px] text-zinc-400 bg-zinc-900 p-2 rounded border border-zinc-800 flex items-start gap-1.5 font-mono min-h-[36px] overflow-hidden leading-snug select-text"
          >
            {nestingProgress ? (
              <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin flex-shrink-0 mt-0.5" />
            ) : statusMsg.includes("error") || statusMsg.includes("failed") ? (
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            ) : (
              <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="break-all">{statusMsg}</div>
          </div>
        </div>

      </aside>

      {/* Main Panel - fluid scrollable main area (Section 10) */}
      <main className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden relative">
        
        {/* Top Navbar */}
        <header className="h-14 bg-zinc-900/40 border-b border-zinc-800 flex items-center justify-between px-6 select-none flex-shrink-0">
          <div className="flex items-center gap-4">
            <nav className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 gap-1">
              <button 
                onClick={() => setActiveTab("sheets")}
                className={`px-4 py-1.5 rounded-md font-semibold text-xs transition uppercase tracking-wider ${activeTab === 'sheets' ? 'bg-amber-500 text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'}`}
              >
                Virtual Sheets Layout
              </button>
              <button 
                onClick={() => setActiveTab("mockups")}
                disabled={mockups.length === 0}
                className={`px-4 py-1.5 rounded-md font-semibold text-xs transition uppercase tracking-wider ${activeTab === 'mockups' ? 'bg-amber-500 text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:bg-transparent'}`}
              >
                Photo Mockups ({mockups.length})
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {lastNest && (
              <div className="text-zinc-400 text-xs flex items-center gap-3 bg-zinc-900/60 px-3 py-1.5 rounded-lg border border-zinc-800/60 font-mono">
                <div>
                  Sheets: <span className="text-zinc-100 font-bold">{lastNest.sheets.length}</span>
                </div>
                <div>
                  Placed: <span className="text-emerald-400 font-bold">{lastNest.placed.length}</span>
                </div>
                {lastNest.unplaced.length > 0 && (
                  <div className="text-red-400 font-bold">
                    Unplaced: {lastNest.unplaced.length}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Dynamic Workspace Container */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
          
          {/* Virtual Sheets Tab (Section 9) */}
          {activeTab === 'sheets' && (
            <div id="sheetsView" className="w-full max-w-4xl flex flex-col items-center">
              
              {/* Empty placeholder state */}
              {!lastNest && (
                <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500 max-w-md mx-auto space-y-4">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-500/50">
                    <LayersIcon className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-zinc-300">No layout generated yet</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Add vector SVG files, set sheet sizes, and click "Pack & Nest Parts" to generate an optimized laser cut sheet plan.
                    </p>
                  </div>
                  <button 
                    onClick={loadDemoParts}
                    className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 hover:text-amber-400 px-4 py-2 rounded-lg border border-zinc-850 hover:border-amber-500/30 transition text-xs font-semibold"
                  >
                    Load Demo Project
                  </button>
                </div>
              )}

              {/* Stack of Sheets previews (Section 9) */}
              {lastNest && lastNest.sheets.map((sheet, idx) => (
                <SheetPreviewCanvas 
                  key={idx}
                  sheet={sheet}
                  sheetIdx={idx}
                  lastNest={lastNest}
                  photo={photo}
                  parts={parts}
                  cell={lastNest.cell}
                  grainOn={grainOn}
                  grainA={grainOn ? grainA : 0}
                  species={woodSpecies}
                />
              ))}

              {/* Unplaced parts alerts */}
              {lastNest && lastNest.unplaced.length > 0 && (
                <div className="w-full max-w-3xl bg-red-500/10 border border-red-500/30 rounded-lg p-4 mt-2 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-xs text-red-200">The following parts could not be placed:</h4>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-normal">
                      {lastNest.unplaced.join(', ')}. Try adding more sheets, decreasing part padding, or optimizing rotation tolerance.
                    </p>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Photo Mockups Gallery Tab (Section 7.2) */}
          {activeTab === 'mockups' && (
            <div id="mockGal" className="w-full max-w-5xl">
              
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-bold text-zinc-100 text-sm">Cut-Ready photographic Mockups</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Showing parts overlaid on actual wood photo at {mockDpi} DPI.</p>
                </div>
                <button 
                  onClick={downloadAllMockups}
                  className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs px-4 py-2 rounded-lg shadow-md transition flex items-center gap-1.5 uppercase tracking-wider"
                >
                  <Download className="w-3.5 h-3.5 fill-zinc-950" /> Download All PNGs
                </button>
              </div>

              {/* Mockup cards grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {mockups.map((mock, idx) => {
                  const nameParts = mock.name.split('_');
                  const dispName = nameParts.slice(0, -1).join('_') || mock.name;
                  return (
                    <div 
                      key={idx} 
                      className="bg-zinc-900 border border-zinc-800/85 rounded-lg p-3 flex flex-col items-center hover:border-zinc-700 transition"
                    >
                      {/* Transparent checkerboard card background (Section 7.2) */}
                      <div className="w-full h-44 rounded-md border border-zinc-800 bg-[linear-gradient(45deg,#1c1c1c_25%,transparent_25%),linear-gradient(-45deg,#1c1c1c_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1c1c1c_75%),linear-gradient(-45deg,transparent_75%,#1c1c1c_75%)] bg-[size:12px_12px] bg-[position:0_0,0_6px,6px_-6px,6px_0] flex items-center justify-center p-3 overflow-hidden shadow-inner bg-zinc-950">
                        {/* Render active canvas directly */}
                        <div 
                          ref={(el) => {
                            if (el) {
                              el.innerHTML = '';
                              const clonedCanvas = document.createElement('canvas');
                              clonedCanvas.width = mock.cv.width;
                              clonedCanvas.height = mock.cv.height;
                              clonedCanvas.style.maxWidth = '100%';
                              clonedCanvas.style.maxHeight = '100%';
                              clonedCanvas.style.objectFit = 'contain';
                              const cCtx = clonedCanvas.getContext('2d')!;
                              cCtx.drawImage(mock.cv, 0, 0);
                              el.appendChild(clonedCanvas);
                            }
                          }}
                          className="w-full h-full flex items-center justify-center"
                        />
                      </div>
                      
                      <div className="w-full flex justify-between items-center mt-3 text-xs">
                        <div className="font-semibold text-zinc-300 truncate max-w-[130px]" title={dispName}>
                          {dispName}
                        </div>
                        <button 
                          onClick={() => triggerDownloadSingleMock(mock, idx)}
                          className="p-1.5 bg-zinc-800 hover:bg-zinc-750 text-amber-400 hover:text-amber-300 rounded border border-zinc-700/80 transition"
                          title="Download individual PNG"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}

        </div>

      </main>

    </div>
  );
}

// Simple fallback Layers icon (when lucide fails)
function LayersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-10 5 10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}
