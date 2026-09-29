import type { ComponentCaptureMode, UIComponentSnapshot } from '../shared/types';

export interface CssBounds { x: number; y: number; width: number; height: number }
export interface CaptureViewport { width: number; height: number; devicePixelRatio: number }
export interface PixelCrop { x: number; y: number; width: number; height: number; partial: boolean; visibleBounds: CssBounds }

/** Map CSS viewport bounds to actual screenshot pixels (accounts for browser zoom and DPR). */
export function calculateScreenshotCrop(
  bounds: CssBounds,
  viewport: CaptureViewport,
  image: { width: number; height: number },
  mode: ComponentCaptureMode,
  padding = 16,
): PixelCrop {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) throw new Error('Screenshot or viewport has no usable dimensions.');
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const elementRight = bounds.x + bounds.width;
  const elementBottom = bounds.y + bounds.height;
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(viewport.width, elementRight);
  const bottom = Math.min(viewport.height, elementBottom);
  const visibleBounds = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  const partial = bounds.x < 0 || bounds.y < 0 || elementRight > viewport.width || elementBottom > viewport.height;

  if (mode === 'viewport') return { x: 0, y: 0, width: image.width, height: image.height, partial: false, visibleBounds: { x: 0, y: 0, width: viewport.width, height: viewport.height } };
  if (visibleBounds.width <= 0 || visibleBounds.height <= 0) throw new Error('The selected element is outside the visible viewport. Scroll it into view before capturing.');

  const safePadding = mode === 'context' ? Math.max(0, Math.min(256, padding)) : 0;
  const cropLeft = Math.max(0, left - safePadding);
  const cropTop = Math.max(0, top - safePadding);
  const cropRight = Math.min(viewport.width, right + safePadding);
  const cropBottom = Math.min(viewport.height, bottom + safePadding);
  const x = Math.max(0, Math.floor(cropLeft * scaleX));
  const y = Math.max(0, Math.floor(cropTop * scaleY));
  const pixelRight = Math.min(image.width, Math.ceil(cropRight * scaleX));
  const pixelBottom = Math.min(image.height, Math.ceil(cropBottom * scaleY));
  return { x, y, width: Math.max(1, pixelRight - x), height: Math.max(1, pixelBottom - y), partial, visibleBounds };
}

export async function cropScreenshot(dataUrl: string, crop: PixelCrop): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const pixelBudget = 1_500_000;
  const maxSide = 1800;
  let scale = Math.min(1, Math.sqrt(pixelBudget / (crop.width * crop.height)), maxSide / crop.width, maxSide / crop.height);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable; component screenshot could not be cropped.');
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    const output = canvas.toDataURL('image/png');
    if (output.length <= 4_000_000) return { dataUrl: output, width, height };
    scale *= 0.7;
  }
  throw new Error('The cropped image is too large to save. Reduce the capture area or use Element only.');
}

export async function createVisualDiff(beforeDataUrl: string, afterDataUrl: string): Promise<{ dataUrl: string; width: number; height: number; changedRatio: number }> {
  const [before, after] = await Promise.all([decodeImage(beforeDataUrl), decodeImage(afterDataUrl)]);
  const width = Math.max(before.naturalWidth, after.naturalWidth);
  const height = Math.max(before.naturalHeight, after.naturalHeight);
  if (width * height > 1_500_000) throw new Error('Visual diff is too large to render safely.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const leftCanvas = document.createElement('canvas'); leftCanvas.width = width; leftCanvas.height = height;
  const afterCanvas = document.createElement('canvas'); afterCanvas.width = width; afterCanvas.height = height;
  const leftContext = leftCanvas.getContext('2d', { willReadFrequently: true }); const rightContext = afterCanvas.getContext('2d', { willReadFrequently: true });
  const diffContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!leftContext || !rightContext || !diffContext) throw new Error('Canvas is unavailable; visual diff could not be computed.');
  rightContext.drawImage(after, 0, 0); leftContext.drawImage(before, 0, 0);
  const left = leftContext.getImageData(0, 0, width, height); const right = rightContext.getImageData(0, 0, width, height);
  const output = diffContext.createImageData(width, height); let changed = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    const delta = Math.max(Math.abs(left.data[index]! - right.data[index]!), Math.abs(left.data[index + 1]! - right.data[index + 1]!), Math.abs(left.data[index + 2]! - right.data[index + 2]!));
    if (delta > 30) { output.data[index] = 255; output.data[index + 1] = 40; output.data[index + 2] = 150; output.data[index + 3] = 255; changed += 1; }
  }
  diffContext.putImageData(output, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width, height, changedRatio: changed / (width * height) };
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = dataUrl;
  return image.decode().then(() => image);
}

export function makeComponentSnapshot(input: Omit<UIComponentSnapshot, 'screenshot'> & {
  screenshot: Omit<UIComponentSnapshot['screenshot'], 'dataUrl'>;
}, image: { dataUrl: string; width: number; height: number }): UIComponentSnapshot {
  return { ...input, screenshot: { ...input.screenshot, ...image, mimeType: 'image/png' } };
}
