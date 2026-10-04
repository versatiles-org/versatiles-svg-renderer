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
 * If something fails:
 *   - before the tag is pushed (steps 5 to 8), the release commit and the tag are undone;
 *     notes added to CHANGELOG.md are kept. Start again.
 *   - in the release workflow, the release is unfinished, and the next `npm run release`
 *     offers to finish it instead of starting a new one. On the tagged commit it runs the
 *     failed jobs again (an npm outage, a declined approval). If there are commits since
 *     then (the code had to be fixed), it moves the tag to HEAD and releases that, with
 *     the same version and changelog section. A tag only moves while nothing of the
 *     version is on npm or in a GitHub release; after that, the fix is the next version.
 *
 * Options:
 *   --resume         finish the unfinished release without asking whether to
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
const resume = args.includes('--resume');
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

/** Like {@link run}, but keeps what the command writes to stderr off the terminal. */
function runQuiet(command: string, commandArgs: string[]): string {
	return execFileSync(command, commandArgs, {
		cwd: repo,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
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

/** Asks for a yes; `--yes` gives it. */
async function confirm(question: string): Promise<boolean> {
	return yes || (await ask(`${question} [y/N] `)).toLowerCase() === 'y';
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

/**
 * Waits until the run of a workflow on a commit has completed, reporting its progress.
 * `restarted` says that the run was just started again, so that it may still show the
 * result of its last attempt.
 */
async function waitForRun(
	workflow: string,
	commit: string,
	name: string,
	restarted = false,
): Promise<WorkflowRun> {
	const started = Date.now();
	let reported = '';
	for (;;) {
		let latest: WorkflowRun | undefined;
		try {
			latest = findRun(workflow, commit);
		} catch {
			// GitHub was not reachable: try again.
			await sleep(10_000);
			continue;
		}
		const stale = restarted && latest?.status === 'completed' && Date.now() - started < 60_000;
		if (latest?.status === 'completed' && !stale) return latest;
		if (!latest && Date.now() - started > 180_000) {
			fail(`GitHub started no ${name} run for ${commit.slice(0, 9)}`);
		}
		const state = stale ? 'starting again' : (latest?.status ?? 'not started yet');
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
const sha = run('git', ['rev-parse', 'HEAD']);
const packages = manifests
	.map(
		(manifest) => JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; private?: boolean },
	)
	.filter((manifest) => !manifest.private)
	.map((manifest) => manifest.name);

if (request) {
	try {
		nextVersion(current, request);
	} catch (error) {
		fail(errorMessage(error));
	}
}

/** The checks that HEAD can be released; they also count the commits that origin lacks. */
let unpushed = 0;
function checkHead(): void {
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
	check('main is not behind origin', () => {
		run('git', ['fetch', '--quiet', 'origin', 'main', '--tags']);
		const [behind, ahead] = run('git', [
			'rev-list',
			'--left-right',
			'--count',
			'origin/main...HEAD',
		])
			.split(/\s+/)
			.map(Number);
		unpushed = ahead!;
		return behind === 0 ? undefined : `origin has ${String(behind)} commit(s) more: pull first`;
	});
	if (!skipCiCheck) {
		check('CI has not failed on this commit', () => {
			if (unpushed > 0) return undefined;
			const latest = findRun('ci.yml', sha);
			if (latest?.status !== 'completed' || latest.conclusion === 'success') return undefined;
			return `CI ${latest.conclusion}: ${latest.url}`;
		});
	}
}

/** Pushes the commits that origin lacks, and waits until CI has passed on HEAD. */
async function pushAndAwaitCi(): Promise<void> {
	if (unpushed > 0) {
		run('git', ['push', 'origin', 'main']);
		info(`pushed ${String(unpushed)} commit(s) to origin`);
	}
	if (skipCiCheck) return;
	const ci = await waitForRun('ci.yml', sha, 'CI');
	if (ci.conclusion !== 'success') {
		fail(
			`CI ${ci.conclusion}; nothing was released.\n  ${ci.url}\n  gh run view ${String(ci.databaseId)} --log-failed`,
		);
	}
	console.log(`${green('✓')} CI passed on this commit`);
}

function isOnNpm(name: string, version: string): boolean {
	try {
		return runQuiet('npm', ['view', `${name}@${version}`, 'version']) === version;
	} catch {
		return false;
	}
}

function isGithubReleasePublished(tag: string): boolean {
	try {
		const release = JSON.parse(runQuiet('gh', ['release', 'view', tag, '--json', 'isDraft'])) as {
			isDraft: boolean;
		};
		return !release.isDraft;
	} catch {
		return false;
	}
}

/**
 * Watches the release workflow on the tagged commit until it has finished, and confirms
 * that the packages are on npm and the GitHub release is published.
 */
async function watchRelease(tag: string, commit: string, restarted = false): Promise<never> {
	console.log(
		dim(
			'Watching the release workflow. It goes on without this script: Ctrl-C only stops watching.',
		),
	);
	const release = await waitForRun('release.yml', commit, 'the release', restarted);
	if (release.conclusion !== 'success') {
		fail(
			`The release workflow ended with "${release.conclusion}": ${release.url}\n  gh run view ${String(release.databaseId)} --log-failed\n  Then run \`npm run release\` again: it offers to finish ${tag}.`,
		);
	}
	check(`GitHub release ${tag} is published`, () =>
		isGithubReleasePublished(tag) ? undefined : 'not found, or still a draft',
	);
	if (problems.length > 0) fail(`The release workflow succeeded, but ${tag} is not complete.`);

	// The workflow succeeded, so npm has accepted the packages. The registry shows a new
	// version only some time later, usually within a few minutes: wait for it.
	const version = tag.slice(1);
	const started = Date.now();
	let awaited = packages;
	for (;;) {
		const missing = awaited.filter((name) => !isOnNpm(name, version));
		for (const name of awaited) {
			if (!missing.includes(name)) console.log(`${green('✓')} ${name}@${version} is on npm`);
		}
		if (missing.length === 0) break;
		if (Date.now() - started > 15 * 60_000) {
			console.log(
				`\n${green(`✓ Released ${tag}`)}, but npm does not show ${missing.join(', ')} yet, 15 minutes after publishing.\n  Check later: npm view ${missing[0]!}@${version} version`,
			);
			process.exit(0);
		}
		if (awaited === packages) info('waiting until npm shows the new version …');
		awaited = missing;
		await sleep(10_000);
	}

	console.log(green(`\n✓ Released ${tag}.`));
	console.log(`  https://github.com/versatiles-org/versatiles-svg-renderer/releases/tag/${tag}`);
	process.exit(0);
}

// --- Unfinished release -------------------------------------------------------------
// The last release is unfinished if its workflow did not succeed. It is finished in one of
// two ways. If the cause was outside the code (an npm outage, a declined approval), the
// failed jobs run again on the tagged commit. If the code had to be fixed, the tag moves
// to HEAD, which keeps the version and its changelog section and starts the workflow anew;
// that is only possible while nothing of the version is published.
const currentTag = `v${current}`;

function findUnfinishedRelease(): { commit: string; latest: WorkflowRun | undefined } | undefined {
	try {
		if (run('git', ['tag', '--list', currentTag]) === '') return undefined;
		const commit = run('git', ['rev-list', '-n', '1', currentTag]);
		const latest = findRun('release.yml', commit);
		if (latest?.status === 'completed' && latest.conclusion === 'success') return undefined;
		return { commit, latest };
	} catch {
		return undefined;
	}
}

async function finishRelease(commit: string, latest: WorkflowRun | undefined): Promise<never> {
	if (latest && latest.status !== 'completed') {
		info(`the release workflow of ${currentTag} is still running`);
		return watchRelease(currentTag, commit);
	}

	const published = packages.filter((name) => isOnNpm(name, current));
	const githubRelease = isGithubReleasePublished(currentTag);
	const fixes = run('git', ['log', '--oneline', `${commit}..HEAD`])
		.split('\n')
		.filter((line) => line !== '');
	if (latest) info(`the release workflow ended with "${latest.conclusion}": ${latest.url}`);
	info(published.length > 0 ? `on npm: ${published.join(', ')}` : 'nothing is on npm yet');

	if (latest && fixes.length === 0) {
		if (dryRun) {
			console.log(green(`Dry run: would run the failed jobs of ${currentTag} again.`));
			process.exit(0);
		}
		if (!(await confirm(`Run the failed jobs of ${currentTag} again?`))) fail('Aborted.');
		run('gh', ['run', 'rerun', String(latest.databaseId), '--failed']);
		return watchRelease(currentTag, commit, true);
	}

	if (published.length > 0 || githubRelease) {
		fail(
			`${currentTag} is partly published from ${commit.slice(0, 9)}, so the tag cannot move to another commit.\n` +
				`  To finish ${currentTag} as it is tagged: gh run rerun ${String(latest?.databaseId ?? '<run>')} --failed\n` +
				`  To release the commits since then: add their notes to CHANGELOG.md and run \`npm run release patch\`.`,
		);
	}
	try {
		run('git', ['merge-base', '--is-ancestor', commit, 'HEAD']);
	} catch {
		fail(`${currentTag} (${commit.slice(0, 9)}) is not part of this branch`);
	}
	checkHead();
	if (fixes.length > 0) {
		console.log(`\n${currentTag} moves from ${commit.slice(0, 9)} to HEAD, taking in:`);
		for (const fix of fixes) console.log(dim(`    ${fix}`));
	}
	console.log('');
	if (problems.length > 0) fail(`${String(problems.length)} check(s) failed; nothing was changed.`);
	if (dryRun) {
		console.log(green(`Dry run: would tag HEAD as ${currentTag} and release it.`));
		process.exit(0);
	}
	if (!(await confirm(`Tag HEAD as ${currentTag} and release it?`))) fail('Aborted.');

	await pushAndAwaitCi();
	run('git', ['tag', '--annotate', '--force', currentTag, '-m', `Release ${currentTag}`]);
	// A tag that only moves starts no workflow if it already points at this commit on
	// origin, so it is deleted there first; that fails if origin does not have it.
	try {
		runQuiet('git', ['push', 'origin', `:refs/tags/${currentTag}`]);
	} catch {
		// origin has no such tag
	}
	run('git', ['push', '--force', 'origin', `refs/tags/${currentTag}`]);
	console.log(green(`\n✓ Pushed ${currentTag}.`));
	return watchRelease(currentTag, sha);
}

const unfinished = findUnfinishedRelease();
if (unfinished) {
	info(`the release of ${bold(currentTag)} is not finished`);
	if (
		resume ||
		(interactive && !request && (await ask(`Finish ${currentTag}? [Y/n] `)).toLowerCase() !== 'n')
	) {
		await finishRelease(unfinished.commit, unfinished.latest);
	}
	info(`leaving it; \`npm run release -- --resume\` finishes it`);
} else if (resume) {
	fail(`The release of ${currentTag} is finished; there is nothing to resume.`);
}

checkHead();
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
- Users do notice a change of what a published package depends on (\`dependencies\` and \`peerDependencies\` in packages/*/package.json): note it under "### Changed".
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

// Without notes there is nothing to release, unless a stable version takes in the notes of
// its prereleases. Say so before asking for a version, and let the notes be written here.
if (interactive && unreleasedNotes(changelog) === '' && !isPrerelease(current)) {
	console.log(`\nCHANGELOG.md has no notes, so there is nothing to release since ${lastTag}.`);
	if (!(await confirm('Write the notes in your editor, to release anyway?'))) {
		fail('Nothing to release; nothing was changed.');
	}
	const written = editNotes('### Changed\n\n- ');
	if (written === '' || written === '### Changed\n\n-') {
		fail('Nothing to release; nothing was changed.');
	}
	changelog = setUnreleasedNotes(changelog, written);
	writeFileSync(changelogPath, changelog);
	info('added the notes to CHANGELOG.md; they go into the release commit');
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

if (!(await confirm(`Release ${tag} and push it to origin?`))) {
	fail('Aborted; nothing was committed or pushed.');
}

await pushAndAwaitCi();

// --- Release ------------------------------------------------------------------------
// Until the push, which is atomic, nothing has left this machine: a failure is undone, so
// that the release can simply be started again.
const date = new Date().toISOString().slice(0, 10);
const releaseFiles = ['CHANGELOG.md', 'package-lock.json', ...manifests];
let committed = false;
let tagged = false;
try {
	for (const manifest of manifests) {
		const content = readFileSync(manifest, 'utf8');
		const updated = content.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
		if (updated === content) throw new Error(`could not set the version in ${manifest}`);
		writeFileSync(manifest, updated);
	}
	run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
	writeFileSync(changelogPath, releaseChangelog(changelog, version, date));

	run('git', ['add', ...releaseFiles]);
	run('git', ['commit', '--quiet', '-m', `release: ${tag}`]);
	committed = true;
	run('git', ['tag', '--annotate', tag, '-m', `Release ${tag}`]);
	tagged = true;
	run('git', ['push', '--atomic', 'origin', 'main', tag]);
} catch (error) {
	if (tagged) run('git', ['tag', '--delete', tag]);
	if (committed) run('git', ['reset', '--quiet', '--soft', sha]);
	run('git', ['checkout', '--quiet', 'HEAD', '--', ...releaseFiles]);
	// The notes drafted for this release were not committed before: keep them.
	writeFileSync(changelogPath, changelog);
	fail(
		`${errorMessage(error)}\n  The release commit and its tag were undone; nothing was released.`,
	);
}

console.log(green(`\n✓ Pushed ${tag}.`));
await watchRelease(tag, run('git', ['rev-parse', 'HEAD']));
