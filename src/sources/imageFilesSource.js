import { ImagePageSource } from "./ImagePageSource.js";

const IMAGE_EXTENSION_RE = /\.(avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;

/**
 * True when a file looks like an image (by MIME type or extension).
 *
 * @param {File} file File to test.
 * @returns {boolean} Whether the file is an image.
 */
export function isImageFile(file) {
  return (typeof file?.type === "string" && file.type.startsWith("image/"))
    || IMAGE_EXTENSION_RE.test(file?.name || "");
}

// Read intrinsic dimensions with the same decode path the renderer uses
// (`createImageBitmap` with default orientation), so each page's aspect ratio
// matches the bitmap that will actually be drawn.
async function readImageDimensions(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: Math.max(1, bitmap.width), height: Math.max(1, bitmap.height) };
    bitmap.close?.();
    return dims;
  } catch (_error) {
    return { width: 1, height: 1 };
  }
}

// A mutable page record. ImagePageSource reads `source.file` + `aspectRatio`
// and the lazy loader writes the bitmap/loading fields as pages scroll into
// view. The placement fields describe how a standalone image should sit on the
// page (full-bleed cover, centered, fit inside the spread).
function makeImagePage(file, { width, height }) {
  return {
    source: { type: "image", file },
    aspectRatio: width / height,
    srcCanvas: null,
    previewCanvas: null,
    thumbnailSourceCanvas: null,
    placedPreviewCanvas: null,
    displayCanvasOverride: null,
    loading: false,
    loadedImageMaxEdge: 0,
    requestedImageMaxEdge: 0,
    cover: true,
    spread: false,
    fitAxis: "inside",
    contentAlignX: null,
    contentAlignY: "center",
    crop: { top: 0, left: 0, right: 0, bottom: 0 },
    get displayCanvas() { return this.displayCanvasOverride || this.srcCanvas || this.previewCanvas || null; },
    get thumbnailCanvas() { return this.placedPreviewCanvas || this.thumbnailSourceCanvas || this.previewCanvas || this.srcCanvas || null; },
    getCropFor() { return { ...this.crop }; },
    setCropFor(_canvas, crop) { this.crop = { ...this.crop, ...crop }; },
  };
}

// A book-shaped object the lazy page loader writes into. Its pagination
// (one page per side, first page alone as a cover) mirrors the viewer's
// default single-column spread layout.
function makeImageBook(pages) {
  return {
    get pages() { return pages; },
    numSpreads() { return Math.max(1, Math.ceil((pages.length + 1) / 2)); },
    spreadPages(spreadIndex) {
      const leftIndex = spreadIndex * 2 - 1;
      const rightIndex = spreadIndex * 2;
      return [leftIndex >= 0 ? pages[leftIndex] ?? null : null, pages[rightIndex] ?? null];
    },
    spreadPageEntries(spreadIndex) {
      const leftIndex = spreadIndex * 2 - 1;
      const rightIndex = spreadIndex * 2;
      return {
        left: {
          page: leftIndex >= 0 ? pages[leftIndex] ?? null : null,
          pageIndex: leftIndex,
          showThroughPage: leftIndex - 1 >= 0 ? pages[leftIndex - 1] ?? null : null,
        },
        right: {
          page: pages[rightIndex] ?? null,
          pageIndex: rightIndex,
          showThroughPage: pages[rightIndex + 1] ?? null,
        },
      };
    },
  };
}

/**
 * Builds an {@link ImagePageSource} from a list of image files, one page per
 * image, ready to hand to a viewer via `setSource`.
 *
 * Non-image files are ignored. Resolves to `null` when the list contains no
 * images.
 *
 * @param {File[]|FileList} files Image files.
 * @returns {Promise<ImagePageSource|null>} The source, or `null` if no images.
 */
export async function createImageSourceFromFiles(files) {
  const imageFiles = [...files].filter(isImageFile);
  if (!imageFiles.length) return null;
  const dimensions = await Promise.all(imageFiles.map(readImageDimensions));
  const pages = imageFiles.map((file, index) => makeImagePage(file, dimensions[index]));
  return new ImagePageSource({
    getPageCount: () => pages.length,
    getPageMetadata: (index) => {
      const page = pages[index] ?? null;
      return page ? { aspectRatio: page.aspectRatio, passthrough: page } : null;
    },
    internalBook: makeImageBook(pages),
  });
}
