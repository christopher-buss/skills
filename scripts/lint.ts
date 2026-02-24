import { dirname, join } from "node:path";

interface FileSystemDeps {
	existsSync(path: string): boolean;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];

export function isLintableFile(filePath: string, extensions = DEFAULT_EXTENSIONS): boolean {
	return extensions.some((extension) => filePath.endsWith(extension));
}

const ENTRY_CANDIDATES = ["index.ts", "cli.ts", "main.ts"];

export type DependencyGraph = Record<string, Array<string>>;

interface ExecDeps {
	execSync(command: string, options?: object): string;
}

export function findEntryPoints(sourceRoot: string, deps: FileSystemDeps): Array<string> {
	return ENTRY_CANDIDATES.map((name) => join(sourceRoot, name)).filter((path) => {
		return deps.existsSync(path);
	});
}

export function getDependencyGraph(
	sourceRoot: string,
	entryPoints: Array<string>,
	deps: ExecDeps,
): DependencyGraph {
	const entryArguments = entryPoints.map((ep) => `"${ep}"`).join(" ");
	const output = deps.execSync(`pnpm madge --json ${entryArguments}`, {
		cwd: sourceRoot,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	return JSON.parse(output) as DependencyGraph;
}

export function invertGraph(graph: DependencyGraph, target: string): Array<string> {
	const importers: Array<string> = [];
	for (const [file, dependencies] of Object.entries(graph)) {
		if (dependencies.includes(target)) {
			importers.push(file);
		}
	}

	return importers;
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
