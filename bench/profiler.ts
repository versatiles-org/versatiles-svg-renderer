import { Session, type Profiler } from 'node:inspector/promises';

export type Profile = Profiler.Profile;

/**
 * Records a CPU profile of `runs` calls of `run`, and nothing else.
 *
 * @param interval - Sampling interval in microseconds. The default of V8 (1000) misses most
 *   of a render's short functions.
 */
export async function profileRuns(
	run: () => Promise<unknown>,
	runs: number,
	interval = 100,
): Promise<Profile> {
	const session = new Session();
	session.connect();
	try {
		await session.post('Profiler.enable');
		await session.post('Profiler.setSamplingInterval', { interval });
		await session.post('Profiler.start');
		for (let i = 0; i < runs; i++) await run();
		const { profile } = await session.post('Profiler.stop');
		return profile;
	} finally {
		session.disconnect();
	}
}
