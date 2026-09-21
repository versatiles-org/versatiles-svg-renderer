/**
 * The release workflow's guard: `tsx scripts/release-check.ts <tag> [--notes <file>]`.
 *
 * Fails unless the tag is `v` + the version of every package.json (all packages share one
 * version) and CHANGELOG.md has non-empty notes for that version. Writes the notes to
 * `--notes <file>`, and, in GitHub Actions, the outputs `version`, `prerelease` and
 * `dist-tag` (`next` for prereleases, so they never become `latest` on npm).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPrerelease, lockstepManifests, readVersion, releaseNotes } from './release-lib.js';

const repo = resolve(import.meta.dirname, '..');
const [tag, ...rest] = process.argv.slice(2);
const notesIndex = rest.indexOf('--notes');
const notesFile = notesIndex >= 0 ? rest[notesIndex + 1] : undefined;

function fail(message: string): never {
	console.error(`::error::${message}`);
	process.exit(1);
}

if (!tag?.startsWith('v')) fail(`expected a tag like v1.2.3, got "${tag ?? ''}"`);
const version = tag.slice(1);

for (const manifest of lockstepManifests(repo)) {
	const found = readVersion(manifest);
	if (found !== version) {
		fail(
			`${manifest.slice(repo.length + 1)} has version ${found}, but the tag is ${tag}. Refusing to release a tag that does not match the code.`,
		);
	}
}

let notes: string;
try {
	notes = releaseNotes(readFileSync(resolve(repo, 'CHANGELOG.md'), 'utf8'), version);
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
if (notesFile) writeFileSync(resolve(repo, notesFile), `${notes}\n`);

const prerelease = isPrerelease(version);
const outputs = {
	version,
	prerelease: String(prerelease),
	'dist-tag': prerelease ? 'next' : 'latest',
};
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		Object.entries(outputs)
			.map(([k, v]) => `${k}=${v}\n`)
			.join(''),
	);
}
console.log(
	`${tag} matches every package.json; release notes found (${String(notes.split('\n').length)} lines).`,
);
console.log(
	Object.entries(outputs)
		.map(([k, v]) => `${k}=${v}`)
		.join(', '),
);
