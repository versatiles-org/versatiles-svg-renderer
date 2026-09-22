/**
 * Loading the canvas backend, `@napi-rs/canvas`.
 *
 * This lives apart from the public entry point on purpose. Its type is
 * `typeof import('@napi-rs/canvas')`, and anything reachable from an entry point's exports
 * ends up in that entry's `.d.ts`. The public types reference only the backend's `Canvas`,
 * which `renderCanvas` returns by design; the rest of the backend stays out of them.
 */
/**
 * `@napi-rs/canvas` is a dependency of this package, but it is still imported lazily: its
 * native binary is only loaded when a PNG is rendered, so `renderToSVG` from this package
 * keeps working on a machine where that binary is missing, and a process that never
 * renders a PNG does not pay for loading it.
 */
export type CanvasBackend = typeof import('@napi-rs/canvas');

let backend: Promise<CanvasBackend> | undefined;

export async function loadCanvasBackend(): Promise<CanvasBackend> {
	backend ??= import('@napi-rs/canvas');
	try {
		return await backend;
	} catch (cause: unknown) {
		// Don't cache the failure: the caller may reinstall and retry.
		backend = undefined;
		throw new Error(missingBackendMessage(process.platform, process.arch, isMusl()), { cause });
	}
}

/**
 * The npm package that carries `@napi-rs/canvas`'s binary for a platform, named the way
 * `@napi-rs/canvas` itself resolves it, or `undefined` for a platform it has no binary for.
 */
export function nativePackageName(
	platform: string,
	arch: string,
	musl: boolean,
): string | undefined {
	const name = (suffix: string): string => `@napi-rs/canvas-${suffix}`;
	switch (platform) {
		case 'darwin':
			return arch === 'x64' || arch === 'arm64' ? name(`darwin-${arch}`) : undefined;
		case 'win32':
			return arch === 'x64' || arch === 'arm64' ? name(`win32-${arch}-msvc`) : undefined;
		case 'android':
			return arch === 'arm64' ? name('android-arm64') : undefined;
		case 'linux':
			if (arch === 'x64' || arch === 'arm64') return name(`linux-${arch}-${musl ? 'musl' : 'gnu'}`);
			if (arch === 'arm' && !musl) return name('linux-arm-gnueabihf');
			if (arch === 'riscv64' && !musl) return name('linux-riscv64-gnu');
			return undefined;
		default:
			return undefined;
	}
}

/**
 * Explains why the backend could not be loaded. The error `@napi-rs/canvas` throws itself
 * ("Cannot find native binding") names neither the platform nor the missing package, and
 * only suggests an old npm bug; the usual causes are elsewhere.
 */
export function missingBackendMessage(platform: string, arch: string, musl: boolean): string {
	const target = `${platform}-${arch}${platform === 'linux' ? (musl ? '-musl' : '-glibc') : ''}`;
	const pkg = nativePackageName(platform, arch, musl);
	if (pkg === undefined) {
		return (
			`PNG rendering needs the native module "@napi-rs/canvas", which has no prebuilt ` +
			`binary for this platform (${target}). renderToSVG() works without it.`
		);
	}
	return [
		`PNG rendering needs the native module "@napi-rs/canvas", but its binary for this ` +
			`platform (${target}) could not be loaded. npm installs it as the optional package ` +
			`"${pkg}", which is usually missing because:`,
		'  - dependencies were installed with --omit=optional (or --no-optional), or',
		'  - node_modules was installed on another OS or CPU architecture and copied here ' +
			'(e.g. installed on macOS, then copied into a Linux Docker image).',
		'Reinstall the dependencies on the machine that runs the code (e.g. `npm ci`). ' +
			'renderToSVG() works without it.',
	].join('\n');
}

/** Whether this Linux uses musl (e.g. Alpine) rather than glibc. */
function isMusl(): boolean {
	if (process.platform !== 'linux') return false;
	try {
		const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
		return !report.header?.glibcVersionRuntime;
	} catch {
		return false;
	}
}
