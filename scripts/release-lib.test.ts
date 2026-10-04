import { describe, expect, test } from 'vitest';
import {
	commitsMissingNotes,
	compareVersions,
	isPrerelease,
	mergeNotes,
	nextVersion,
	pendingNotes,
	recommendBump,
	recommendVersion,
	releaseChangelog,
	releaseNotes,
	setUnreleasedNotes,
	unreleasedNotes,
	type Commit,
} from './release-lib.js';

describe('compareVersions', () => {
	test.each([
		['1.2.3', '1.2.4', -1],
		['1.10.0', '1.9.0', 1],
		['2.0.0', '2.0.0', 0],
		['2.0.0-rc.0', '2.0.0', -1],
		['2.0.0-rc.1', '2.0.0-rc.0', 1],
		['2.0.0-rc.10', '2.0.0-rc.9', 1],
		['2.0.0-alpha', '2.0.0-beta', -1],
		['2.0.0-rc', '2.0.0-rc.0', -1],
		['2.0.0-1', '2.0.0-rc', -1],
	])('%s vs %s', (a, b, sign) => {
		expect(Math.sign(compareVersions(a, b))).toBe(sign);
	});
});

describe('nextVersion', () => {
	test.each([
		['1.2.3', 'patch', '1.2.4'],
		['1.2.3', 'minor', '1.3.0'],
		['1.2.3', 'major', '2.0.0'],
		['1.2.0', '2.0.0-rc.0', '2.0.0-rc.0'],
		['2.0.0-rc.0', '2.0.0-rc.1', '2.0.0-rc.1'],
		['2.0.0-rc.1', '2.0.0', '2.0.0'],
	])('%s + %s → %s', (current, request, expected) => {
		expect(nextVersion(current, request)).toBe(expected);
	});

	test('rejects a version that is not higher', () => {
		expect(() => nextVersion('1.2.0', '1.2.0')).toThrow(/not higher/);
		expect(() => nextVersion('2.0.0', '2.0.0-rc.0')).toThrow(/not higher/);
	});

	test('rejects garbage', () => {
		expect(() => nextVersion('1.2.0', 'v2.0.0')).toThrow(/not a version/);
		expect(() => nextVersion('1.2.0', 'huge')).toThrow(/not a version/);
	});

	test('asks for an explicit version after a prerelease', () => {
		expect(() => nextVersion('2.0.0-rc.0', 'patch')).toThrow(/explicitly \(e\.g\. 2\.0\.0\)/);
	});

	test('isPrerelease', () => {
		expect(isPrerelease('2.0.0-rc.0')).toBe(true);
		expect(isPrerelease('2.0.0')).toBe(false);
	});
});

describe('recommended version', () => {
	const commit = (subject: string, body = '', changelog = false): Commit => ({
		subject,
		body,
		changelog,
	});

	test.each([
		[['chore: update dependencies', 'refactor: move files'], '', 'patch'],
		[['fix: repair ring winding', 'perf(core): cache tiles'], '', 'patch'],
		[['fix: a bug', 'feat(png): support image sources'], '', 'minor'],
		[['feat!: drop renderLabels'], '', 'major'],
		[['refactor(core)!: rename the options'], '', 'major'],
		[['chore: tidy up'], '### Fixed\n\n- a bug', 'patch'],
		[['chore: tidy up'], '### Fixed\n\n- a bug\n\n### Added\n\n- a thing', 'minor'],
		[['fix: a bug'], '### Deprecated\n\n- an option', 'minor'],
		[['feat: a thing'], '### Removed\n\n- an option', 'major'],
		[[], '', 'patch'],
	])('%j with notes %j → %s', (subjects, notes, expected) => {
		expect(
			recommendBump(
				subjects.map((s) => commit(s)),
				notes,
			),
		).toBe(expected);
	});

	test('reads BREAKING CHANGE from the body', () => {
		expect(recommendBump([commit('fix: a bug', 'BREAKING CHANGE: the option is gone')], '')).toBe(
			'major',
		);
		expect(recommendBump([commit('fix: a bug', 'nothing is BREAKING CHANGE: here')], '')).toBe(
			'patch',
		);
	});

	test.each([
		['1.2.3', 'patch', '1.2.4'],
		['1.2.3', 'minor', '1.3.0'],
		['1.2.3', 'major', '2.0.0'],
		['2.0.0-rc.0', 'minor', '2.0.0-rc.1'],
		['2.0.0-rc.9', 'patch', '2.0.0-rc.10'],
		['2.0.0-beta', 'major', '2.0.0'],
	] as const)('%s + %s → %s', (current, bump, expected) => {
		expect(recommendVersion(current, bump)).toBe(expected);
		expect(nextVersion(current, expected)).toBe(expected);
	});

	test('commitsMissingNotes lists what users notice and the changelog lacks', () => {
		const commits = [
			commit('feat: with notes', '', true),
			commit('feat: without notes'),
			commit('fix(svg): without notes'),
			commit('chore!: breaking without notes'),
			commit('refactor: nothing to note'),
			commit('Merge branch main'),
		];
		expect(commitsMissingNotes(commits).map((c) => c.subject)).toEqual([
			'feat: without notes',
			'fix(svg): without notes',
			'chore!: breaking without notes',
		]);
	});
});

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Added

- a new thing

## [1.2.0] - 2026-09-19

### Fixed

- an old thing
`;

describe('changelog', () => {
	test('unreleasedNotes returns the pending notes', () => {
		expect(unreleasedNotes(CHANGELOG)).toBe('### Added\n\n- a new thing');
	});

	test('releaseChangelog dates the pending notes and opens a new section', () => {
		const released = releaseChangelog(CHANGELOG, '2.0.0', '2026-09-30');
		expect(released).toContain(
			'## [Unreleased]\n\n## [2.0.0] - 2026-09-30\n\n### Added\n\n- a new thing',
		);
		expect(unreleasedNotes(released)).toBe('');
		expect(releaseNotes(released, '2.0.0')).toBe('### Added\n\n- a new thing');
		expect(releaseNotes(released, '1.2.0')).toBe('### Fixed\n\n- an old thing');
	});

	test('refuses to release empty notes or the same version twice', () => {
		const released = releaseChangelog(CHANGELOG, '2.0.0', '2026-09-30');
		expect(() => releaseChangelog(released, '2.0.1', '2026-10-01')).toThrow(/Nothing to release/);
		expect(() => releaseChangelog(CHANGELOG, '1.2.0', '2026-10-01')).toThrow(/already/);
	});

	test('setUnreleasedNotes replaces the pending notes only', () => {
		const notes = '### Added\n\n- a new thing\n- another thing';
		const updated = setUnreleasedNotes(CHANGELOG, notes);
		expect(unreleasedNotes(updated)).toBe(notes);
		expect(updated).toBe(CHANGELOG.replace('- a new thing\n', '- a new thing\n- another thing\n'));
		expect(setUnreleasedNotes(updated, unreleasedNotes(CHANGELOG))).toBe(CHANGELOG);
	});

	test('setUnreleasedNotes fills and empties the section', () => {
		const empty = setUnreleasedNotes(CHANGELOG, '');
		expect(empty).toContain('## [Unreleased]\n\n## [1.2.0] - 2026-09-19');
		expect(setUnreleasedNotes(empty, '### Added\n\n- a new thing')).toBe(CHANGELOG);
	});

	test('mergeNotes adds drafted notes to the subsections that exist', () => {
		expect(
			mergeNotes(['### Added\n\n- a new thing', '### Fixed\n\n- a bug\n\n### Added\n\n- more']),
		).toBe('### Added\n\n- a new thing\n- more\n\n### Fixed\n\n- a bug');
	});

	test('releaseNotes fails for an unknown version', () => {
		expect(() => releaseNotes(CHANGELOG, '9.9.9')).toThrow(/no section for 9\.9\.9/);
	});

	test('does not confuse 2.0.0 with 2.0.0-rc.0', () => {
		const released = releaseChangelog(CHANGELOG, '2.0.0-rc.0', '2026-09-30');
		expect(() => releaseNotes(released, '2.0.0')).toThrow(/no section/);
	});
});

describe('prereleases', () => {
	const addUnreleased = (changelog: string, notes: string): string =>
		changelog.replace('## [Unreleased]\n', `## [Unreleased]\n\n${notes}\n`);

	const rc0 = releaseChangelog(CHANGELOG, '2.0.0-rc.0', '2026-09-22');

	test('a prerelease only takes the [Unreleased] notes', () => {
		expect(releaseNotes(rc0, '2.0.0-rc.0')).toBe('### Added\n\n- a new thing');
		const next = addUnreleased(rc0, '### Fixed\n\n- a bug in rc.0');
		const rc1 = releaseChangelog(next, '2.0.0-rc.1', '2026-09-23');
		expect(releaseNotes(rc1, '2.0.0-rc.1')).toBe('### Fixed\n\n- a bug in rc.0');
		expect(releaseNotes(rc1, '2.0.0-rc.0')).toBe('### Added\n\n- a new thing');
	});

	test('the stable release takes its prereleases in, even with nothing new', () => {
		expect(pendingNotes(rc0, '2.0.0')).toBe('### Added\n\n- a new thing');
		const final = releaseChangelog(rc0, '2.0.0', '2026-09-30');
		expect(releaseNotes(final, '2.0.0')).toBe('### Added\n\n- a new thing');
		expect(() => releaseNotes(final, '2.0.0-rc.0')).toThrow(/no section/);
		expect(releaseNotes(final, '1.2.0')).toBe('### Fixed\n\n- an old thing');
		expect(unreleasedNotes(final)).toBe('');
	});

	test('merges subsections of all prereleases and [Unreleased], oldest first', () => {
		const next = addUnreleased(rc0, 'Intro of rc.1.\n\n### Fixed\n\n- a bug in rc.0');
		const rc1 = releaseChangelog(next, '2.0.0-rc.1', '2026-09-23');
		const last = addUnreleased(
			rc1,
			'### Added\n\n- one more thing\n\n### Fixed\n\n- a bug in rc.1',
		);
		const final = releaseChangelog(last, '2.0.0', '2026-09-30');
		expect(releaseNotes(final, '2.0.0')).toBe(
			[
				'Intro of rc.1.',
				'### Added\n\n- a new thing\n- one more thing',
				'### Fixed\n\n- a bug in rc.0\n- a bug in rc.1',
			].join('\n\n'),
		);
		expect(final.match(/^## \[/gm)).toHaveLength(3); // Unreleased, 2.0.0, 1.2.0
	});

	test('the prereleases of another version are left alone', () => {
		const other = releaseChangelog(CHANGELOG, '3.0.0-rc.0', '2026-09-22');
		const next = addUnreleased(other, '### Fixed\n\n- a fix for 2.0.1');
		const final = releaseChangelog(next, '2.0.1', '2026-09-30');
		expect(releaseNotes(final, '2.0.1')).toBe('### Fixed\n\n- a fix for 2.0.1');
		expect(releaseNotes(final, '3.0.0-rc.0')).toBe('### Added\n\n- a new thing');
	});
});
