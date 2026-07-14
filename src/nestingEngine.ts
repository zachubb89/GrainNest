import { FileRecord, PartRecord, BoundingBox, RasterData, Placement, SheetGrid } from './types';

// Detect units per inch (Section 3.2)
export function detectUnitsPerIn(rootSvg: SVGSVGElement, fallbackScale: number): number {
  const widthAttr = rootSvg.getAttribute('width');
  const viewBoxAttr = rootSvg.getAttribute('viewBox');

  if (widthAttr && viewBoxAttr) {
    const match = widthAttr.trim().match(/^([0-9.]+)\s*(in|pt|mm|cm)$/i);
    if (match) {
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      let widthInInches = val;
      if (unit === 'pt') widthInInches = val / 72;
      else if (unit === 'mm') widthInInches = val / 25.4;
      else if (unit === 'cm') widthInInches = val / 2.54;

      const vbParts = viewBoxAttr.trim().split(/[\s,]+/);
      if (vbParts.length === 4) {
        const vbWidth = parseFloat(vbParts[2]);
        if (!isNaN(vbWidth) && vbWidth > 0 && widthInInches > 0) {
          return vbWidth / widthInInches;
        }
      }
    }
  }
  return fallbackScale;
}

const JUNK_TAGS = new Set(['defs', 'style', 'metadata', 'title', 'desc', 'script']);
function isJunk(el: Element): boolean {
  return JUNK_TAGS.has(el.tagName.toLowerCase());
}

function getNonJunkChildren(el: Element): Element[] {
  return Array.from(el.children).filter(child => !isJunk(child));
}

// Extract parts from parsed SVG (Section 3.3)
export function extractPartsFromSvg(
  svgDoc: Document,
  fileName: string,
  fallbackScale: number,
  treatAsOne: boolean,
  hiddenSvgContainer: HTMLDivElement,
  startId: number,
  fileIdx: number
): { file: FileRecord; parts: PartRecord[] } {
  const rootSvg = svgDoc.documentElement as unknown as SVGSVGElement;
  if (!rootSvg || rootSvg.tagName.toLowerCase() !== 'svg') {
    throw new Error("Invalid root SVG element");
  }

  // Collect style and defs
  let defsConcat = '';
  let styleConcat = '';

  const defsElements = svgDoc.getElementsByTagName('defs');
  for (let i = 0; i < defsElements.length; i++) {
    defsConcat += defsElements[i].outerHTML;
  }

  const styleElements = svgDoc.getElementsByTagName('style');
  for (let i = 0; i < styleElements.length; i++) {
    styleConcat += styleElements[i].textContent || '';
  }

  // Detect scale
  const unitsPerIn = detectUnitsPerIn(rootSvg, fallbackScale);

  // Unwrap up to 6 levels of container wrapping (Section 3.3.2)
  let currentContainer: Element = rootSvg;
  let depth = 0;
  while (depth < 6) {
    const children = getNonJunkChildren(currentContainer);
    if (children.length === 1 && children[0].tagName.toLowerCase() === 'g') {
      const gChildren = getNonJunkChildren(children[0]);
      if (gChildren.length > 0) {
        currentContainer = children[0];
        depth++;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  const children = getNonJunkChildren(currentContainer);
  const partElements: { name: string; markup: string }[] = [];

  const fileStem = fileName.replace(/\.svg$/i, '');

  if (treatAsOne) {
    // Treat whole file as one part (Section 3.3.4)
    if (children.length > 0) {
      const inner = children.map(c => c.outerHTML).join('');
      partElements.push({
        name: fileStem,
        markup: `<g>${inner}</g>`
      });
    }
  } else {
    // Normal split
    children.forEach((child, index) => {
      const idAttr = child.getAttribute('id');
      const decodedName = idAttr ? idAttr.replace(/_x5F_/g, '_') : `${fileStem} #${index + 1}`;
      partElements.push({
        name: decodedName,
        markup: child.outerHTML
      });
    });
  }

  const parts: PartRecord[] = [];
  let currentId = startId;

  // Measure bboxes and build PartRecords (Section 3.4)
  partElements.forEach(pe => {
    const bbox = getBBoxOfMarkup(pe.markup, defsConcat, hiddenSvgContainer);
    // Discard empty or zero-area parts
    if (bbox.width > 0 && bbox.height > 0) {
      parts.push({
        id: currentId++,
        name: pe.name,
        fileIdx,
        qty: 1,
        grainA: 0,
        bbox,
        unitsPerIn,
        markup: pe.markup,
        thumb: null
      });
    }
  });

  return {
    file: {
      name: fileName,
      defs: defsConcat,
      style: styleConcat
    },
    parts
  };
}

// Compute bounding box by DOM-injecting group into hidden SVG (Section 3.4)
export function getBBoxOfMarkup(markup: string, defs: string, container: HTMLDivElement): BoundingBox {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Set inline styling to resolve correctly
  svg.style.width = "2000px";
  svg.style.height = "2000px";
  svg.innerHTML = defs + markup;
  container.appendChild(svg);
  const child = svg.lastElementChild as SVGGraphicsElement;
  let bbox = { x: 0, y: 0, width: 0, height: 0 };
  if (child && typeof child.getBBox === 'function') {
    try {
      const b = child.getBBox();
      bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
    } catch (e) {
      console.error("Error calling getBBox", e);
    }
  }
  container.removeChild(svg);
  return bbox;
}

// Create small silhouette URL for thumbnails (Section 3.5)
export function createThumbnailUrl(
  part: PartRecord,
  fileStyle: string,
  fileDefs: string
): Promise<string> {
  return new Promise((resolve) => {
    const padIn = 0.2; // Pad slightly for visual balance
    const bbox = part.bbox;
    const s = 1 / part.unitsPerIn;
    const padSrc = padIn * part.unitsPerIn;
    const vx = bbox.x - padSrc;
    const vy = bbox.y - padSrc;
    const vw = bbox.width + 2 * padSrc;
    const vh = bbox.height + 2 * padSrc;

    // Fixed small thumbnail image density
    const size = 76;
    const aspect = vw / vh;
    let wPx = size;
    let hPx = size;
    if (aspect > 1) {
      hPx = Math.round(size / aspect);
    } else {
      wPx = Math.round(size * aspect);
    }

    const svgStr = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="${vx} ${vy} ${vw} ${vh}">
        <style>
          ${fileStyle}
          * { fill:#f59e0b !important; fill-opacity:1 !important; opacity:1 !important;
              stroke-opacity:1 !important; visibility:visible !important; display:inline !important }
        </style>
        ${fileDefs}
        ${part.markup}
      </svg>
    `;

    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    resolve(url);
  });
}

// Chebyshev/8-neighbor dilation (Section 4.5)
export function computeDilation(raw: Int32Array, gapR: number): Int32Array {
  if (gapR <= 0) return raw;
  const set = new Set<string>();
  const len = raw.length;
  for (let i = 0; i < len; i += 2) {
    const rx = raw[i];
    const ry = raw[i+1];
    for (let dy = -gapR; dy <= gapR; dy++) {
      for (let dx = -gapR; dx <= gapR; dx++) {
        set.add((rx + dx) + ',' + (ry + dy));
      }
    }
  }
  const dil = new Int32Array(set.size * 2);
  let idx = 0;
  for (const item of set) {
    const comma = item.indexOf(',');
    const x = parseInt(item.substring(0, comma), 10);
    const y = parseInt(item.substring(comma + 1), 10);
    dil[idx++] = x;
    dil[idx++] = y;
  }
  return dil;
}

// Deterministic seeded shuffle (Section 4.5.3)
export function seededShuffle(arr: Int32Array) {
  const n = arr.length / 2;
  let seed = 42;
  function nextRand() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    const tx = arr[i * 2];
    const ty = arr[i * 2 + 1];
    arr[i * 2] = arr[j * 2];
    arr[i * 2 + 1] = arr[j * 2 + 1];
    arr[j * 2] = tx;
    arr[j * 2 + 1] = ty;
  }
}

// Hole flood fill algorithm (Section 4.4)
export function fillHoles(raw: Int32Array, wC: number, hC: number): Int32Array {
  const gW = wC + 2;
  const gH = hC + 2;
  const grid = new Uint8Array(gW * gH); // 0 = empty, 1 = occupied, 2 = outside/visited

  // Draw the trimmed raw cells in the local padded grid
  for (let i = 0; i < raw.length; i += 2) {
    const rx = raw[i];
    const ry = raw[i+1];
    const gx = rx + 1;
    const gy = ry + 1;
    if (gx >= 0 && gx < gW && gy >= 0 && gy < gH) {
      grid[gy * gW + gx] = 1;
    }
  }

  // Flood fill from coordinates (0, 0)
  const q: number[] = [0, 0];
  grid[0] = 2;
  let head = 0;
  while (head < q.length) {
    const cx = q[head++];
    const cy = q[head++];

    const dirs = [-1, 0, 1, 0, 0, -1, 0, 1];
    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d * 2];
      const ny = cy + dirs[d * 2 + 1];
      if (nx >= 0 && nx < gW && ny >= 0 && ny < gH) {
        const idx = ny * gW + nx;
        if (grid[idx] === 0) {
          grid[idx] = 2;
          q.push(nx, ny);
        }
      }
    }
  }

  // Any cell inside grid (1 to wC, 1 to hC) that is NOT 2 is part of the filled silhouette
  const filled: number[] = [];
  for (let y = 0; y < hC; y++) {
    for (let x = 0; x < wC; x++) {
      const idx = (y + 1) * gW + (x + 1);
      if (grid[idx] !== 2) {
        filled.push(x, y);
      }
    }
  }
  return new Int32Array(filled);
}

// Silhouette rendering & rasterization (Section 4.2 - 4.5)
export async function rasterizePart(
  part: PartRecord,
  fileStyle: string,
  fileDefs: string,
  cell: number,
  gapIn: number,
  packHoles: boolean,
  angle: number
): Promise<RasterData> {
  const padIn = Math.max(0.1, 4 * cell);
  const bbox = part.bbox;
  const s = 1 / part.unitsPerIn;

  const padSrc = padIn * part.unitsPerIn;
  const vx = bbox.x - padSrc;
  const vy = bbox.y - padSrc;
  const vw = bbox.width + 2 * padSrc;
  const vh = bbox.height + 2 * padSrc;

  const vwIn = vw * s;
  const vhIn = vh * s;
  const SS = 2;
  const wPx = Math.ceil(vwIn * (SS / cell));
  const hPx = Math.ceil(vhIn * (SS / cell));

  const svgStr = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="${vx} ${vy} ${vw} ${vh}">
      <style>
        ${fileStyle}
        * { fill:#000 !important; fill-opacity:1 !important; opacity:1 !important;
            stroke-opacity:1 !important; visibility:visible !important; display:inline !important }
      </style>
      ${fileDefs}
      ${part.markup}
    </svg>
  `;

  const img = await loadImageFromSvgString(svgStr);

  const angleRad = (angle * Math.PI) / 180;
  const cw = Math.ceil(Math.abs(wPx * Math.cos(angleRad)) + Math.abs(hPx * Math.sin(angleRad)));
  const ch = Math.ceil(Math.abs(wPx * Math.sin(angleRad)) + Math.abs(hPx * Math.cos(angleRad)));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(angleRad);
  ctx.drawImage(img, -wPx / 2, -hPx / 2);

  const imgData = ctx.getImageData(0, 0, cw, ch);
  const pixels = imgData.data;

  const gridW = Math.ceil(cw / SS);
  const gridH = Math.ceil(ch / SS);

  const occupiedCells = new Uint8Array(gridW * gridH);
  let hasOccupied = false;

  for (let cy = 0; cy < gridH; cy++) {
    for (let cx = 0; cx < gridW; cx++) {
      let isCellOccupied = false;
      for (let sy = 0; sy < SS; sy++) {
        const py = cy * SS + sy;
        if (py >= ch) continue;
        for (let sx = 0; sx < SS; sx++) {
          const px = cx * SS + sx;
          if (px >= cw) continue;
          const alpha = pixels[(py * cw + px) * 4 + 3];
          if (alpha > 16) {
            isCellOccupied = true;
            break;
          }
        }
        if (isCellOccupied) break;
      }
      if (isCellOccupied) {
        occupiedCells[cy * gridW + cx] = 1;
        hasOccupied = true;
      }
    }
  }

  let minCX = gridW, maxCX = -1, minCY = gridH, maxCY = -1;
  for (let cy = 0; cy < gridH; cy++) {
    for (let cx = 0; cx < gridW; cx++) {
      if (occupiedCells[cy * gridW + cx] === 1) {
        if (cx < minCX) minCX = cx;
        if (cx > maxCX) maxCX = cx;
        if (cy < minCY) minCY = cy;
        if (cy > maxCY) maxCY = cy;
      }
    }
  }

  let raw: Int32Array;
  let wC = 0;
  let hC = 0;
  let orgX = 0;
  let orgY = 0;

  if (hasOccupied) {
    wC = maxCX - minCX + 1;
    hC = maxCY - minCY + 1;
    const rawList: number[] = [];
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        if (occupiedCells[cy * gridW + cx] === 1) {
          rawList.push(cx - minCX, cy - minCY);
        }
      }
    }
    raw = new Int32Array(rawList);

    if (!packHoles) {
      raw = fillHoles(raw, wC, hC);
    }

    orgX = (minCX * SS - cw / 2) * (cell / SS);
    orgY = (minCY * SS - ch / 2) * (cell / SS);
  } else {
    raw = new Int32Array(0);
  }

  const gapR = Math.ceil(gapIn / cell);
  const dil = computeDilation(raw, gapR);
  seededShuffle(dil);

  return {
    raw,
    dil,
    wC,
    hC,
    orgX,
    orgY,
    canvas,
    angle
  };
}

export function loadImageFromSvgString(svgStr: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Photo Auto-crop Algorithm (Section 6.1)
export function autoCropPhoto(
  img: HTMLCanvasElement | HTMLImageElement
): { x: number; y: number; w: number; h: number; success: boolean } {
  const maxDim = 240;
  const rawW = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const rawH = 'naturalHeight' in img ? img.naturalHeight : img.height;

  let scale = 1;
  if (Math.max(rawW, rawH) > maxDim) {
    scale = maxDim / Math.max(rawW, rawH);
  }

  const w = Math.round(rawW * scale);
  const h = Math.round(rawH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const pixels = imgData.data;

  const cx0 = Math.floor(w * 0.38);
  const cx1 = Math.floor(w * 0.62);
  const cy0 = Math.floor(h * 0.38);
  const cy1 = Math.floor(h * 0.62);

  let rSum = 0, gSum = 0, bSum = 0, count = 0;

  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const idx = (y * w + x) * 4;
      rSum += pixels[idx];
      gSum += pixels[idx+1];
      bSum += pixels[idx+2];
      count++;
    }
  }

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;

  const distances = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const dr = pixels[i * 4] - rMean;
    const dg = pixels[i * 4 + 1] - gMean;
    const db = pixels[i * 4 + 2] - bMean;
    distances[i] = Math.sqrt(dr*dr + dg*dg + db*db);
  }

  const sortedDists = Array.from(distances).sort((a, b) => a - b);
  const p95 = sortedDists[Math.floor(sortedDists.length * 0.95)] || 0;
  const thr = Math.max(34, p95 * 1.7);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (distances[i] <= thr) {
      mask[i] = 1;
    }
  }

  const dilatedMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 1) {
        dilatedMask[idx] = 1;
        if (x > 0) dilatedMask[idx - 1] = 1;
        if (x < w - 1) dilatedMask[idx + 1] = 1;
        if (y > 0) dilatedMask[idx - w] = 1;
        if (y < h - 1) dilatedMask[idx + w] = 1;
      }
    }
  }

  const startX = Math.floor(w / 2);
  const startY = Math.floor(h / 2);
  const filled = new Uint8Array(w * h);
  const q: number[] = [startX, startY];

  if (dilatedMask[startY * w + startX] === 1) {
    filled[startY * w + startX] = 1;
  }

  let head = 0;
  while (head < q.length) {
    const cx = q[head++];
    const cy = q[head++];

    const dirs = [-1, 0, 1, 0, 0, -1, 0, 1];
    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d * 2];
      const ny = cy + dirs[d * 2 + 1];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const idx = ny * w + nx;
        if (dilatedMask[idx] === 1 && filled[idx] === 0) {
          filled[idx] = 1;
          q.push(nx, ny);
        }
      }
    }
  }

  let minX = w, maxX = -1, minY = h, maxY = -1;
  let filledCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y * w + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        filledCount++;
      }
    }
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const fallback = { x: 0, y: 0, w: rawW, h: rawH, success: false };

  if (filledCount === 0 || (filledCount / (w * h)) < 0.15 || (cropW / w) < 0.20 || (cropH / h) < 0.20) {
    return fallback;
  }

  const insetX = Math.round(cropW * 0.02);
  const insetY = Math.round(cropH * 0.02);

  const finalMinX = Math.max(0, minX + insetX);
  const finalMaxX = Math.min(w - 1, maxX - insetX);
  const finalMinY = Math.max(0, minY + insetY);
  const finalMaxY = Math.min(h - 1, maxY - insetY);

  if (finalMaxX <= finalMinX || finalMaxY <= finalMinY) {
    return fallback;
  }

  const finalXRaw = Math.round(finalMinX / scale);
  const finalYRaw = Math.round(finalMinY / scale);
  const finalWRaw = Math.round((finalMaxX - finalMinX + 1) / scale);
  const finalHRaw = Math.round((finalMaxY - finalMinY + 1) / scale);

  return {
    x: Math.max(0, finalXRaw),
    y: Math.max(0, finalYRaw),
    w: Math.min(rawW - finalXRaw, finalWRaw),
    h: Math.min(rawH - finalYRaw, finalHRaw),
    success: true,
  };
}

// Grain direction Sobel structure tensor detector (Section 6.2)
export function detectGrainDirection(
  img: HTMLCanvasElement | HTMLImageElement,
  cropRect: { x: number; y: number; w: number; h: number }
): { angleDeg: number; coherence: number } {
  const maxDim = 420;
  let scale = 1;
  const cw = cropRect.w;
  const ch = cropRect.h;
  if (Math.max(cw, ch) > maxDim) {
    scale = maxDim / Math.max(cw, ch);
  }

  const w = Math.round(cw * scale);
  const h = Math.round(ch * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const pixels = imgData.data;

  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
  }

  let Jxx = 0, Jyy = 0, Jxy = 0;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = (r: number, c: number) => r * w + c;

      const gx =
        -1 * luma[idx(y - 1, x - 1)] + 1 * luma[idx(y - 1, x + 1)] +
        -2 * luma[idx(y, x - 1)]     + 2 * luma[idx(y, x + 1)] +
        -1 * luma[idx(y + 1, x - 1)] + 1 * luma[idx(y + 1, x + 1)];

      const gy =
        -1 * luma[idx(y - 1, x - 1)] - 2 * luma[idx(y - 1, x)] - 1 * luma[idx(y - 1, x + 1)] +
         1 * luma[idx(y + 1, x - 1)] + 2 * luma[idx(y + 1, x)] + 1 * luma[idx(y + 1, x + 1)];

      Jxx += gx * gx;
      Jyy += gy * gy;
      Jxy += gx * gy;
    }
  }

  let grainDeg = 0;
  let coherence = 0;

  if (Jxx + Jyy > 0) {
    const theta = 0.5 * Math.atan2(2 * Jxy, Jxx - Jyy);
    const grainA = theta + Math.PI / 2;
    grainDeg = (grainA * 180) / Math.PI;

    while (grainDeg <= -90) grainDeg += 180;
    while (grainDeg > 90) grainDeg -= 180;

    grainDeg = Math.round(grainDeg * 2) / 2;
    coherence = Math.sqrt((Jxx - Jyy) ** 2 + 4 * (Jxy * Jxy)) / (Jxx + Jyy);
  }

  return {
    angleDeg: grainDeg,
    coherence,
  };
}

// Generate preference-ordered candidate angles (Section 5.2)
export function getCandidateAngles(
  sheetGrain: number,
  partGrain: number,
  tol: number,
  flipsAllowed: boolean,
  grainLockOn: boolean
): number[] {
  if (!grainLockOn) {
    return [0, 90, 180, 270];
  }

  const baseRot = sheetGrain - partGrain;
  const deltas: number[] = [0];
  if (tol >= 1.5) {
    deltas.push(tol / 2, -tol / 2);
  }
  if (tol > 0 && tol !== tol / 2) {
    deltas.push(tol, -tol);
  }

  const angles: number[] = [];
  deltas.forEach(d => {
    angles.push(baseRot + d);
    if (flipsAllowed) {
      angles.push(baseRot + d + 180);
    }
  });

  const normalized = angles.map(a => {
    let norm = a % 360;
    if (norm < 0) norm += 360;
    return Math.round(norm * 1000) / 1000;
  });

  const unique: number[] = [];
  normalized.forEach(n => {
    if (!unique.includes(n)) {
      unique.push(n);
    }
  });

  return unique;
}

// Pre-rasterize all parts at their candidate angles (Section 5.2 / 5.3)
export async function preRasterizeParts(
  parts: PartRecord[],
  files: FileRecord[],
  cell: number,
  gapIn: number,
  packHoles: boolean,
  sheetGrain: number,
  tol: number,
  flipsAllowed: boolean,
  grainLockOn: boolean,
  onProgress?: (msg: string) => void
): Promise<Map<string, RasterData>> {
  const cache = new Map<string, RasterData>();
  
  // Find all required part/angle pairs
  const required: { part: PartRecord; angle: number }[] = [];
  parts.forEach(part => {
    const angles = getCandidateAngles(sheetGrain, part.grainA, tol, flipsAllowed, grainLockOn);
    angles.forEach(angle => {
      required.push({ part, angle });
    });
  });

  const total = required.length;
  for (let i = 0; i < total; i++) {
    const { part, angle } = required[i];
    const file = files[part.fileIdx];
    if (onProgress) {
      onProgress(`Rasterizing "${part.name}" at ${angle}° (${i + 1}/${total})...`);
    }
    const raster = await rasterizePart(part, file.style, file.defs, cell, gapIn, packHoles, angle);
    cache.set(`${part.id}_${angle}`, raster);
  }

  return cache;
}

// Placement check (Section 5.3)
export function checkLegality(
  sheet: SheetGrid,
  marginC: number,
  raster: RasterData,
  cx: number,
  cy: number
): boolean {
  const { raw, dil, wC, hC } = raster;
  const W = sheet.W;
  const H = sheet.H;

  // 1. Raw extent must fit inside sheet boundaries inset by marginC
  if (cx < marginC || cx + wC > W - marginC || cy < marginC || cy + hC > H - marginC) {
    return false;
  }

  // Check every individual raw offset
  const rawLen = raw.length;
  for (let i = 0; i < rawLen; i += 2) {
    const px = cx + raw[i];
    const py = cy + raw[i+1];
    if (px < marginC || px >= W - marginC || py < marginC || py >= H - marginC) {
      return false;
    }
  }

  // 2. No dilated offset can land on an occupied cell on the sheet
  const dilLen = dil.length;
  for (let i = 0; i < dilLen; i += 2) {
    const px = cx + dil[i];
    const py = cy + dil[i+1];
    if (px >= 0 && px < W && py >= 0 && py < H) {
      if (sheet.occ[py * W + px] === 1) {
        return false;
      }
    }
  }

  return true;
}

// Mark sheet cells as occupied (Section 5.3)
export function placePartOnSheet(
  sheet: SheetGrid,
  raster: RasterData,
  cx: number,
  cy: number
) {
  const { raw } = raster;
  const W = sheet.W;
  const len = raw.length;
  let markedCount = 0;

  for (let i = 0; i < len; i += 2) {
    const px = cx + raw[i];
    const py = cy + raw[i+1];
    const idx = py * W + px;
    if (sheet.occ[idx] === 0) {
      sheet.occ[idx] = 1;
      markedCount++;
    }
  }

  sheet.free -= markedCount;
  sheet.used += markedCount;
}

// CSS Scoping utility (Section 8)
export function scopeCss(cssText: string, fileIdx: number): string {
  // Simple regex to prepend .fN to each selector part
  return cssText.replace(/([^\s{][^{]*)\{/g, (_, selector) => {
    const scopedSelector = selector.split(',')
      .map((s: string) => `.f${fileIdx} ${s.trim()}`)
      .join(', ');
    return scopedSelector + ' {';
  });
}

// Export nested parts back to Illustrator-compatible physical scale SVG (Section 8)
export function exportSvg(
  lastNest: { Win: number; Hin: number; placed: Placement[] },
  parts: PartRecord[],
  files: FileRecord[]
): string {
  const { Win, Hin, placed } = lastNest;
  
  // Calculate total width based on sheets laid out side by side with a 1" gap
  let maxSheetIdx = 0;
  placed.forEach(p => {
    if (p.sheet > maxSheetIdx) maxSheetIdx = p.sheet;
  });
  const totalW = (maxSheetIdx + 1) * Win + maxSheetIdx * 1.0;

  // Build scoped styles
  let scopedStyles = '';
  files.forEach((file, idx) => {
    if (file.style) {
      scopedStyles += `/* Styles for ${file.name} */\n` + scopeCss(file.style, idx) + '\n';
    }
  });

  // Concatenate defs
  let allDefs = '';
  files.forEach(file => {
    if (file.defs) {
      allDefs += file.defs + '\n';
    }
  });

  // Sheet outlines
  let sheetOutlinesGroup = '<g id="sheet-outlines">\n';
  for (let i = 0; i <= maxSheetIdx; i++) {
    const sheetOffsetX = i * (Win + 1.0);
    sheetOutlinesGroup += `  <rect x="${sheetOffsetX.toFixed(4)}" y="0" width="${Win.toFixed(4)}" height="${Hin.toFixed(4)}" fill="none" stroke="#00ffff" stroke-width="0.01" stroke-dasharray="0.1,0.1" />\n`;
  }
  sheetOutlinesGroup += '</g>\n';

  // Placed parts
  let nestedPartsGroup = '<g id="nested-parts">\n';
  placed.forEach(p => {
    const part = parts.find(pt => pt.id === p.partId);
    if (!part) return;

    const s = 1 / part.unitsPerIn;
    const Cs_x = (part.bbox.x + part.bbox.width / 2) * s;
    const Cs_y = (part.bbox.y + part.bbox.height / 2) * s;

    const sheetOffsetX = p.sheet * (Win + 1.0);
    const tx = p.X - p.orgX - Cs_x + sheetOffsetX;
    const ty = p.Y - p.orgY - Cs_y;

    nestedPartsGroup += `  <g class="f${part.fileIdx}" data-part="${part.name.replace(/"/g, '&quot;')}" transform="translate(${tx.toFixed(4)} ${ty.toFixed(4)}) rotate(${p.angle.toFixed(4)} ${Cs_x.toFixed(4)} ${Cs_y.toFixed(4)}) scale(${s.toFixed(6)})">\n`;
    nestedPartsGroup += `    ${part.markup}\n`;
    nestedPartsGroup += '  </g>\n';
  });
  nestedPartsGroup += '</g>\n';

  const svgOutput = `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${totalW.toFixed(4)}in" height="${Hin.toFixed(4)}in" viewBox="0 0 ${totalW.toFixed(4)} ${Hin.toFixed(4)}">
  <defs>
    <style type="text/css">
      ${scopedStyles}
    </style>
    ${allDefs}
  </defs>
  ${sheetOutlinesGroup}
  ${nestedPartsGroup}
</svg>`;

  return svgOutput;
}

// Single instance placement handler (Section 5.3)
export function placeSingleInstance(
  inst: { part: PartRecord },
  sheets: SheetGrid[],
  maxSheets: number,
  margin: number,
  cell: number,
  rastersCache: Map<string, RasterData>,
  sheetGrain: number,
  tol: number,
  flipsAllowed: boolean,
  grainLockOn: boolean
): { placement: Placement; sheetsUpdated: SheetGrid[] } | null {
  const part = inst.part;
  const angles = getCandidateAngles(sheetGrain, part.grainA, tol, flipsAllowed, grainLockOn);
  const marginC = Math.round(margin / cell);

  // Search sheets sequentially (FDD + Bottom-Left)
  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheet = sheets[sIdx];
    const W = sheet.W;
    const H = sheet.H;

    // Sweeping columns (cx) then rows (cy) for bottom-left packing (Section 5.3)
    for (let cx = marginC; cx < W - marginC; cx++) {
      for (let cy = marginC; cy < H - marginC; cy++) {
        for (let aIdx = 0; aIdx < angles.length; aIdx++) {
          const angle = angles[aIdx];
          const raster = rastersCache.get(`${part.id}_${angle}`);
          if (!raster) continue;

          if (checkLegality(sheet, marginC, raster, cx, cy)) {
            // Found a legal spot!
            const clonedSheets = sheets.map((sh, idx) => {
              if (idx === sIdx) {
                const newOcc = new Uint8Array(sh.occ.length);
                newOcc.set(sh.occ);
                const newSh = {
                  ...sh,
                  occ: newOcc
                };
                placePartOnSheet(newSh, raster, cx, cy);
                return newSh;
              }
              return sh;
            });

            const placement: Placement = {
              partId: part.id,
              sheet: sIdx,
              X: cx * cell,
              Y: cy * cell,
              angle,
              orgX: raster.orgX,
              orgY: raster.orgY
            };

            return {
              placement,
              sheetsUpdated: clonedSheets
            };
          }
        }
      }
    }
  }

  // If we can spin up a new sheet within maximum limit (Section 5.4)
  if (sheets.length < maxSheets) {
    const firstSheet = sheets[0];
    const newSheet: SheetGrid = {
      W: firstSheet.W,
      H: firstSheet.H,
      occ: new Uint8Array(firstSheet.W * firstSheet.H),
      free: firstSheet.W * firstSheet.H,
      used: 0
    };

    const updatedSheets = [...sheets, newSheet];
    const sIdx = updatedSheets.length - 1;
    const sheet = updatedSheets[sIdx];
    const W = sheet.W;
    const H = sheet.H;

    for (let cx = marginC; cx < W - marginC; cx++) {
      for (let cy = marginC; cy < H - marginC; cy++) {
        for (let aIdx = 0; aIdx < angles.length; aIdx++) {
          const angle = angles[aIdx];
          const raster = rastersCache.get(`${part.id}_${angle}`);
          if (!raster) continue;

          if (checkLegality(sheet, marginC, raster, cx, cy)) {
            const newOcc = new Uint8Array(sheet.occ.length);
            newOcc.set(sheet.occ);
            const newSh = {
              ...sheet,
              occ: newOcc
            };
            placePartOnSheet(newSh, raster, cx, cy);
            updatedSheets[sIdx] = newSh;

            const placement: Placement = {
              partId: part.id,
              sheet: sIdx,
              X: cx * cell,
              Y: cy * cell,
              angle,
              orgX: raster.orgX,
              orgY: raster.orgY
            };

            return {
              placement,
              sheetsUpdated: updatedSheets
            };
          }
        }
      }
    }
  }

  return null;
}


