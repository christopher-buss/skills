import { dirname, join } from "node:path";

interface FileSystemDeps {
	existsSync(path: string): boolean;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];

export function isLintableFile(filePath: string, extensions = DEFAULT_EXTENSIONS): boolean {
	return extensions.some((extension) => filePath.endsWith(extension));
}

export function findSourceRoot(filePath: string, deps: FileSystemDeps): string | undefined {
	let current = dirname(filePath);
	while (current !== dirname(current)) {
		if (deps.existsSync(join(current, "package.json"))) {
			const sourceDirectory = join(current, "src");
			if (deps.existsSync(sourceDirectory)) {
				return sourceDirectory;
			}

			return current;
		}

		current = dirname(current);
	}

	return undefined;
}
