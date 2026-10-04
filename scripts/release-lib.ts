/**
 * Pure helpers for the release process: versions and the changelog. Used by
 * `scripts/release.ts` (local: bump, commit, tag, push) and `scripts/release-check.ts`
 * (CI: verify the tag, extract the release notes).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
}

export function parseVersion(version: string): ParsedVersion {
	const match = SEMVER.exec(version);
	if (!match) throw new Error(`"${version}" is not a version like 1.2.3 or 2.0.0-rc.0`);
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ? match[4].split('.') : [],
	};
}

export function isPrerelease(version: string): boolean {
	return parseVersion(version).prerelease.length > 0;
}

/** Semver precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
	const x = parseVersion(a);
	const y = parseVersion(b);
	for (const key of ['major', 'minor', 'patch'] as const) {
		if (x[key] !== y[key]) return x[key] - y[key];
	}
	// A version without a prerelease ranks above the same version with one.
	if (x.prerelease.length === 0 || y.prerelease.length === 0) {
		return y.prerelease.length - x.prerelease.length;
	}
	for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
		const p = x.prerelease[i];
		const q = y.prerelease[i];
		if (p === undefined) return -1;
		if (q === undefined) return 1;
		if (p === q) continue;
		const pNum = /^\d+$/.test(p);
		const qNum = /^\d+$/.test(q);
		if (pNum && qNum) return Number(p) - Number(q);
		if (pNum) return -1;
		if (qNum) return 1;
		return p < q ? -1 : 1;
	}
	return 0;
}

/**
 * The version to release: `patch`, `minor` or `major` relative to `current`, or an
 * explicit version, which must be higher than `current`.
 */
export function nextVersion(current: string, request: string): string {
	if (request === 'patch' || request === 'minor' || request === 'major') {
		const v = parseVersion(current);
		if (v.prerelease.length > 0) {
			throw new Error(
				`${current} is a prerelease; give the next version explicitly (e.g. ${String(v.major)}.${String(v.minor)}.${String(v.patch)})`,
			);
		}
		if (request === 'patch') return `${String(v.major)}.${String(v.minor)}.${String(v.patch + 1)}`;
		if (request === 'minor') return `${String(v.major)}.${String(v.minor + 1)}.0`;
		return `${String(v.major + 1)}.0.0`;
	}
	parseVersion(request);
	if (compareVersions(request, current) <= 0) {
		throw new Error(`${request} is not higher than the current version ${current}`);
	}
	return request;
}

export type Bump = 'patch' | 'minor' | 'major';

export interface Commit {
	subject: string;
	body: string;
	/** Whether the commit changed CHANGELOG.md. */
	changelog: boolean;
}

/** The type of a conventional commit (`feat`, `fix`, ...) and whether it is marked as breaking. */
function parseCommit(commit: Commit): { type: string | undefined; breaking: boolean } {
	const match = /^(\w+)(?:\([^)]*\))?(!)?:/.exec(commit.subject);
	return {
		type: match?.[1],
		breaking: match?.[2] === '!' || /^BREAKING[ -]CHANGE:/m.test(commit.body),
	};
}

/** The bump a commit asks for, or `undefined` if users do not notice it (chore, refactor, ...). */
function commitBump(commit: Commit): Bump | undefined {
	const { type, breaking } = parseCommit(commit);
	if (breaking) return 'major';
	if (type === 'feat') return 'minor';
	if (type === 'fix' || type === 'perf') return 'patch';
	return undefined;
}

/** The commits users notice (features, fixes, breaking changes) that left CHANGELOG.md alone. */
export function commitsMissingNotes(commits: Commit[]): Commit[] {
	return commits.filter((commit) => commitBump(commit) !== undefined && !commit.changelog);
}

const BUMPS: Bump[] = ['patch', 'minor', 'major'];
const SUBSECTION_BUMPS: Record<string, Bump> = {
	Added: 'minor',
	Changed: 'minor',
	Deprecated: 'minor',
	Removed: 'major',
};

/**
 * The bump that the commits since the last release and the pending changelog notes ask
 * for: the highest that any of them names, at least `patch`.
 */
export function recommendBump(commits: Commit[], notes: string): Bump {
	const subsections = [...notes.matchAll(/^### (.+)$/gm)].map((match) => match[1]!.trim());
	const bumps = [
		...commits.map(commitBump),
		...subsections.map((title) => SUBSECTION_BUMPS[title]),
	];
	return BUMPS[Math.max(0, ...bumps.map((bump) => (bump ? BUMPS.indexOf(bump) : 0)))]!;
}

/**
 * The version to offer when none is given: `current` raised by `bump`. After a prerelease
 * it is the next prerelease (2.0.0-rc.0 → 2.0.0-rc.1), or the stable version if the
 * prerelease does not end with a number.
 */
export function recommendVersion(current: string, bump: Bump): string {
	const v = parseVersion(current);
	if (v.prerelease.length === 0) return nextVersion(current, bump);
	const core = `${String(v.major)}.${String(v.minor)}.${String(v.patch)}`;
	const last = v.prerelease.at(-1)!;
	if (!/^\d+$/.test(last)) return core;
	return `${core}-${[...v.prerelease.slice(0, -1), String(Number(last) + 1)].join('.')}`;
}

const UNRELEASED = 'Unreleased';

interface Section {
	/** The text in brackets: `Unreleased` or a version. */
	name: string;
	/** Line index of the `## [...]` heading. */
	start: number;
	/** Line index after the section's last line. */
	end: number;
	body: string;
}

/** The `## [...]` sections of a changelog, in file order. */
function parseSections(lines: string[]): Section[] {
	const starts = lines.flatMap((line, i) => {
		const match = /^## \[([^\]]+)\]/.exec(line);
		return match ? [{ name: match[1]!, start: i }] : [];
	});
	return starts.map(({ name, start }, k) => {
		const end = starts[k + 1]?.start ?? lines.length;
		return {
			name,
			start,
			end,
			body: lines
				.slice(start + 1, end)
				.join('\n')
				.trim(),
		};
	});
}

/** The sections of the prereleases of `version` (e.g. `2.0.0-rc.0` for `2.0.0`). */
function prereleaseSections(sections: Section[], version: string): Section[] {
	if (isPrerelease(version)) return [];
	return sections.filter(
		(s) => s.name.startsWith(`${version}-`) && SEMVER.test(s.name) && isPrerelease(s.name),
	);
}

/**
 * Merges release notes, oldest first. Subsections with the same `### ` title are combined
 * into one, in the order the titles first appear; text before the first subsection is
 * kept in front.
 */
export function mergeNotes(notes: string[]): string {
	const preambles: string[] = [];
	const subsections = new Map<string, string[]>();
	for (const note of notes) {
		const parts = note.split(/^(?=### )/m);
		const preamble = parts[0]!.startsWith('### ') ? '' : parts.shift()!.trim();
		if (preamble) preambles.push(preamble);
		for (const part of parts) {
			const [title, ...rest] = part.split('\n');
			const body = rest.join('\n').trim();
			const bodies = subsections.get(title!) ?? [];
			if (body) bodies.push(body);
			subsections.set(title!, bodies);
		}
	}
	const joinBodies = (bodies: string[]): string =>
		bodies.reduce((all, body) => {
			if (!all) return body;
			// Two lists continue as one list; anything else gets a paragraph break.
			const lastLine = all.split('\n').pop()!;
			return all + (lastLine.startsWith('- ') && body.startsWith('- ') ? '\n' : '\n\n') + body;
		}, '');
	return [
		...preambles,
		...[...subsections].map(([title, bodies]) => `${title}\n\n${joinBodies(bodies)}`.trim()),
	].join('\n\n');
}

/** The notes of the `[Unreleased]` section, or '' if it is empty. */
export function unreleasedNotes(changelog: string): string {
	const section = parseSections(changelog.split('\n')).find((s) => s.name === UNRELEASED);
	if (!section) throw new Error(`CHANGELOG.md has no "## [${UNRELEASED}]" section`);
	return section.body;
}

/** Replaces the notes of the `[Unreleased]` section. */
export function setUnreleasedNotes(changelog: string, notes: string): string {
	const lines = changelog.split('\n');
	const section = parseSections(lines).find((s) => s.name === UNRELEASED);
	if (!section) throw new Error(`CHANGELOG.md has no "## [${UNRELEASED}]" section`);
	const body = notes.trim() === '' ? [''] : ['', notes.trim(), ''];
	return [...lines.slice(0, section.start + 1), ...body, ...lines.slice(section.end)].join('\n');
}

/**
 * The notes that releasing `version` would publish: the `[Unreleased]` section and, for a
 * stable version, the notes of its prereleases, so that 2.0.0 describes everything since
 * 1.x and not only the changes since 2.0.0-rc.1.
 */
export function pendingNotes(changelog: string, version: string): string {
	const sections = parseSections(changelog.split('\n'));
	const unreleased = unreleasedNotes(changelog);
	const prereleases = prereleaseSections(sections, version)
		.map((s) => s.body)
		.reverse(); // the changelog lists newest first
	const notes = mergeNotes([...prereleases, unreleased].filter((n) => n !== ''));
	if (notes === '') {
		throw new Error(
			`Nothing to release: the "## [${UNRELEASED}]" section of CHANGELOG.md is empty`,
		);
	}
	return notes;
}

/**
 * Moves the pending notes of `version` (see {@link pendingNotes}) into a new
 * `[version] - date` section below an empty `[Unreleased]` section. For a stable version,
 * the sections of its prereleases are replaced by the new one.
 */
export function releaseChangelog(changelog: string, version: string, date: string): string {
	const lines = changelog.split('\n');
	const sections = parseSections(lines);
	if (sections.some((s) => s.name === version)) {
		throw new Error(`CHANGELOG.md already has a section for ${version}`);
	}
	const notes = pendingNotes(changelog, version);
	const unreleased = sections.find((s) => s.name === UNRELEASED)!;
	const replaced = new Set([unreleased, ...prereleaseSections(sections, version)]);

	const output = lines.slice(0, unreleased.start);
	output.push(lines[unreleased.start]!, '', `## [${version}] - ${date}`, '', notes, '');
	for (const section of sections) {
		if (replaced.has(section)) continue;
		output.push(...lines.slice(section.start, section.end));
	}
	return output.join('\n');
}

/** The release notes of `version` from the changelog. */
export function releaseNotes(changelog: string, version: string): string {
	const section = parseSections(changelog.split('\n')).find((s) => s.name === version);
	if (!section) throw new Error(`CHANGELOG.md has no section for ${version}`);
	if (section.body === '') throw new Error(`The CHANGELOG.md section for ${version} is empty`);
	return section.body;
}

/** Every `package.json` whose version is released in lockstep: the root and each workspace. */
export function lockstepManifests(repo: string): string[] {
	const packages = resolve(repo, 'packages');
	return [
		resolve(repo, 'package.json'),
		...readdirSync(packages, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => resolve(packages, entry.name, 'package.json')),
	];
}

export function readVersion(manifest: string): string {
	return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}
