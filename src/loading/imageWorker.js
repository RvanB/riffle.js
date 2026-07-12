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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logImageDecode(message, details) {
  self.postMessage({ debug: [`[Riffle] ${message}`, details] });
}

async function resizeBitmap(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.transferToImageBitmap();
}

async function loadImageFile({ file, targetWidth, targetHeight, resizeQuality = "high", purpose = "image" }) {
  const target = {
    width: Math.max(1, Math.round(Number(targetWidth) || 1)),
    height: Math.max(1, Math.round(Number(targetHeight) || 1)),
  };
  let bitmap;
  let usedResizeDecode = true;
  const startedAt = nowMs();
  logImageDecode("Worker requesting resized image decode", {
    name: file?.name || "",
    purpose,
    target,
    sizeBytes: file?.size || 0,
  });
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality,
    });
  } catch (_error) {
    usedResizeDecode = false;
    logImageDecode("Worker image resize decode failed; falling back to full-res decode before downscale", {
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
    logImageDecode("Worker resized image decode returned target size", {
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
    logImageDecode("Worker image decode returned smaller/equal source; no downscale needed", {
      name: file?.name || "",
      purpose,
      target,
      decoded,
      elapsedMs,
      usedResizeDecode,
    });
    return bitmap;
  }

  logImageDecode("Worker image decode returned larger bitmap; downscaling after decode", {
    name: file?.name || "",
    purpose,
    decoded,
    target,
    elapsedMs,
    usedResizeDecode,
  });
  const resized = await resizeBitmap(bitmap, target.width, target.height);
  bitmap.close();
  logImageDecode("Worker finished image downscale after decode", {
    name: file?.name || "",
    purpose,
    target,
    totalElapsedMs: Math.round(nowMs() - startedAt),
  });
  return resized;
}

async function loadImagePreview({ file, maxEdge }) {
  const startedAt = nowMs();
  logImageDecode("Worker requesting full image decode for preview dimension fallback", {
    name: file?.name || "",
    maxEdge,
    sizeBytes: file?.size || 0,
  });
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const { width, height } = computeTargetSize(originalWidth, originalHeight, maxEdge);
  if (width === originalWidth && height === originalHeight) {
    logImageDecode("Worker preview decode used original size", {
      name: file?.name || "",
      decoded: { width: originalWidth, height: originalHeight },
      elapsedMs: Math.round(nowMs() - startedAt),
    });
    return {
      canvas: bitmap,
      width: originalWidth,
      height: originalHeight,
    };
  }
  logImageDecode("Worker image preview decoded full-res; downscaling preview after decode", {
    name: file?.name || "",
    decoded: { width: originalWidth, height: originalHeight },
    target: { width, height },
    elapsedMs: Math.round(nowMs() - startedAt),
  });
  const canvas = await resizeBitmap(bitmap, width, height);
  bitmap.close();
  logImageDecode("Worker finished preview downscale after full decode", {
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

const handlers = {
  loadImageFile,
  loadImagePreview,
};

self.onmessage = async event => {
  const { id, type, payload } = event.data || {};
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Unknown image worker request: ${type}`);
    const result = await handler(payload || {});
    const transfer = [];
    if (result instanceof ImageBitmap) transfer.push(result);
    else if (result?.canvas instanceof ImageBitmap) transfer.push(result.canvas);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
