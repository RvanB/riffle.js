import { createWorkerClient } from "./workerClient.js";

function computeTargetSize(sourceWidth, sourceHeight, maxEdge) {
  const safeMaxEdge = Math.max(1, Math.round(maxEdge || 1));
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  if (sourceMaxEdge <= safeMaxEdge) {
    return {
      width: Math.max(1, Math.round(sourceWidth)),
      height: Math.max(1, Math.round(sourceHeight)),
    };
  }
  const scale = safeMaxEdge / sourceMaxEdge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function resizeBitmap(bitmap, width, height) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof canvas.transferToImageBitmap === "function") {
    return canvas.transferToImageBitmap();
  }
  return createImageBitmap(canvas);
}

function getRequestedSize(options = {}) {
  const width = Math.max(0, Math.round(Number(options.targetWidth) || 0));
  const height = Math.max(0, Math.round(Number(options.targetHeight) || 0));
  return width > 0 && height > 0 ? { width, height } : null;
}

const imageWorkerCall = createWorkerClient("./imageWorker.js", "Image", { maxInFlight: 1 });

async function loadImageFileOnMainThread(file, options = {}) {
  const target = getRequestedSize(options);
  if (!target) return createImageBitmap(file);

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: options.resizeQuality || "high",
    });
  } catch (_error) {
    bitmap = await createImageBitmap(file);
  }

  if (bitmap.width === target.width && bitmap.height === target.height) {
    return bitmap;
  }
  if (bitmap.width <= target.width && bitmap.height <= target.height) {
    return bitmap;
  }

  const resized = await resizeBitmap(bitmap, target.width, target.height);
  bitmap.close();
  return resized;
}

async function loadImagePreviewOnMainThread(file, maxEdge) {
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const { width, height } = computeTargetSize(originalWidth, originalHeight, maxEdge);
  if (width === originalWidth && height === originalHeight) {
    return { canvas: bitmap, width: originalWidth, height: originalHeight };
  }
  const canvas = await resizeBitmap(bitmap, width, height);
  bitmap.close();
  return {
    canvas,
    width: originalWidth,
    height: originalHeight,
  };
}

/**
 * Loads an image file as an ImageBitmap.
 *
 * @param {Blob} file Image file or blob.
 * @param {Object} [options={}] Image loading options.
 * @param {number} [options.targetWidth] Requested decoded bitmap width.
 * @param {number} [options.targetHeight] Requested decoded bitmap height.
 * @returns {Promise<ImageBitmap>} Loaded image bitmap.
 */
export async function loadImageFile(file, options = {}) {
  const target = getRequestedSize(options);
  if (!target) return loadImageFileOnMainThread(file, options);
  try {
    return await imageWorkerCall("loadImageFile", {
      file,
      targetWidth: target.width,
      targetHeight: target.height,
      resizeQuality: options.resizeQuality || "high",
    }, { priority: options.priority ?? "normal" });
  } catch (error) {
    return loadImageFileOnMainThread(file, options);
  }
}

/**
 * Loads a downscaled image preview.
 *
 * @param {Blob} file Image file or blob.
 * @param {number} maxEdge Maximum preview edge in pixels.
 * @param {Object} [options={}] Loading options.
 * @param {string|boolean} [options.priority="normal"] Worker scheduling priority.
 * @returns {Promise<{canvas: ImageBitmap, width: number, height: number}>} Preview bitmap plus original dimensions.
 */
export async function loadImagePreview(file, maxEdge, options = {}) {
  try {
    return await imageWorkerCall("loadImagePreview", { file, maxEdge }, { priority: options.priority ?? "normal" });
  } catch (error) {
    return loadImagePreviewOnMainThread(file, maxEdge);
  }
}
