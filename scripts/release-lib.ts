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

const UNRELEASED = '## [Unreleased]';

/** The body of the changelog section whose heading starts with `heading`, trimmed. */
function sectionBody(changelog: string, heading: string): string | undefined {
	const lines = changelog.split('\n');
	const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
	if (start < 0) return undefined;
	let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
	if (end < 0) end = lines.length;
	return lines
		.slice(start + 1, end)
		.join('\n')
		.trim();
}

/** The notes of the `[Unreleased]` section, or '' if it is empty. */
export function unreleasedNotes(changelog: string): string {
	const body = sectionBody(changelog, UNRELEASED);
	if (body === undefined) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" section`);
	return body;
}

/**
 * Turns the `[Unreleased]` section into `[version] - date` and opens a new, empty
 * `[Unreleased]` section above it.
 */
export function releaseChangelog(changelog: string, version: string, date: string): string {
	if (unreleasedNotes(changelog) === '') {
		throw new Error(`The "${UNRELEASED}" section of CHANGELOG.md is empty: nothing to release`);
	}
	if (sectionBody(changelog, `## [${version}]`) !== undefined) {
		throw new Error(`CHANGELOG.md already has a section for ${version}`);
	}
	return changelog.replace(`${UNRELEASED}\n`, `${UNRELEASED}\n\n## [${version}] - ${date}\n`);
}

/** The release notes of `version` from the changelog. */
export function releaseNotes(changelog: string, version: string): string {
	const body = sectionBody(changelog, `## [${version}]`);
	if (body === undefined) throw new Error(`CHANGELOG.md has no section for ${version}`);
	if (body === '') throw new Error(`The CHANGELOG.md section for ${version} is empty`);
	return body;
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
