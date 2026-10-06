import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			thresholds: {
				"plugins/*/src/**/*.ts": {
					branches: 100,
					functions: 100,
					lines: 100,
					statements: 100,
				},
				"scripts/lint.ts": {
					branches: 100,
					functions: 100,
					lines: 100,
					statements: 100,
				},
			},
		},
		include: ["test/**/*.spec.ts", "plugins/*/tests/**/*.spec.ts"],
		testTimeout: 60000,
	},
});
