import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['lib/**', 'node_modules/**', 'dist/**', 'e2e/**'],
		passWithNoTests: true,
		coverage: {
			include: ['packages/*/src/**/*.ts'],
			exclude: ['packages/*/src/**/*.test.ts'],
			reporter: ['text', 'lcov'],
		},
	},
});
