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
 * @param {number} [options.currentSpread=options.fromSpread] Spread the user is settled on at high-res. When the turn starts from here, the front face stays high-res.
 * @param {number} [options.highResDestinationMaxZoom=2] Max zoom where destination textures use high-res.
 * @returns {Object} Snapshot texture source flags.
 */
export function getPageTurnTexturePolicy({
  fromSpread,
  toSpread,
  targetSpread = toSpread,
  contentZoom = 1,
  currentSpread = fromSpread,
  highResDestinationMaxZoom = DEFAULT_HIGH_RES_DESTINATION_MAX_ZOOM,
} = {}) {
  const zoom = normalizeZoom(contentZoom);
  const usePreviewDestinationTextures = zoom > highResDestinationMaxZoom;

  // The turning leaf's front face is normally motion-blurred/curled, so it can
  // ride on cheap preview textures. But at the very start of a turn the leaf is
  // still flat and fully visible: dropping to preview there would make the
  // settled high-res spread the user was looking at visibly "pop" to low-res.
  // A turn is a "start" when it turns from the spread the user is settled on
  // (`currentSpread`); later steps of a multi-spread jump turn from spreads
  // that were never settled, so they whip past and stay cheap.
  const turnStart = fromSpread === currentSpread;
  const usePreviewFrontFaceTextures = turnStart ? usePreviewDestinationTextures : true;

  return {
    fromSpread,
    toSpread,
    targetSpread,
    contentZoom: zoom,
    turnStart,
    usePreviewDestinationTextures,
    usePreviewFrontFaceTextures,
    fromSnapshot: {
      preferPreviewSources: usePreviewFrontFaceTextures,
      preferPreviewBackFaceSources: usePreviewDestinationTextures,
    },
    toSnapshot: {
      preferPreviewSources: usePreviewDestinationTextures,
      preferPreviewBackFaceSources: usePreviewDestinationTextures,
    },
  };
}
