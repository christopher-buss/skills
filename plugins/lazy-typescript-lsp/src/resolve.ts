import path from "node:path";

const TYPESCRIPT_7 = [
	{ name: "@typescript/native", bin: "bin/tsc" },
	{ name: "@typescript/native-preview", bin: "bin/tsgo.js" },
];

const UNSET_OPTION = /^\$\{user_config\.\w+\}$/;

export interface ServerCommand {
	args: Array<string>;
	command: string;
	manifest: string | undefined;
	shell: boolean;
}

export interface ResolveContext {
	execPath: string;
	findPackage: (name: string) => string | undefined;
}

export function resolveServer(
	setting: string,
	{ execPath, findPackage }: ResolveContext,
): ServerCommand | undefined {
	const command = setting.trim();
	if (command !== "" && !UNSET_OPTION.test(command)) {
		const [program = ""] = command.split(/\s/, 1);
		const root = findPackage(program);
		return {
			args: [],
			command,
			manifest: root === undefined ? undefined : path.join(root, "package.json"),
			shell: true,
		};
	}

	for (const { name, bin } of TYPESCRIPT_7) {
		const root = findPackage(name);
		if (root !== undefined) {
			return {
				args: [path.join(root, bin), "--lsp", "--stdio"],
				command: execPath,
				manifest: path.join(root, "package.json"),
				shell: false,
			};
		}
	}

	return undefined;
}
