/**
 * Runs the e2e screenshots (or any command) in the Playwright container that CI and the
 * Pages workflow use, so that the numbers measured here are the numbers measured there:
 * the same Linux, Chromium, fonts and Node.
 *
 *   npm run test:e2e:docker                          # the screenshots
 *   E2E_REGIONS=parity-features npm run test:e2e:docker
 *   UPDATE_BASELINE=1 npm run test:e2e:docker        # bless the baseline
 *   npm run test:e2e:docker -- npm run test:e2e      # any command
 *   E2E_DOCKER_PLATFORM=linux/arm64 npm run test:e2e:docker   # native on Apple silicon
 *
 * It runs as x86-64 (`linux/amd64`), as on CI, also where that is emulated (Apple silicon):
 * the PNG renderer's Skia draws edges a little differently on ARM, which moves `png` and
 * `drift` by up to 0.05 points. `E2E_DOCKER_PLATFORM` chooses another platform.
 *
 * The repository is mounted into the container; its dependencies are installed there, into
 * a Docker volume over `node_modules`, so they are Linux builds and leave the host's alone.
 * They are installed again when `package-lock.json` changes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(resolve(repo, 'package-lock.json'), 'utf8')) as {
	packages: Record<string, { version?: string }>;
};
const version = lock.packages['node_modules/playwright']?.version;
if (!version) throw new Error('No playwright version in package-lock.json');
// The same image as the Pages workflow and CI's e2e job: the installed Playwright's.
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const platform = process.env.E2E_DOCKER_PLATFORM ?? 'linux/amd64';
// One volume per platform: the native packages differ.
const volume = `versatiles-svg-renderer-e2e-node-modules-${platform.replace('/', '-')}`;

const command = process.argv.slice(2);
const run = command.length > 0 ? command.join(' ') : 'npm run test:e2e:screenshots';

// Install when the lockfile changed since the last install into the volume; afterwards,
// give what the run wrote back to the host's user (the container runs as root).
const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const script = [
	'set -e',
	'hash="$(sha256sum package-lock.json)"',
	'if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$hash" ]; then',
	'  npm ci --no-audit --no-fund',
	'  echo "$hash" > node_modules/.lock-hash',
	'fi',
	'status=0',
	`${run} || status=$?`,
	`chown -R ${String(uid)}:${String(gid)} e2e/output e2e/.cache e2e/visual/diff-baseline.json 2>/dev/null || true`,
	'exit $status',
].join('\n');

console.log(`Running in ${image} (${platform}): ${run}`);
const result = spawnSync(
	'docker',
	[
		'run',
		'--rm',
		...(process.stdout.isTTY ? ['-t'] : []),
		'--platform',
		platform,
		'-v',
		`${repo}:/work`,
		'-v',
		`${volume}:/work/node_modules`,
		'-w',
		'/work',
		...['E2E_REGIONS', 'UPDATE_BASELINE', 'NO_COLOR'].flatMap((name) =>
			process.env[name] === undefined ? [] : ['-e', `${name}=${process.env[name]}`],
		),
		image,
		'bash',
		'-c',
		script,
	],
	{ stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
