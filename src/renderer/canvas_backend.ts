/**
 * Loading the optional canvas backend.
 *
 * This lives apart from the public `png` entry point on purpose. Its type is
 * `typeof import('@napi-rs/canvas')`, and anything reachable from an entry point's
 * exports ends up in that entry's `.d.ts` — which would make every consumer of
 * `@versatiles/svg-renderer/png` need the optional peer installed just to typecheck.
 */
/**
 * The canvas backend is an *optional* peer dependency, so it is imported dynamically:
 * installing this package for SVG output alone must not pull in a 27 MB native binary,
 * and the browser bundle must never reach this module at all (see rollup.config.ts).
 */
export type CanvasBackend = typeof import('@napi-rs/canvas');

let backend: Promise<CanvasBackend> | undefined;

export async function loadCanvasBackend(): Promise<CanvasBackend> {
	backend ??= import('@napi-rs/canvas');
	try {
		return await backend;
	} catch (cause: unknown) {
		// Don't cache the failure: the caller may install the package and retry.
		backend = undefined;
		throw new Error(
			'PNG rendering needs the optional peer dependency "@napi-rs/canvas". ' +
				'Install it with `npm install @napi-rs/canvas`.',
			{ cause },
		);
	}
}
