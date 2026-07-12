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

async function resizeBitmap(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.transferToImageBitmap();
}

async function loadImageFile({ file, targetWidth, targetHeight, resizeQuality = "high" }) {
  const target = {
    width: Math.max(1, Math.round(Number(targetWidth) || 1)),
    height: Math.max(1, Math.round(Number(targetHeight) || 1)),
  };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality,
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

async function loadImagePreview({ file, maxEdge }) {
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const { width, height } = computeTargetSize(originalWidth, originalHeight, maxEdge);
  if (width === originalWidth && height === originalHeight) {
    return {
      canvas: bitmap,
      width: originalWidth,
      height: originalHeight,
    };
  }
  const canvas = await resizeBitmap(bitmap, width, height);
  bitmap.close();
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
