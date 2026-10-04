/**
 * Makes a release: `npm run release [patch|minor|major|x.y.z|x.y.z-pre.n]`.
 *
 * Checks that the release can start (on main, nothing uncommitted but CHANGELOG.md, not
 * behind origin, CI not failed on this commit), then:
 *   1. offers to let Claude draft the changelog notes, if commits since the last release
 *      have none (the draft is written to CHANGELOG.md after you accepted or edited it),
 *   2. without a version, recommends one from the commits and the changelog notes,
 *   3. shows the version and the notes, and asks for confirmation,
 *   4. pushes commits that are not on origin yet, and waits for CI to pass on this commit,
 *   5. writes the version into every package.json (all packages share one version),
 *   6. moves the `[Unreleased]` notes of CHANGELOG.md into a dated section for the version
 *      (a stable version also takes in the sections of its prereleases, e.g. 2.0.0-rc.*),
 *   7. commits "release: vX.Y.Z" and creates the annotated tag vX.Y.Z,
 *   8. pushes commit and tag in one atomic push,
 *   9. watches the release workflow until the packages are on npm and the GitHub release
 *      is published.
 *
 * Building and publishing is not done here: the pushed tag triggers
 * `.github/workflows/release.yml`, which builds, tests, publishes to npm (after approval of
 * the `npm` environment) and creates the GitHub release. Step 9 only watches it, so it can
 * be interrupted.
 *
 * Options:
 *   --dry-run        run the checks and show what would happen, change nothing
 *   --yes            do not ask anything: take the recommended version, draft no notes
 *   --skip-ci-check  do not require a green CI run on this commit (emergencies only)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
	commitsMissingNotes,
	isPrerelease,
	lockstepManifests,
	mergeNotes,
	nextVersion,
	pendingNotes,
	readVersion,
	recommendBump,
	recommendVersion,
	releaseChangelog,
	setUnreleasedNotes,
	unreleasedNotes,
	type Commit,
} from './release-lib.js';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes');
const skipCiCheck = args.includes('--skip-ci-check');
const request = args.find((a) => !a.startsWith('--'));
const interactive = !yes && !dryRun && process.stdin.isTTY;

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

function info(message: string): void {
	console.log(`${dim('•')} ${message}`);
}

async function ask(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(question);
	rl.close();
	return answer.trim();
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// --- Workflow runs ------------------------------------------------------------------
interface WorkflowRun {
	databaseId: number;
	status: string;
	conclusion: string;
	url: string;
}

/** The latest run of a workflow on a commit. */
function findRun(workflow: string, sha: string): WorkflowRun | undefined {
	const runs = JSON.parse(
		run('gh', [
			'run',
			'list',
			'--commit',
			sha,
			'--workflow',
			workflow,
			'--json',
			'databaseId,status,conclusion,url',
			'--limit',
			'1',
		]),
	) as WorkflowRun[];
	return runs[0];
}

/** Waits until the run of a workflow on a commit has completed, reporting its progress. */
async function waitForRun(workflow: string, sha: string, name: string): Promise<WorkflowRun> {
	const started = Date.now();
	let reported = '';
	for (;;) {
		let latest: WorkflowRun | undefined;
		try {
			latest = findRun(workflow, sha);
		} catch {
			// GitHub was not reachable: try again.
			await sleep(10_000);
			continue;
		}
		if (latest?.status === 'completed') return latest;
		if (!latest && Date.now() - started > 180_000) {
			fail(`GitHub started no ${name} run for ${sha.slice(0, 9)}`);
		}
		const state = latest?.status ?? 'not started yet';
		if (state !== reported) {
			reported = state;
			info(`${name} is ${state.replace('_', ' ')}${latest ? dim(` ${latest.url}`) : ''}`);
			if (state === 'waiting') console.log(bold('  Approve the "npm" environment there.'));
		}
		await sleep(10_000);
	}
}

// --- Checks ---------------------------------------------------------------------
const problems: string[] = [];
function check(name: string, test: () => string | undefined): void {
	let problem: string | undefined;
	try {
		problem = test();
	} catch (error) {
		problem = errorMessage(error);
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

if (request) {
	try {
		nextVersion(current, request);
	} catch (error) {
		fail(errorMessage(error));
	}
}

check('all packages share one version', () => {
	const mismatched = manifests.filter((m) => readVersion(m) !== current);
	return mismatched.length === 0
		? undefined
		: `${mismatched.map((m) => m.slice(repo.length + 1)).join(', ')} differ from ${current}`;
});
// Notes written for this release go into the release commit, so CHANGELOG.md may differ.
check('nothing is uncommitted but CHANGELOG.md', () => {
	const changed = [
		run('git', ['diff', '--name-only', 'HEAD']),
		run('git', ['ls-files', '--others', '--exclude-standard']),
	]
		.flatMap((list) => list.split('\n'))
		.filter((file) => file !== '' && file !== 'CHANGELOG.md');
	return changed.length === 0 ? undefined : `commit or stash ${changed.join(', ')}`;
});
check('on branch main', () => {
	const branch = run('git', ['branch', '--show-current']);
	return branch === 'main' ? undefined : `on "${branch}"`;
});
let unpushed = 0;
check('main is not behind origin', () => {
	run('git', ['fetch', '--quiet', 'origin', 'main', '--tags']);
	const [behind, ahead] = run('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'])
		.split(/\s+/)
		.map(Number);
	unpushed = ahead!;
	return behind === 0 ? undefined : `origin has ${String(behind)} commit(s) more: pull first`;
});
const sha = run('git', ['rev-parse', 'HEAD']);
if (!skipCiCheck) {
	check('CI has not failed on this commit', () => {
		if (unpushed > 0) return undefined;
		const latest = findRun('ci.yml', sha);
		if (latest?.status !== 'completed' || latest.conclusion === 'success') return undefined;
		return `CI ${latest.conclusion}: ${latest.url}`;
	});
}
if (problems.length > 0 && !dryRun) {
	fail(`${String(problems.length)} check(s) failed; nothing was changed.`);
}

// --- Changelog --------------------------------------------------------------------
const changelogPath = resolve(repo, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');

const lastTag = run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']);
const withNotes = new Set(
	run('git', ['log', '--format=%H', `${lastTag}..HEAD`, '--', 'CHANGELOG.md']).split('\n'),
);
const commits = run('git', ['log', '--format=%H%x1f%s%x1f%b%x1e', `${lastTag}..HEAD`])
	.split('\x1e')
	.map((entry) => entry.trim().split('\x1f'))
	.filter((fields) => fields[0] !== '')
	.map(([hash, subject, body]): Commit & { hash: string } => ({
		hash: hash!,
		subject: subject!,
		body: body ?? '',
		changelog: withNotes.has(hash!),
	}));

/** Lets Claude write the notes that the `[Unreleased]` section lacks; '' if there are none. */
function draftNotes(): string {
	const prompt = `You are drafting release notes for CHANGELOG.md of this repository.

Commits since ${lastTag} (newest first):
${commits.map((c) => `- ${c.hash.slice(0, 9)} ${c.subject}${c.changelog ? ' (changed CHANGELOG.md)' : ''}`).join('\n')}

Current "## [Unreleased]" section of CHANGELOG.md:
${unreleasedNotes(changelog) || '(empty)'}

Write the entries that this section lacks, for the changes that users of the published packages notice.
- Look at the commits (\`git show <hash>\`) and the code to understand what changed for users.
- Read the latest released section of CHANGELOG.md and write in its style: a bold lead, what happened before and what happens now, and a link to the issue if a commit refers to one.
- Group the entries under "### Added", "### Changed", "### Deprecated", "### Removed", "### Fixed" or "### Security".
- Do not repeat what the section already says.
- Leave out what users do not notice: refactorings, tests, CI, tooling, and updates of development dependencies.
- Do not change any file.

Answer with the new entries only, as Markdown between <notes> and </notes>. If nothing is missing, answer <notes></notes>.`;
	const answer = execFileSync(
		'claude',
		[
			'--print',
			prompt,
			'--allowedTools',
			'Read',
			'Grep',
			'Glob',
			'Bash(git log:*)',
			'Bash(git show:*)',
			'Bash(git diff:*)',
			'Bash(gh issue view:*)',
		],
		{
			cwd: repo,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'inherit'],
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	const match = /<notes>([\s\S]*)<\/notes>/.exec(answer);
	if (!match) throw new Error('Claude answered without <notes>');
	return match[1]!.trim();
}

function editNotes(notes: string): string {
	const file = join(mkdtempSync(join(tmpdir(), 'release-notes-')), 'notes.md');
	writeFileSync(file, `${notes}\n`);
	spawnSync(`${process.env.EDITOR ?? 'vi'} "${file}"`, { stdio: 'inherit', shell: true });
	return readFileSync(file, 'utf8').trim();
}

const missing = commitsMissingNotes(commits);
if (missing.length > 0) {
	info(`${String(missing.length)} commit(s) since ${lastTag} did not change CHANGELOG.md:`);
	for (const commit of missing) console.log(dim(`    ${commit.subject}`));
}
if (
	interactive &&
	commits.length > 0 &&
	(missing.length > 0 || unreleasedNotes(changelog) === '')
) {
	let hasClaude = true;
	try {
		run('claude', ['--version']);
	} catch {
		hasClaude = false;
		info('Claude Code (`claude`) is not installed, so it cannot draft the notes');
	}
	const question =
		missing.length > 0
			? 'Let Claude draft the missing changelog notes? [Y/n] '
			: 'CHANGELOG.md has no notes for this release. Let Claude draft them? [Y/n] ';
	if (hasClaude && (await ask(question)).toLowerCase() !== 'n') {
		let draft: string | undefined;
		while (draft === undefined) {
			info('Claude is reading the commits; this takes a minute or two …');
			try {
				draft = draftNotes();
			} catch (error) {
				info(`Claude could not draft the notes: ${errorMessage(error)}`);
				break;
			}
			if (draft === '') {
				info('Claude found nothing that the changelog lacks');
				break;
			}
			let reviewed = draft;
			for (;;) {
				console.log(dim('\n--- drafted notes ---'));
				console.log(reviewed);
				console.log(dim('---------------------\n'));
				const answer = (await ask('[a]ccept, [e]dit, [r]etry or [s]kip? ')).toLowerCase();
				if (answer === 'e') reviewed = editNotes(reviewed);
				if (answer === 'a' || answer === 'r' || answer === 's') {
					draft = answer === 'a' ? reviewed : answer === 'r' ? undefined : '';
					break;
				}
			}
		}
		if (draft) {
			const merged = mergeNotes([unreleasedNotes(changelog), draft].filter((n) => n !== ''));
			changelog = setUnreleasedNotes(changelog, merged);
			writeFileSync(changelogPath, changelog);
			info('added the notes to CHANGELOG.md; they go into the release commit');
		}
	}
}

// --- Version ----------------------------------------------------------------------
let version: string;
if (request) {
	version = nextVersion(current, request);
} else {
	const bump = recommendBump(commits, unreleasedNotes(changelog));
	version = recommendVersion(current, bump);
	const reason = isPrerelease(current) ? 'the next prerelease' : `a ${bump} release`;
	info(`recommended version: ${bold(version)} (${reason})`);
	while (interactive) {
		const answer = await ask(`Version to release [${version}]: `);
		if (answer === '') break;
		try {
			version = nextVersion(current, answer);
			break;
		} catch (error) {
			console.log(red(errorMessage(error)));
		}
	}
}
const tag = `v${version}`;

check(`tag ${tag} does not exist yet`, () =>
	run('git', ['tag', '--list', tag]) === '' ? undefined : 'already tagged',
);
// For a stable version this includes the notes of its prereleases (2.0.0 takes in 2.0.0-rc.*).
let notes = '';
check('CHANGELOG.md has release notes', () => {
	notes = pendingNotes(changelog, version);
	return undefined;
});

// --- Summary ----------------------------------------------------------------------
console.log(
	`\n${bold(`${current} → ${version}`)}${isPrerelease(version) ? dim(' (prerelease: npm dist-tag "next")') : ''}`,
);
console.log(dim('\n--- release notes ---'));
console.log(notes);
console.log(dim('---------------------\n'));
if (unpushed > 0) {
	console.log(`${String(unpushed)} commit(s) are pushed to origin first, and CI has to pass.\n`);
}

if (problems.length > 0) {
	if (dryRun) {
		console.log(red(`Dry run: ${String(problems.length)} check(s) would block this release.`));
		process.exit(1);
	}
	fail(`${String(problems.length)} check(s) failed; nothing was committed or pushed.`);
}
if (dryRun) {
	console.log(green('Dry run: all checks pass. Nothing was changed.'));
	process.exit(0);
}

if (!yes) {
	const answer = await ask(`Release ${tag} and push it to origin? [y/N] `);
	if (answer.toLowerCase() !== 'y') fail('Aborted; nothing was committed or pushed.');
}

// --- Push and wait for CI ---------------------------------------------------------
if (unpushed > 0) {
	run('git', ['push', 'origin', 'main']);
	info(`pushed ${String(unpushed)} commit(s) to origin`);
}
if (!skipCiCheck) {
	const ci = await waitForRun('ci.yml', sha, 'CI');
	if (ci.conclusion !== 'success') {
		fail(
			`CI ${ci.conclusion}; nothing was released.\n  ${ci.url}\n  gh run view ${String(ci.databaseId)} --log-failed`,
		);
	}
	console.log(`${green('✓')} CI passed on this commit`);
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

// --- Watch the release workflow -------------------------------------------------------
console.log(
	dim('Watching the release workflow. It goes on without this script: Ctrl-C only stops watching.'),
);
const release = await waitForRun('release.yml', run('git', ['rev-parse', 'HEAD']), 'the release');
if (release.conclusion !== 'success') {
	fail(
		`The release workflow ended with "${release.conclusion}". Fix the cause and choose "Re-run failed jobs"; do not move the tag.\n  ${release.url}`,
	);
}

const packages = manifests
	.map(
		(manifest) => JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; private?: boolean },
	)
	.filter((manifest) => !manifest.private);
for (const { name } of packages) {
	check(`${name}@${version} is on npm`, () =>
		run('npm', ['view', `${name}@${version}`, 'version']) === version ? undefined : 'not found',
	);
}
check(`GitHub release ${tag} is published`, () => {
	const { isDraft } = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'isDraft'])) as {
		isDraft: boolean;
	};
	return isDraft ? 'still a draft' : undefined;
});
if (problems.length > 0)
	fail(`The release workflow succeeded, but ${problems.join(' and ')} failed.`);

console.log(green(`\n✓ Released ${tag}.`));
console.log(`  https://github.com/versatiles-org/versatiles-svg-renderer/releases/tag/${tag}`);
