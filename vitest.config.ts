import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['lib/**', 'node_modules/**', 'dist/**', 'e2e/**'],
		passWithNoTests: true,
		coverage: {
			include: ['packages/core/src/**/*.ts'],
			exclude: ['packages/core/src/demo.ts', 'packages/core/src/docs.ts'],
			reporter: ['text', 'lcov'],
		},
	},
});
