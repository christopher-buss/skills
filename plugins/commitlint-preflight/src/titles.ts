import { NAME } from "./repo.ts";
import type { Dialect, Word } from "./shell.ts";
import { splitCommands } from "./shell.ts";

export type TitleCheck = { reason: string } | { title: string };

const ASSIGNMENT = /^[A-Z_a-z]\w*=/u;
const PREFIXES = new Set(["!", "command", "do", "else", "exec", "then", "time", "{"]);
const GH = /(?:^|[/\\])gh(?:\.exe)?$/iu;
const SUBCOMMANDS = new Set(["create", "edit"]);
const HINT = 'Pass a literal --title "<type>(<scope>): <subject>".';

/**
 * Cheap test that a command may hold a `gh pr` invocation.
 *
 * @param command - The shell command.
 * @returns True for every command that holds one.
 */
export function mentionsGhPr(command: string): boolean {
	return /gh[\s\S]*pr/u.test(command);
}

/**
 * One check per `gh pr create` or `gh pr edit` in the command. A `gh pr edit`
 * without a title flag has nothing to check and yields none.
 *
 * @param command - The shell command.
 * @param dialect - The shell that runs it.
 * @returns Each literal title, or why one cannot be read statically.
 */
export function findTitleChecks(command: string, dialect: Dialect): Array<TitleCheck> {
	return splitCommands(command, dialect)
		.map(checkInvocation)
		.filter((check) => check !== undefined);
}

function denial(subcommand: string, problem: string): TitleCheck {
	return {
		reason: `${NAME}: the title of \`gh pr ${subcommand}\` ${problem}, so it cannot be checked against commitlint. ${HINT}`,
	};
}

/**
 * Finds the last title value, as gh reads it.
 *
 * @param args - The words after `gh pr <subcommand>`.
 * @returns The word, `null` for a flag with no value, `undefined` for no flag.
 */
function titleWord(args: ReadonlyArray<Word>): null | undefined | Word {
	let found: null | undefined | Word;
	let isAwaitingValue = false;
	for (const word of args) {
		const { text } = word;
		if (isAwaitingValue) {
			found = word;
			isAwaitingValue = false;
		} else if (text === "--") {
			break;
		} else if (text === "--title" || text === "-t") {
			found = null;
			isAwaitingValue = true;
		} else if (text.startsWith("--title=")) {
			found = { ...word, text: text.slice("--title=".length) };
		} else if (/^-t[^-]/u.test(text)) {
			found = { ...word, text: text.slice(2) };
		}
	}

	return found;
}

/**
 * Recognizes a `gh pr create` or `gh pr edit` command.
 *
 * @param words - One simple command's words.
 * @returns The subcommand and the words after it, or `undefined`.
 */
function ghPrInvocation(
	words: ReadonlyArray<Word>,
): undefined | { args: Array<Word>; subcommand: string } {
	const start = words.findIndex(({ text }) => !ASSIGNMENT.test(text) && !PREFIXES.has(text));
	const [name, group, subcommand, ...args] = start === -1 ? [] : words.slice(start);
	const isGhPr =
		name !== undefined && !name.dynamic && GH.test(name.text) && group?.text === "pr";
	return isGhPr && subcommand !== undefined && SUBCOMMANDS.has(subcommand.text)
		? { args, subcommand: subcommand.text }
		: undefined;
}

function checkInvocation(words: ReadonlyArray<Word>): TitleCheck | undefined {
	const invocation = ghPrInvocation(words);
	if (invocation === undefined) {
		return undefined;
	}

	const { args, subcommand } = invocation;
	const word = titleWord(args);
	if (word === undefined) {
		return subcommand === "create"
			? denial(subcommand, "is not on the command line (--fill, --web, editor, or prompt)")
			: undefined;
	}

	if (word === null) {
		return denial(subcommand, "flag has no value");
	}

	if (word.unclosed) {
		return denial(subcommand, "has a quote that does not close");
	}

	return word.dynamic
		? denial(subcommand, "holds a shell expansion, glob, redirection, or here-document")
		: { title: word.text };
}
