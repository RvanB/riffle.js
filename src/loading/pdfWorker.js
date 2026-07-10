const PDFJS_URL = "https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.mjs";
const PDF_WORKER_URL = "https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.worker.mjs";
const PDF_CMAP_URL = "https://unpkg.com/pdfjs-dist@5.6.205/cmaps/";
const PDF_STANDARD_FONT_DATA_URL = "https://unpkg.com/pdfjs-dist@5.6.205/standard_fonts/";
const PDF_WASM_URL = "https://unpkg.com/pdfjs-dist@5.6.205/wasm/";

// Hard cap on OffscreenCanvas dimensions used for pdf.js rendering. Higher
// values risk hitting GPU-dependent canvas size limits in Firefox/Safari
// (e.g. ~11k px per edge on typical Firefox systems, smaller on iOS) which
// would put the canvas into an error state and break the draw loop.
const MAX_PDF_RENDER_EDGE = 8192;

// pdf.js reaches for `globalThis.document.createElement("canvas")` in a few
// places that bypass its CanvasFactory. Inside a worker we install a minimal
// shim that hands back OffscreenCanvas-shaped objects for those code paths.
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(name) {
      if (name === "canvas") return new OffscreenCanvas(1, 1);
      throw new Error(`Unsupported element in pdf worker shim: ${name}`);
    },
    createElementNS(_ns, name) {
      return this.createElement(name);
    },
  };
}

// pdf.js's default DOMCanvasFactory uses `document.createElement`, which
// doesn't exist in a worker context. This worker-side factory creates
// OffscreenCanvas instances instead.
class OffscreenCanvasFactory {
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return lib;
    });
  }
  return pdfjsPromise;
}

const DOWNSCALE_WORKGROUP_SIZE = 8;
let webgpuDownscalerPromise = null;

// Lazy box-filter compute downscaler. Each destination pixel averages every
// source pixel it covers — produces visibly smoother thumbnails than canvas2D
// bilinear, especially for large reductions. Runs entirely in the worker.
function getWebgpuDownscaler() {
  if (webgpuDownscalerPromise) return webgpuDownscalerPromise;
  if (!self.navigator?.gpu) {
    webgpuDownscalerPromise = Promise.resolve(null);
    return webgpuDownscalerPromise;
  }
  webgpuDownscalerPromise = (async () => {
    try {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const shaderModule = device.createShaderModule({
        code: `
          struct Params {
            srcWidth: u32,
            srcHeight: u32,
            dstWidth: u32,
            dstHeight: u32,
          };

          @group(0) @binding(0) var sourceTex: texture_2d<f32>;
          @group(0) @binding(1) var destTex: texture_storage_2d<rgba8unorm, write>;
          @group(0) @binding(2) var<uniform> params: Params;

          fn ceilDiv(value: u32, divisor: u32) -> u32 {
            return (value + divisor - 1u) / divisor;
          }

          @compute @workgroup_size(${DOWNSCALE_WORKGROUP_SIZE}, ${DOWNSCALE_WORKGROUP_SIZE})
          fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
            if (gid.x >= params.dstWidth || gid.y >= params.dstHeight) {
              return;
            }

            let srcX0 = gid.x * params.srcWidth / params.dstWidth;
            let srcY0 = gid.y * params.srcHeight / params.dstHeight;
            let srcX1 = max(srcX0 + 1u, ceilDiv((gid.x + 1u) * params.srcWidth, params.dstWidth));
            let srcY1 = max(srcY0 + 1u, ceilDiv((gid.y + 1u) * params.srcHeight, params.dstHeight));

            var accum = vec4<f32>(0.0);
            var count = 0u;
            for (var sy = srcY0; sy < srcY1; sy = sy + 1u) {
              for (var sx = srcX0; sx < srcX1; sx = sx + 1u) {
                accum = accum + textureLoad(sourceTex, vec2<i32>(i32(sx), i32(sy)), 0);
                count = count + 1u;
              }
            }

            textureStore(destTex, vec2<i32>(i32(gid.x), i32(gid.y)), accum / f32(max(count, 1u)));
          }
        `,
      });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "main" },
      });
      device.lost?.then(() => {
        webgpuDownscalerPromise = null;
      });
      return { device, pipeline };
    } catch (error) {
      console.error("Worker WebGPU downscaler init failed:", error);
      return null;
    }
  })();
  return webgpuDownscalerPromise;
}

async function gpuDownscale(source, targetWidth, targetHeight) {
  const downscaler = await getWebgpuDownscaler();
  if (!downscaler) return null;
  const { device, pipeline } = downscaler;
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const paddedBytesPerRow = Math.ceil((targetWidth * 4) / 256) * 256;

  const sourceTexture = device.createTexture({
    size: [sourceWidth, sourceHeight, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const destTexture = device.createTexture({
    size: [targetWidth, targetHeight, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = device.createBuffer({
    size: paddedBytesPerRow * targetHeight,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source },
      { texture: sourceTexture },
      [sourceWidth, sourceHeight],
    );
    device.queue.writeBuffer(
      paramsBuffer,
      0,
      new Uint32Array([sourceWidth, sourceHeight, targetWidth, targetHeight]),
    );

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: destTexture.createView() },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(targetWidth / DOWNSCALE_WORKGROUP_SIZE),
      Math.ceil(targetHeight / DOWNSCALE_WORKGROUP_SIZE),
    );
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: destTexture },
      { buffer: readbackBuffer, bytesPerRow: paddedBytesPerRow, rowsPerImage: targetHeight },
      [targetWidth, targetHeight, 1],
    );
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const mapped = readbackBuffer.getMappedRange();
    const srcBytes = new Uint8Array(mapped);
    const destBytes = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (let row = 0; row < targetHeight; row += 1) {
      const srcOffset = row * paddedBytesPerRow;
      const destOffset = row * targetWidth * 4;
      destBytes.set(srcBytes.subarray(srcOffset, srcOffset + targetWidth * 4), destOffset);
    }
    readbackBuffer.unmap();

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(destBytes, targetWidth, targetHeight), 0, 0);
    return canvas.transferToImageBitmap();
  } catch (error) {
    console.error("Worker WebGPU downscale failed:", error);
    return null;
  } finally {
    sourceTexture.destroy();
    destTexture.destroy();
    paramsBuffer.destroy();
    readbackBuffer.destroy();
  }
}

async function downscaleToTarget(source, targetWidth, targetHeight) {
  const gpuResult = await gpuDownscale(source, targetWidth, targetHeight);
  if (gpuResult) return gpuResult;
  // Canvas2D fallback (no WebGPU available in this worker).
  const downscaled = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = downscaled.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return downscaled.transferToImageBitmap();
}

const docs = new Map();
const activeOps = new Map();
const cleanupPending = new Set();
const rasterInfoCache = new Map();
const textContentCache = new Map();
const linkAnnotationCache = new Map();
let nextDocId = 1;
const pageCache = new Map();
const MAX_CACHED_PAGES = 12;
const MAX_CACHED_PAGE_AGE_MS = 30_000;

function bumpOps(docId) {
  activeOps.set(docId, (activeOps.get(docId) || 0) + 1);
}

function dropOps(docId) {
  const remaining = Math.max(0, (activeOps.get(docId) || 1) - 1);
  if (remaining === 0) activeOps.delete(docId);
  else activeOps.set(docId, remaining);
  maybeCleanup(docId);
}

function maybeCleanup(docId) {
  if (!cleanupPending.has(docId)) return;
  if ((activeOps.get(docId) || 0) > 0) return;
  cleanupPending.delete(docId);
  rasterInfoCache.delete(docId);
  textContentCache.delete(docId);
  linkAnnotationCache.delete(docId);
  const cachedPages = pageCache.get(docId);
  if (cachedPages) {
    for (const entry of cachedPages.values()) entry.page.cleanup?.();
    pageCache.delete(docId);
  }
  docs.get(docId)?.cleanup?.();
}

async function getCachedPdfPage(docId, pageNum, doc) {
  let docCache = pageCache.get(docId);
  if (!docCache) {
    docCache = new Map();
    pageCache.set(docId, docCache);
  }
  let entry = docCache.get(pageNum);
  if (!entry) {
    entry = { page: await doc.getPage(pageNum), lastUsed: 0 };
    docCache.set(pageNum, entry);
  }
  entry.lastUsed = performance.now();
  return entry.page;
}

function trimPageCache(docId) {
  const docCache = pageCache.get(docId);
  if (!docCache) return;
  const now = performance.now();
  for (const [pageNum, entry] of docCache) {
    if (now - entry.lastUsed <= MAX_CACHED_PAGE_AGE_MS) continue;
    entry.page.cleanup?.();
    docCache.delete(pageNum);
  }
  while (docCache.size > MAX_CACHED_PAGES) {
    let oldestPageNum = null;
    let oldestTime = Infinity;
    for (const [pageNum, entry] of docCache) {
      if (entry.lastUsed >= oldestTime) continue;
      oldestTime = entry.lastUsed;
      oldestPageNum = pageNum;
    }
    if (oldestPageNum === null) break;
    docCache.get(oldestPageNum)?.page.cleanup?.();
    docCache.delete(oldestPageNum);
  }
  if (!docCache.size) pageCache.delete(docId);
}

async function withPdfPage(docId, pageNum, work, { cachePage = false } = {}) {
  const doc = docs.get(docId);
  if (!doc) throw new Error(`Unknown pdf docId: ${docId}`);
  bumpOps(docId);
  const page = cachePage
    ? await getCachedPdfPage(docId, pageNum, doc)
    : await doc.getPage(pageNum);
  try {
    return await work(page);
  } finally {
    if (cachePage) trimPageCache(docId);
    else page.cleanup?.();
    dropOps(docId);
  }
}

function multiplyTransform(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function getTransformAxisLengths(transform) {
  return {
    width: Math.hypot(transform[0], transform[1]),
    height: Math.hypot(transform[2], transform[3]),
  };
}

function getPlacedImageSize(transform, userUnit = 1) {
  const { width, height } = getTransformAxisLengths(transform);
  return { width: width * userUnit, height: height * userUnit };
}

function getImageDpiFromTransform(imageWidth, imageHeight, transform, userUnit = 1) {
  const { width, height } = getTransformAxisLengths(transform);
  if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return 0;
  return Math.max(
    (imageWidth * 72) / (width * userUnit),
    (imageHeight * 72) / (height * userUnit)
  );
}

function getResolvedPdfObject(page, objId) {
  const pool = objId.startsWith("g_") ? page.commonObjs : page.objs;
  if (pool.has(objId)) return Promise.resolve(pool.get(objId));
  return new Promise(resolve => pool.get(objId, resolve));
}

async function computeRasterInfo(docId, pageNum) {
  const lib = await getPdfjs();
  return withPdfPage(docId, pageNum, async page => {
    const operatorList = await page.getOperatorList();
    const fnArray = operatorList.fnArray || [];
    const argsArray = operatorList.argsArray || [];
    const stack = [];
    let transform = [1, 0, 0, 1, 0, 0];
    let bestDpi = 72;
    let hasRasterImage = false;
    let imageCount = 0;
    let primaryImage = null;

    const registerImage = (imageLike, imageTransform = transform) => {
      const imageWidth = imageLike?.width || 0;
      const imageHeight = imageLike?.height || 0;
      if (imageWidth <= 0 || imageHeight <= 0) return;
      imageCount += 1;
      const placedSize = getPlacedImageSize(imageTransform, page.userUnit || 1);
      const dpi = getImageDpiFromTransform(imageWidth, imageHeight, imageTransform, page.userUnit || 1);
      if (dpi > 0) {
        hasRasterImage = true;
        if (dpi > bestDpi) bestDpi = dpi;
      }
      const placedArea = placedSize.width * placedSize.height;
      if (!primaryImage || placedArea > primaryImage.placedArea) {
        primaryImage = {
          width: imageWidth,
          height: imageHeight,
          dpi,
          placedWidth: placedSize.width,
          placedHeight: placedSize.height,
          placedArea,
        };
      }
    };

    for (let i = 0; i < fnArray.length; i += 1) {
      const fnId = fnArray[i];
      const args = argsArray[i] || [];

      if (fnId === lib.OPS.save) {
        stack.push(transform.slice());
        continue;
      }
      if (fnId === lib.OPS.restore) {
        transform = stack.pop() || [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (fnId === lib.OPS.transform) {
        transform = multiplyTransform(transform, args);
        continue;
      }
      if (fnId === lib.OPS.paintInlineImageXObject) {
        registerImage(args[0]);
        continue;
      }
      if (fnId === lib.OPS.paintImageXObject) {
        registerImage(await getResolvedPdfObject(page, args[0]));
        continue;
      }
      if (fnId === lib.OPS.paintImageXObjectRepeat) {
        const image = await getResolvedPdfObject(page, args[0]);
        const scaleX = args[1];
        const scaleY = args[2];
        const positions = args[3] || [];
        for (let j = 0; j < positions.length; j += 2) {
          registerImage(image, multiplyTransform(transform, [scaleX, 0, 0, scaleY, positions[j], positions[j + 1]]));
        }
        continue;
      }
      if (fnId === lib.OPS.paintInlineImageXObjectGroup) {
        const image = args[0];
        const map = args[1] || [];
        for (const entry of map) {
          registerImage(image, multiplyTransform(transform, entry.transform));
        }
      }
    }

    return {
      dpi: bestDpi,
      renderScale: Math.max(1 / 72, bestDpi / 72),
      hasRasterImage,
      imageCount,
      imageWidth: primaryImage?.width || 0,
      imageHeight: primaryImage?.height || 0,
      placedWidth: primaryImage?.placedWidth || 0,
      placedHeight: primaryImage?.placedHeight || 0,
      primaryImageDpi: primaryImage?.dpi || 0,
    };
  }, { cachePage: true });
}

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

function makeImageSourceFromPdfImage(imageLike) {
  if (!imageLike?.width || !imageLike?.height) return null;
  if (
    typeof ImageBitmap !== "undefined" && imageLike instanceof ImageBitmap
    || typeof OffscreenCanvas !== "undefined" && imageLike instanceof OffscreenCanvas
  ) {
    return { source: imageLike, close: null };
  }

  const { width, height, data } = imageLike;
  if (!data) return null;
  const pixelCount = width * height;
  let rgba = null;

  if (data.length === pixelCount * 4) {
    rgba = data instanceof Uint8ClampedArray
      ? data
      : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  } else if (data.length === pixelCount * 3) {
    rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let src = 0, dest = 0; src < data.length; src += 3, dest += 4) {
      rgba[dest] = data[src];
      rgba[dest + 1] = data[src + 1];
      rgba[dest + 2] = data[src + 2];
      rgba[dest + 3] = 255;
    }
  } else if (data.length === pixelCount) {
    rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let src = 0, dest = 0; src < data.length; src += 1, dest += 4) {
      const value = data[src];
      rgba[dest] = value;
      rgba[dest + 1] = value;
      rgba[dest + 2] = value;
      rgba[dest + 3] = 255;
    }
  }

  if (!rgba) return null;
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  return { source: canvas, close: null };
}

async function tryRenderSingleRasterPage(page, viewport, renderWidth, renderHeight) {
  const lib = await getPdfjs();
  const operatorList = await page.getOperatorList();
  const fnArray = operatorList.fnArray || [];
  const argsArray = operatorList.argsArray || [];
  const imageOps = new Set([
    lib.OPS.paintImageXObject,
    lib.OPS.paintInlineImageXObject,
  ]);
  const disallowedPaintOps = new Set([
    lib.OPS.constructPath,
    lib.OPS.stroke,
    lib.OPS.closeStroke,
    lib.OPS.fill,
    lib.OPS.eoFill,
    lib.OPS.fillStroke,
    lib.OPS.eoFillStroke,
    lib.OPS.closeFillStroke,
    lib.OPS.closeEOFillStroke,
    lib.OPS.shadingFill,
    lib.OPS.clip,
    lib.OPS.eoClip,
    lib.OPS.paintFormXObjectBegin,
    lib.OPS.paintFormXObjectEnd,
    lib.OPS.paintJpegXObject,
    lib.OPS.paintImageMaskXObject,
    lib.OPS.paintImageMaskXObjectRepeat,
    lib.OPS.paintSolidColorImageMask,
    lib.OPS.paintImageXObjectRepeat,
    lib.OPS.paintInlineImageXObjectGroup,
    lib.OPS.showText,
    lib.OPS.showSpacedText,
    lib.OPS.nextLineShowText,
    lib.OPS.nextLineSetSpacingShowText,
  ].filter(value => typeof value === "number"));

  const stack = [];
  let transform = [1, 0, 0, 1, 0, 0];
  let imageEntry = null;
  const pageViewport = page.getViewport({ scale: 1 });
  const pageArea = pageViewport.width * pageViewport.height;

  for (let i = 0; i < fnArray.length; i += 1) {
    const fnId = fnArray[i];
    const args = argsArray[i] || [];
    if (fnId === lib.OPS.save) {
      stack.push(transform.slice());
      continue;
    }
    if (fnId === lib.OPS.restore) {
      transform = stack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fnId === lib.OPS.transform) {
      transform = multiplyTransform(transform, args);
      continue;
    }
    if (imageOps.has(fnId)) {
      if (imageEntry) return null;
      const imageLike = fnId === lib.OPS.paintImageXObject
        ? await getResolvedPdfObject(page, args[0])
        : args[0];
      const placedSize = getPlacedImageSize(transform, page.userUnit || 1);
      const placedArea = placedSize.width * placedSize.height;
      if (pageArea <= 0 || placedArea / pageArea < 0.95) return null;
      imageEntry = { imageLike };
      continue;
    }
    if (disallowedPaintOps.has(fnId)) return null;
  }

  if (!imageEntry) return null;
  const imageSource = makeImageSourceFromPdfImage(imageEntry.imageLike);
  if (!imageSource) return null;

  const canvas = new OffscreenCanvas(renderWidth, renderHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, renderWidth, renderHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imageSource.source, 0, 0, renderWidth, renderHeight);
  imageSource.close?.();
  return canvas.transferToImageBitmap();
}

function shouldTrySingleRasterRender(page, rasterInfo) {
  if (!rasterInfo?.hasRasterImage || rasterInfo.imageCount !== 1) return false;
  const pageViewport = page.getViewport({ scale: 1 });
  const pageArea = pageViewport.width * pageViewport.height;
  const placedArea = (rasterInfo.placedWidth || 0) * (rasterInfo.placedHeight || 0);
  return pageArea > 0 && placedArea / pageArea >= 0.95;
}

async function getCachedRasterInfo(docId, pageNum) {
  const docCache = rasterInfoCache.get(docId);
  const cached = docCache?.get(pageNum);
  return cached ? cached.catch?.(() => null) ?? cached : null;
}

const handlers = {
  async loadDocument({ buffer }) {
    const lib = await getPdfjs();
    const doc = await lib.getDocument({
      data: buffer,
      CanvasFactory: OffscreenCanvasFactory,
      cMapUrl: PDF_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      wasmUrl: PDF_WASM_URL,
      disableFontFace: true,
    }).promise;
    const docId = nextDocId++;
    docs.set(docId, doc);
    return { docId, numPages: doc.numPages };
  },

  async getAspectRatio({ docId, pageNum }) {
    return withPdfPage(docId, pageNum, page => {
      const viewport = page.getViewport({ scale: 1 });
      return viewport.width / viewport.height;
    });
  },

  async getRasterInfo({ docId, pageNum }) {
    let docCache = rasterInfoCache.get(docId);
    if (!docCache) {
      docCache = new Map();
      rasterInfoCache.set(docId, docCache);
    }
    if (!docCache.has(pageNum)) {
      docCache.set(pageNum, computeRasterInfo(docId, pageNum));
    }
    return docCache.get(pageNum);
  },

  async getTextContent({ docId, pageNum }) {
    let docCache = textContentCache.get(docId);
    if (!docCache) {
      docCache = new Map();
      textContentCache.set(docId, docCache);
    }
    if (!docCache.has(pageNum)) {
      docCache.set(pageNum, withPdfPage(docId, pageNum, async page => {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
          disableCombineTextItems: true,
        });
        return {
          width: viewport.width,
          height: viewport.height,
          transform: viewport.transform,
          styles: Object.fromEntries(
            Object.entries(textContent.styles || {}).map(([name, style]) => [
              name,
              {
                fontFamily: style.fontFamily || "",
                ascent: Number(style.ascent) || 0,
                descent: Number(style.descent) || 0,
                vertical: !!style.vertical,
              },
            ])
          ),
          items: (textContent.items || [])
            .filter(item => item?.str)
            .map(item => ({
              str: item.str,
              dir: item.dir || "ltr",
              fontName: item.fontName || "",
              width: Number(item.width) || 0,
              height: Number(item.height) || 0,
              transform: item.transform,
            })),
        };
      }));
    }
    return docCache.get(pageNum);
  },

  async getLinkAnnotations({ docId, pageNum }) {
    let docCache = linkAnnotationCache.get(docId);
    if (!docCache) {
      docCache = new Map();
      linkAnnotationCache.set(docId, docCache);
    }
    if (!docCache.has(pageNum)) {
      docCache.set(pageNum, withPdfPage(docId, pageNum, async page => {
        const doc = docs.get(docId);
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations({ intent: "display" });
        const links = [];
        for (const annotation of annotations || []) {
          if (annotation?.subtype !== "Link" || !annotation.rect) continue;
          let destPageNum = 0;
          if (annotation.dest && doc?.getDestination && doc?.getPageIndex) {
            try {
              const dest = typeof annotation.dest === "string"
                ? await doc.getDestination(annotation.dest)
                : annotation.dest;
              const ref = Array.isArray(dest) ? dest[0] : null;
              if (ref) destPageNum = (await doc.getPageIndex(ref)) + 1;
            } catch (_error) {
              destPageNum = 0;
            }
          }
          links.push({
            rect: annotation.rect,
            url: annotation.url || annotation.unsafeUrl || "",
            destPageNum,
            title: annotation.title || "",
          });
        }
        return {
          width: viewport.width,
          height: viewport.height,
          transform: viewport.transform,
          links,
        };
      }));
    }
    return docCache.get(pageNum);
  },

  async renderPage({ docId, pageNum, scale, downscaleTo = 0 }) {
    return withPdfPage(docId, pageNum, async page => {
      // Cap the requested scale so the resulting OffscreenCanvas never
      // exceeds MAX_PDF_RENDER_EDGE per side. Firefox in particular puts
      // an OffscreenCanvas into a permanent error state when constructed
      // above its (GPU-dependent) max size, which then causes pdf.js's
      // draw loop to fail with "Canvas is already in error state".
      const rawViewport = page.getViewport({ scale });
      const rawMaxEdge = Math.max(rawViewport.width, rawViewport.height);
      const effectiveScale = rawMaxEdge > MAX_PDF_RENDER_EDGE
        ? scale * (MAX_PDF_RENDER_EDGE / rawMaxEdge)
        : scale;
      const viewport = effectiveScale === scale
        ? rawViewport
        : page.getViewport({ scale: effectiveScale });
      const renderWidth = Math.max(1, Math.min(MAX_PDF_RENDER_EDGE, Math.round(viewport.width)));
      const renderHeight = Math.max(1, Math.min(MAX_PDF_RENDER_EDGE, Math.round(viewport.height)));
      const rasterInfo = await getCachedRasterInfo(docId, pageNum);
      if (shouldTrySingleRasterRender(page, rasterInfo)) {
        const directRasterBitmap = await tryRenderSingleRasterPage(page, viewport, renderWidth, renderHeight);
        if (directRasterBitmap) return directRasterBitmap;
      }
      const renderCanvas = new OffscreenCanvas(renderWidth, renderHeight);
      const renderCtx = renderCanvas.getContext("2d");
      await page.render({ canvasContext: renderCtx, viewport }).promise;

      if (downscaleTo > 0) {
        const { width, height } = computeTargetSize(renderWidth, renderHeight, downscaleTo);
        if (width !== renderWidth || height !== renderHeight) {
          return downscaleToTarget(renderCanvas, width, height);
        }
      }

      return renderCanvas.transferToImageBitmap();
    }, { cachePage: true });
  },

  releaseDocument({ docId }) {
    if (!docs.has(docId)) return null;
    cleanupPending.add(docId);
    maybeCleanup(docId);
    return null;
  },

  requestCleanup({ docId }) {
    if (!docs.has(docId)) return null;
    cleanupPending.add(docId);
    maybeCleanup(docId);
    return null;
  },

  async decodeImageFile({ blob, downscaleTo = 0 }) {
    const bitmap = await createImageBitmap(blob);
    if (downscaleTo > 0) {
      const { width, height } = computeTargetSize(bitmap.width, bitmap.height, downscaleTo);
      if (width !== bitmap.width || height !== bitmap.height) {
        const originalWidth = bitmap.width;
        const originalHeight = bitmap.height;
        const downscaledBitmap = await downscaleToTarget(bitmap, width, height);
        bitmap.close();
        return {
          bitmap: downscaledBitmap,
          width: originalWidth,
          height: originalHeight,
        };
      }
    }
    return { bitmap, width: bitmap.width, height: bitmap.height };
  },
};

self.addEventListener("message", async event => {
  const { id, type, payload } = event.data;
  const handler = handlers[type];
  if (!handler) {
    self.postMessage({ id, ok: false, error: `Unknown message type: ${type}` });
    return;
  }

  try {
    const result = await handler(payload || {});
    const transfer = [];
    if (result instanceof ImageBitmap) transfer.push(result);
    else if (result && typeof result === "object" && result.bitmap instanceof ImageBitmap) transfer.push(result.bitmap);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
