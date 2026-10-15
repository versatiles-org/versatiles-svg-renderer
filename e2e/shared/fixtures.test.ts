import { describe, expect, test } from 'vitest';
import { addFixture, FIXTURES_URL, readFixture } from './fixtures.js';

describe('fixtures', () => {
	test('serves a fixture, made once when first asked for', () => {
		let made = 0;
		const url = addFixture('test/hello.txt', 'text/plain', () => {
			made++;
			return Buffer.from('hello');
		});
		expect(url).toBe(`${FIXTURES_URL}test/hello.txt`);
		expect(made).toBe(0);
		const answer = readFixture(url)!;
		expect([answer.status, answer.contentType, answer.body.toString()]).toEqual([
			200,
			'text/plain',
			'hello',
		]);
		readFixture(url);
		expect(made).toBe(1);
	});

	test('serves part of a fixture for a range request', () => {
		const url = addFixture('test/range.bin', 'application/octet-stream', Buffer.from('0123456789'));
		const answer = readFixture(url, 'bytes=2-4')!;
		expect([answer.status, answer.body.toString()]).toEqual([206, '234']);
		expect(readFixture(url, 'bytes=8-20')!.body.toString()).toBe('89');
		expect(readFixture(url)!.status).toBe(200);
	});

	test('answers 404 for an unknown path under the fixtures, and leaves other URLs alone', () => {
		expect(readFixture(`${FIXTURES_URL}nothing-here`)?.status).toBe(404);
		expect(readFixture('https://tiles.versatiles.org/tiles/osm/0/0/0')).toBeUndefined();
	});
});
