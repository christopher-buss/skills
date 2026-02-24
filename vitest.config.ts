import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			thresholds: {
				"scripts/lint.ts": {
					branches: 100,
					functions: 100,
					lines: 100,
					statements: 100,
				},
			},
		},
		include: ["test/**/*.spec.ts"],
		testTimeout: 60000,
	},
});
