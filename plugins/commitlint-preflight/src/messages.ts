export const PLUGIN_NAME = "commitlint-preflight";

const HINT = 'Pass a literal --title "<type>(<scope>): <subject>".';

export function titleReason(subcommand: string, problem: string): string {
	return `${PLUGIN_NAME}: the title of \`gh pr ${subcommand}\` ${problem}, so it cannot be checked against commitlint. ${HINT}`;
}

export function unparsedReason(): string {
	return `${PLUGIN_NAME}: a \`gh pr\` command here cannot be parsed (an unknown flag, wrapper, or script that is not a fixed string), so its title cannot be checked against commitlint. ${HINT}`;
}

export function missingCliReason(root: string): string {
	return `${PLUGIN_NAME}: ${root} configures commitlint but @commitlint/cli is not installed. Install dependencies, then run the command again.`;
}

export function failedReason(title: string, output: string): string {
	return `${PLUGIN_NAME}: commitlint rejects the PR title "${title}". A squash merge makes it the commit message.\n${output}`;
}

export function errorReason(title: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${PLUGIN_NAME}: commitlint did not run on the PR title "${title}": ${message}`;
}
