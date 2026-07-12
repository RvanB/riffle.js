const DEFAULT_HIGH_RES_DESTINATION_MAX_ZOOM = 2;

/**
 * Converts caller-provided zoom values into a positive zoom multiplier.
 *
 * Invalid, missing, and non-positive values fall back to 1 so texture-policy
 * decisions stay conservative and predictable.
 *
 * @param {number} value Candidate zoom value.
 * @returns {number} Positive zoom value.
 */
function normalizeZoom(value) {
  const zoom = Number(value);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * Chooses which page-turn surfaces can use page-strip preview textures.
 *
 * The turning leaf's front face is motion-blurred/curled and can stay cheap.
 * The destination spread is more visible: one page is the underlay `toScene`,
 * and the other may be the back face of the turning leaf from `fromScene`.
 *
 * @param {Object} options Turn context.
 * @param {number} options.fromSpread Spread the turn starts from.
 * @param {number} options.toSpread Spread being revealed by this animation step.
 * @param {number} [options.targetSpread=options.toSpread] User-requested target spread.
 * @param {number} [options.contentZoom=1] Current visual zoom.
 * @param {number} [options.highResDestinationMaxZoom=2] Max zoom where destination textures use high-res.
 * @returns {Object} Snapshot texture source flags.
 */
export function getPageTurnTexturePolicy({
  fromSpread,
  toSpread,
  targetSpread = toSpread,
  contentZoom = 1,
  highResDestinationMaxZoom = DEFAULT_HIGH_RES_DESTINATION_MAX_ZOOM,
} = {}) {
  const zoom = normalizeZoom(contentZoom);
  const usePreviewDestinationTextures = zoom > highResDestinationMaxZoom;

  return {
    fromSpread,
    toSpread,
    targetSpread,
    contentZoom: zoom,
    usePreviewDestinationTextures,
    fromSnapshot: {
      preferPreviewSources: true,
      preferPreviewBackFaceSources: usePreviewDestinationTextures,
    },
    toSnapshot: {
      preferPreviewSources: usePreviewDestinationTextures,
      preferPreviewBackFaceSources: usePreviewDestinationTextures,
    },
  };
}
