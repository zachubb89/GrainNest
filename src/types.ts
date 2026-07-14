export interface FileRecord {
  name: string;
  defs: string;
  style: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PartRecord {
  id: number;
  name: string;
  fileIdx: number;
  qty: number;
  grainA: number; // Part grain angle in degrees (0 = horizontal)
  bbox: BoundingBox;
  unitsPerIn: number;
  markup: string;
  thumb: string | null; // Object URL or base64 data URL
}

export interface SheetGrid {
  W: number;
  H: number;
  occ: Uint8Array;
  free: number;
  used: number;
}

export interface RasterData {
  raw: Int32Array; // Relative occupied offsets [dx, dy, ...]
  dil: Int32Array; // Dilated occupied offsets [dx, dy, ...]
  wC: number; // Trimmed width in cells
  hC: number; // Trimmed height in cells
  orgX: number; // Offset of min corner from part rotation center (inches)
  orgY: number; // Offset of min corner from part rotation center (inches)
  canvas: HTMLCanvasElement; // Rotated silhouette canvas
  angle: number; // Rotated angle in degrees
}

export interface Placement {
  partId: number;
  angle: number; // Rotated angle in degrees
  X: number; // Inches from sheet left boundary (trimmed min-corner)
  Y: number; // Inches from sheet top boundary (trimmed min-corner)
  sheet: number; // Sheet index
  orgX: number;
  orgY: number;
}

export interface LastNest {
  Win: number;
  Hin: number;
  cell: number;
  marginIn: number;
  gapIn: number;
  grainA: number | null; // Sheet grain angle used, null if unlocked
  sheets: SheetGrid[];
  placed: Placement[];
  unplaced: string[];
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoData {
  img: HTMLCanvasElement; // Cropped and baked photo
  w: number;
  h: number;
  grainDeg: number;
  coherence: number;
  crop: CropRect;
}

export interface MockupData {
  name: string;
  cv: HTMLCanvasElement;
}
