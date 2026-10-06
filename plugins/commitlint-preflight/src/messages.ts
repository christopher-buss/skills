export const PLUGIN_NAME = "commitlint-preflight";

export const TITLE = '--title "<type>(<scope>): <subject>"';

const DIRECT = `Run \`gh pr …\` directly, with a literal ${TITLE}.`;
const ESCAPED_QUOTE = String.raw`'\''`;

/**
 * Quotes a word so a shell reads it back as the same text.
 *
 * @param text - The word.
 * @returns The word, in single quotes when it needs them.
 */
export function quote(text: string): string {
	return /^[\w%+,./:=@-]+$/u.test(text) ? text : `'${text.replaceAll("'", ESCAPED_QUOTE)}'`;
}

/**
 * Why a title cannot be read, with the command to run instead.
 *
 * @param problem - What is wrong with the title.
 * @param args - The words after `gh`, less the title and the flags that replace it.
 * @returns A denial that names the problem and gives the command with a
 *   literal title.
 */
export function titleReason(problem: string, args: ReadonlyArray<string>): string {
	return `${PLUGIN_NAME}: the PR title ${problem}, so commitlint cannot check it. Run instead:\ngh ${[...args, TITLE].join(" ")}`;
}

export function unknownFlagReason(flag: string, help: string): string {
	return `${PLUGIN_NAME}: gh flag \`${flag}\` is unknown here, so the PR title cannot be read. Check \`${help} --help\`, or drop the flag.`;
}

export function missingValueReason(flag: string): string {
	return `${PLUGIN_NAME}: gh flag \`${flag}\` has no value, so the PR title cannot be read. Give \`${flag}\` its value, or drop it.`;
}

export function wrapperReason(wrapper: string): string {
	return `${PLUGIN_NAME}: \`${wrapper}\` wraps a \`gh pr\` command with options this mod cannot parse, so its title cannot be checked. ${DIRECT.replace("directly", "directly, without the wrapper")}`;
}

export function scriptReason(shell: string): string {
	return `${PLUGIN_NAME}: the script \`${shell}\` runs is not a fixed string, so a \`gh pr\` title in it cannot be checked. ${DIRECT}`;
}

export function encodedReason(shell: string): string {
	return `${PLUGIN_NAME}: \`${shell} -EncodedCommand\` hides its script, so a \`gh pr\` title in it cannot be checked. Run the script as plain text: the PowerShell tool, or \`${shell} -Command "<script>"\`.`;
}

export function missingCliReason(root: string, install: string): string {
	return `${PLUGIN_NAME}: ${root} configures commitlint but @commitlint/cli is not installed, so the PR title cannot be checked. Run \`${install}\` in ${root}, then the same command.`;
}

export function failedReason(title: string, output: string): string {
	return `${PLUGIN_NAME}: commitlint rejects the PR title "${title}" (a squash merge makes it the commit message):\n${output}\nFix the title as that output says (e.g. shorten it to the limit it names), and keep the rest of the command.`;
}

export function errorReason(title: string | undefined, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const shown = title === undefined ? "the PR title" : `the PR title "${title}"`;
	return `${PLUGIN_NAME}: commitlint did not run on ${shown}: ${message}\nRetry the command, or check the title by hand: printf '%s\\n' ${quote(title ?? "<title>")} | npx commitlint`;
}
