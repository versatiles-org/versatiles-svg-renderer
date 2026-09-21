/**
 * Starts a release: `npm run release <patch|minor|major|x.y.z|x.y.z-pre.n>`.
 *
 * Checks that the release can start (clean tree, on main, in sync with origin, CI green on
 * this commit, pending changelog notes), shows the version and the notes, and after
 * confirmation:
 *   1. writes the version into every package.json (all packages share one version),
 *   2. dates the `[Unreleased]` section of CHANGELOG.md,
 *   3. commits "release: vX.Y.Z" and creates the annotated tag vX.Y.Z,
 *   4. pushes commit and tag in one atomic push.
 *
 * Building and publishing is not done here: the pushed tag triggers
 * `.github/workflows/release.yml`, which builds, tests, publishes to npm (after approval of
 * the `npm` environment) and creates the GitHub release.
 *
 * Options:
 *   --dry-run        run the checks and show what would happen, change nothing
 *   --yes            do not ask for confirmation
 *   --skip-ci-check  do not require a green CI run on this commit (emergencies only)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
	isPrerelease,
	lockstepManifests,
	nextVersion,
	readVersion,
	releaseChangelog,
	unreleasedNotes,
} from './release-lib.js';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');
const skipCiCheck = args.includes('--skip-ci-check');
const request = args.find((a) => !a.startsWith('--'));

const useColor = !process.env.NO_COLOR;
const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s: string): string => paint(31, s);
const green = (s: string): string => paint(32, s);
const bold = (s: string): string => paint(1, s);
const dim = (s: string): string => paint(90, s);

function run(command: string, commandArgs: string[]): string {
	return execFileSync(command, commandArgs, { cwd: repo, encoding: 'utf8' }).trim();
}

function fail(message: string): never {
	console.error(red(`✗ ${message}`));
	process.exit(1);
}

if (!request) {
	fail('Usage: npm run release <patch|minor|major|x.y.z|x.y.z-pre.n> [-- --dry-run]');
}

// --- Checks ---------------------------------------------------------------------
const problems: string[] = [];
function check(name: string, test: () => string | undefined): void {
	let problem: string | undefined;
	try {
		problem = test();
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
	}
	if (problem === undefined) {
		console.log(`${green('✓')} ${name}`);
	} else {
		console.log(`${red('✗')} ${name}: ${problem}`);
		problems.push(name);
	}
}

const manifests = lockstepManifests(repo);
const current = readVersion(manifests[0]!);

check('all packages share one version', () => {
	const mismatched = manifests.filter((m) => readVersion(m) !== current);
	return mismatched.length === 0
		? undefined
		: `${mismatched.map((m) => m.slice(repo.length + 1)).join(', ')} differ from ${current}`;
});

const version = (() => {
	try {
		return nextVersion(current, request);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
})();
const tag = `v${version}`;

check('working tree is clean', () =>
	run('git', ['status', '--porcelain']) === '' ? undefined : 'commit or stash your changes',
);
check('on branch main', () => {
	const branch = run('git', ['branch', '--show-current']);
	return branch === 'main' ? undefined : `on "${branch}"`;
});
check('main is in sync with origin', () => {
	run('git', ['fetch', '--quiet', 'origin', 'main', '--tags']);
	const local = run('git', ['rev-parse', 'HEAD']);
	const remote = run('git', ['rev-parse', 'origin/main']);
	return local === remote ? undefined : 'pull or push first';
});
check(`tag ${tag} does not exist yet`, () =>
	run('git', ['tag', '--list', tag]) === '' ? undefined : 'already tagged',
);
if (!skipCiCheck) {
	check('CI passed on this commit', () => {
		const sha = run('git', ['rev-parse', 'HEAD']);
		const runs = JSON.parse(
			run('gh', [
				'run',
				'list',
				'--commit',
				sha,
				'--workflow',
				'ci.yml',
				'--json',
				'status,conclusion',
				'--limit',
				'1',
			]),
		) as { status: string; conclusion: string }[];
		const latest = runs[0];
		if (!latest) return 'no CI run found for this commit';
		if (latest.status !== 'completed') return `CI is still ${latest.status}`;
		return latest.conclusion === 'success' ? undefined : `CI ${latest.conclusion}`;
	});
}
const changelogPath = resolve(repo, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');
check('CHANGELOG.md has notes under [Unreleased]', () =>
	unreleasedNotes(changelog) === '' ? 'the section is empty' : undefined,
);

// --- Summary ----------------------------------------------------------------------
console.log(
	`\n${bold(`${current} → ${version}`)}${isPrerelease(version) ? dim(' (prerelease: npm dist-tag "next")') : ''}`,
);
console.log(dim('\n--- release notes ---'));
console.log(unreleasedNotes(changelog));
console.log(dim('---------------------\n'));

if (problems.length > 0) {
	if (dryRun) {
		console.log(red(`Dry run: ${String(problems.length)} check(s) would block this release.`));
		process.exit(1);
	}
	fail(`${String(problems.length)} check(s) failed; nothing was changed.`);
}
if (dryRun) {
	console.log(green('Dry run: all checks pass. Nothing was changed.'));
	process.exit(0);
}

if (!yes) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`Release ${tag} and push it to origin? [y/N] `);
	rl.close();
	if (answer.trim().toLowerCase() !== 'y') fail('Aborted; nothing was changed.');
}

// --- Release ------------------------------------------------------------------------
const date = new Date().toISOString().slice(0, 10);
for (const manifest of manifests) {
	const content = readFileSync(manifest, 'utf8');
	const updated = content.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
	if (updated === content) fail(`could not set the version in ${manifest}`);
	writeFileSync(manifest, updated);
}
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
writeFileSync(changelogPath, releaseChangelog(changelog, version, date));

run('git', ['add', 'CHANGELOG.md', 'package-lock.json', ...manifests]);
run('git', ['commit', '--quiet', '-m', `release: ${tag}`]);
run('git', ['tag', '--annotate', tag, '-m', `Release ${tag}`]);
run('git', ['push', '--atomic', 'origin', 'main', tag]);

console.log(green(`\n✓ Pushed ${tag}.`));
console.log(
	`The release workflow is starting; approve the "npm" environment when it asks:\n  https://github.com/versatiles-org/versatiles-svg-renderer/actions/workflows/release.yml`,
);
