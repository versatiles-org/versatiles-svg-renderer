import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['lib/**', 'node_modules/**', 'dist/**', 'e2e/**'],
		passWithNoTests: true,
		coverage: {
			include: ['src/**/*.ts'],
			exclude: ['src/demo.ts', 'src/docs.ts'],
			reporter: ['text', 'lcov'],
		},
	},
});
