/** Desktop page used to letterbox webpage previews. */

export const PREVIEW_PAGE_WIDTH = 1440
export const PREVIEW_PAGE_HEIGHT = 900

/**
 * Scale that fits a desktop page into a preview box without cropping or stretching.
 * @param width - visible preview width in CSS pixels.
 * @param height - visible preview height in CSS pixels.
 * @param pageWidth - layout width of the guest page.
 * @param pageHeight - layout height of the guest page.
 * @returns a scale factor of at least 0.1.
 */
export function fitPreviewScale(
  width: number,
  height: number,
  pageWidth = PREVIEW_PAGE_WIDTH,
  pageHeight = PREVIEW_PAGE_HEIGHT,
): number {
  if (width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0) return 0.1
  return Math.max(0.1, Math.min(width / pageWidth, height / pageHeight))
}
