/**
 * Shared scroll sizing for the report's long lists.
 *
 * Each long list gets its own bounded, independently scrollable area so the page stays a
 * sensible length, while headings and totals stay OUTSIDE the scrolling region and never
 * scroll out of view. A list only becomes scrollable once it actually overflows, so short
 * lists never render an empty scrollbox.
 */

/** Top-level lists: ~288px on mobile, ~384px from md up. */
export const REPORT_LIST_SCROLL = "max-h-72 overflow-y-auto overscroll-contain pr-1 md:max-h-96";

/** Lists nested inside a card, e.g. a project's payments: ~224px, ~288px from md up. */
export const REPORT_NESTED_LIST_SCROLL =
	"max-h-56 overflow-y-auto overscroll-contain pr-1 md:max-h-72";

/** Returns the scroll classes only once `count` exceeds `threshold`. */
export function reportListScrollClass(
	count: number,
	threshold: number,
	scrollClassName: string = REPORT_LIST_SCROLL
): string | undefined {
	return count > threshold ? scrollClassName : undefined;
}
