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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logImageDecode(message, details) {
  console.log(`[Riffle] ${message}`, details);
}

const imageWorkerCall = createWorkerClient("./imageWorker.js", "Image", { maxInFlight: 1 });

async function loadImageFileOnMainThread(file, options = {}) {
  const target = getRequestedSize(options);
  if (!target) return createImageBitmap(file);

  let bitmap;
  let usedResizeDecode = true;
  const startedAt = nowMs();
  const purpose = options.purpose || "image";
  logImageDecode("Main thread requesting resized image decode", {
    name: file?.name || "",
    purpose,
    target,
    sizeBytes: file?.size || 0,
  });
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: options.resizeQuality || "high",
    });
  } catch (_error) {
    usedResizeDecode = false;
    logImageDecode("Main thread image resize decode failed; falling back to full-res decode before downscale", {
      name: file?.name || "",
      purpose,
      target,
      elapsedMs: Math.round(nowMs() - startedAt),
    });
    bitmap = await createImageBitmap(file);
  }

  const decoded = { width: bitmap.width, height: bitmap.height };
  const elapsedMs = Math.round(nowMs() - startedAt);
  if (bitmap.width === target.width && bitmap.height === target.height) {
    logImageDecode("Main thread resized image decode returned target size", {
      name: file?.name || "",
      purpose,
      target,
      decoded,
      elapsedMs,
      usedResizeDecode,
    });
    return bitmap;
  }
  if (bitmap.width <= target.width && bitmap.height <= target.height) {
    logImageDecode("Main thread image decode returned smaller/equal source; no downscale needed", {
      name: file?.name || "",
      purpose,
      target,
      decoded,
      elapsedMs,
      usedResizeDecode,
    });
    return bitmap;
  }

  logImageDecode("Main thread image decode returned larger bitmap; downscaling after decode", {
    name: file?.name || "",
    purpose,
    decoded,
    target,
    elapsedMs,
    usedResizeDecode,
  });
  const resized = await resizeBitmap(bitmap, target.width, target.height);
  bitmap.close();
  logImageDecode("Main thread finished image downscale after decode", {
    name: file?.name || "",
    purpose,
    target,
    totalElapsedMs: Math.round(nowMs() - startedAt),
  });
  return resized;
}

async function loadImagePreviewOnMainThread(file, maxEdge) {
  const startedAt = nowMs();
  logImageDecode("Main thread requesting full image decode for preview dimension fallback", {
    name: file?.name || "",
    maxEdge,
    sizeBytes: file?.size || 0,
  });
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const { width, height } = computeTargetSize(originalWidth, originalHeight, maxEdge);
  if (width === originalWidth && height === originalHeight) {
    logImageDecode("Main thread preview decode used original size", {
      name: file?.name || "",
      decoded: { width: originalWidth, height: originalHeight },
      elapsedMs: Math.round(nowMs() - startedAt),
    });
    return { canvas: bitmap, width: originalWidth, height: originalHeight };
  }
  logImageDecode("Main thread image preview decoded full-res; downscaling preview after decode", {
    name: file?.name || "",
    decoded: { width: originalWidth, height: originalHeight },
    target: { width, height },
    elapsedMs: Math.round(nowMs() - startedAt),
  });
  const canvas = await resizeBitmap(bitmap, width, height);
  bitmap.close();
  logImageDecode("Main thread finished preview downscale after full decode", {
    name: file?.name || "",
    target: { width, height },
    totalElapsedMs: Math.round(nowMs() - startedAt),
  });
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
      purpose: options.purpose || "image",
      targetWidth: target.width,
      targetHeight: target.height,
      resizeQuality: options.resizeQuality || "high",
    }, { priority: options.priority ?? "normal" });
  } catch (error) {
    logImageDecode("Image worker decode failed; falling back to main thread", {
      name: file?.name || "",
      purpose: options.purpose || "image",
      target,
      error: error?.message || String(error),
    });
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
    logImageDecode("Image worker preview decode failed; falling back to main thread", {
      name: file?.name || "",
      maxEdge,
      error: error?.message || String(error),
    });
    return loadImagePreviewOnMainThread(file, maxEdge);
  }
}
