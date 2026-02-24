interface HookInput {
	// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
	tool_input: {
		// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
		file_path: string;
	};
}

export function isHookInput(value: unknown): value is HookInput {
	if (typeof value !== "object" || value === null || !("tool_input" in value)) {
		return false;
	}

	// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
	const { tool_input } = value as { tool_input: unknown };
	return typeof tool_input === "object" && tool_input !== null && "file_path" in tool_input;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];

export function isLintableFile(filePath: string, extensions = DEFAULT_EXTENSIONS): boolean {
	return extensions.some((extension) => filePath.endsWith(extension));
}
