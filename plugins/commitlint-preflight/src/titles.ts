import { titleReason, unparsedReason } from "./messages.ts";
import type { Dialect, Word } from "./shell.ts";
import { splitCommands } from "./shell.ts";

export type TitleCheck = { reason: string } | { title: string };

interface FlagTable {
	/** Long flag names, each mapped to whether it takes a value. */
	long: ReadonlyMap<string, boolean>;
	short: ReadonlyMap<string, string>;
}

interface Flag {
	name: string;
	skip: number;
	value: null | undefined | Word;
}

const ASSIGNMENT = /^[A-Z_a-z]\w*=/u;
const PREFIXES = new Set(["!", "do", "else", "then", "{"]);
const WRAPPERS = new Set(["command", "env", "exec", "nohup", "sudo", "time"]);
const GH = /(?:^|[/\\])gh(?:\.exe)?$/iu;
const BASH = /(?:^|[/\\])(?:ba)?sh(?:\.exe)?$/iu;
const BASH_COMMAND = /^-[a-z]*c[a-z]*$/u;
const POWERSHELL = /(?:^|[/\\])(?:pwsh|powershell)(?:\.exe)?$/iu;
const POWERSHELL_COMMAND = /^-c(?:o(?:m(?:m(?:a(?:nd?)?)?)?)?)?$/iu;
const UNPARSED = { reason: unparsedReason() } satisfies TitleCheck;

/** The root flags of gh, and the ones every `gh pr` subcommand inherits. */
const ROOT = "R/repo= help version";

/** From `gh pr create --help` and `gh pr edit --help`; `=` marks a value. */
const SUBCOMMAND_FLAGS = {
	create: flagTable(
		`${ROOT} a/assignee= B/base= b/body= F/body-file= d/draft dry-run e/editor f/fill fill-first fill-verbose H/head= l/label= m/milestone= no-maintainer-edit p/project= recover= r/reviewer= T/template= t/title= w/web`,
	),
	edit: flagTable(
		`${ROOT} add-assignee= add-label= add-project= add-reviewer= B/base= b/body= F/body-file= m/milestone= remove-assignee= remove-label= remove-milestone remove-project= remove-reviewer= t/title=`,
	),
};

const ROOT_FLAGS = flagTable(ROOT);
const ALIASES = new Map<string, keyof typeof SUBCOMMAND_FLAGS>([
	["create", "create"],
	["edit", "edit"],
	["new", "create"],
]);

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
	return splitCommands(command, dialect).flatMap((words) => checkCommand(words, command));
}

function flagTable(spec: string): FlagTable {
	const long = new Map<string, boolean>();
	const short = new Map<string, string>();
	for (const entry of spec.split(" ")) {
		const name = entry.replace(/^\w\//u, "").replace(/=$/u, "");
		long.set(name, entry.endsWith("="));
		if (entry.charAt(1) === "/") {
			short.set(entry.charAt(0), name);
		}
	}

	return { long, short };
}

function readLongFlag(word: Word, following: null | Word, table: FlagTable): Flag | undefined {
	const [name = "", ...values] = word.text.slice(2).split("=");
	const hasValue = table.long.get(name);
	if (hasValue === undefined) {
		return undefined;
	}

	if (!hasValue || values.length > 0) {
		return { name: hasValue ? name : "", skip: 1, value: { ...word, text: values.join("=") } };
	}

	return { name, skip: 2, value: following };
}

function readShortFlags(word: Word, following: null | Word, table: FlagTable): Flag | undefined {
	for (let offset = 1; offset < word.text.length; offset++) {
		const name = table.short.get(word.text.charAt(offset));
		if (name === undefined) {
			return undefined;
		}

		const rest = word.text.slice(offset + 1);
		if (table.long.get(name) === true) {
			return rest === ""
				? { name, skip: 2, value: following }
				: { name, skip: 1, value: { ...word, text: rest.replace(/^=/u, "") } };
		}

		if (rest.startsWith("=")) {
			break;
		}
	}

	return { name: "", skip: 1, value: undefined };
}

/**
 * Reads one flag word the way pflag does: `--name=value`, `--name value`, or a
 * run of shorthands where a value flag takes the rest of the word (less a
 * leading `=`) or the next word.
 *
 * @param word - A word that starts with `-`.
 * @param following - The word after it, if any.
 * @param table - The flags the command takes.
 * @returns The last value flag read and how many words it took, or
 *   `undefined` for an unknown flag.
 */
function readFlag(word: Word, following: null | Word, table: FlagTable): Flag | undefined {
	return word.text.startsWith("--")
		? readLongFlag(word, following, table)
		: readShortFlags(word, following, table);
}

function isFlag(text: string): boolean {
	return text.startsWith("-") && text !== "-";
}

/**
 * Finds the subcommand after gh's root flags.
 *
 * @param args - The words after `gh`.
 * @returns The subcommand and where its arguments start, `undefined` for no
 *   `gh pr create` or `gh pr edit`, or `UNPARSED`.
 */
function parseRoot(
	args: ReadonlyArray<Word>,
): TitleCheck | undefined | { start: number; subcommand: keyof typeof SUBCOMMAND_FLAGS } {
	const positionals: Array<string> = [];
	let index = 0;
	for (let word = args[0]; word !== undefined && positionals.length < 2; word = args[index]) {
		const flag = isFlag(word.text)
			? readFlag(word, args[index + 1] ?? null, ROOT_FLAGS)
			: { name: "", skip: 1, value: undefined };
		if (flag === undefined) {
			return UNPARSED;
		}

		positionals.push(...(isFlag(word.text) ? [] : [word.text]));
		index += flag.skip;
	}

	const subcommand = ALIASES.get(positionals[1] ?? "");
	return positionals[0] === "pr" && subcommand !== undefined
		? { start: index, subcommand }
		: undefined;
}

function checkTitle(subcommand: string, word: null | undefined | Word): TitleCheck | undefined {
	if (word === undefined) {
		return subcommand === "create"
			? {
					reason: titleReason(
						subcommand,
						"is not on the command line (--fill, --web, editor, or prompt)",
					),
				}
			: undefined;
	}

	if (word === null) {
		return { reason: titleReason(subcommand, "flag has no value") };
	}

	if (word.unclosed) {
		return { reason: titleReason(subcommand, "has a quote that does not close") };
	}

	return word.dynamic
		? {
				reason: titleReason(
					subcommand,
					"holds a shell expansion, glob, redirection, or here-document",
				),
			}
		: { title: word.text };
}

/**
 * Parses the words after `gh` as gh does.
 *
 * @param args - The words after `gh`.
 * @returns The check for its title, `undefined` for none, or `UNPARSED`.
 */
function checkGh(args: ReadonlyArray<Word>): TitleCheck | undefined {
	const root = parseRoot(args);
	if (root === undefined || !("subcommand" in root)) {
		return root;
	}

	let title: null | undefined | Word;
	let index = root.start;
	for (let word = args[index]; word !== undefined && word.text !== "--"; word = args[index]) {
		const flag = isFlag(word.text)
			? readFlag(word, args[index + 1] ?? null, SUBCOMMAND_FLAGS[root.subcommand])
			: { name: "", skip: 1, value: undefined };
		if (flag === undefined || (flag.value === null && flag.name !== "title")) {
			return UNPARSED;
		}

		title = flag.name === "title" ? flag.value : title;
		index += flag.skip;
	}

	return checkTitle(root.subcommand, title);
}

/**
 * Checks the script a shell runs from its command line.
 *
 * @param script - The words that make up the script, if any.
 * @param dialect - The shell that runs it.
 * @param command - The whole command, raw.
 * @returns The script's checks.
 */
function checkScript(
	script: ReadonlyArray<Word>,
	dialect: Dialect,
	command: string,
): Array<TitleCheck> {
	if (script.length === 0 || script.some(({ dynamic, unclosed }) => dynamic || unclosed)) {
		return mentionsGhPr(command) ? [UNPARSED] : [];
	}

	return findTitleChecks(script.map(({ text }) => text).join(" "), dialect);
}

/**
 * Skips assignments, keywords, and wrapper commands with their options.
 *
 * @param words - One simple command's words.
 * @returns The words from the command name on, and whether a wrapper came first.
 */
function unwrap(words: ReadonlyArray<Word>): { isWrapped: boolean; rest: Array<Word> } {
	let isWrapped = false;
	const start = words.findIndex(({ text }) => {
		isWrapped ||= WRAPPERS.has(text);
		return (
			!WRAPPERS.has(text) &&
			!ASSIGNMENT.test(text) &&
			!PREFIXES.has(text) &&
			(!isWrapped || !isFlag(text))
		);
	});
	return { isWrapped, rest: start === -1 ? [] : words.slice(start) };
}

function checkShell(name: string, args: ReadonlyArray<Word>, command: string): Array<TitleCheck> {
	if (BASH.test(name)) {
		const option = args.findIndex(({ text }) => BASH_COMMAND.test(text));
		return option === -1
			? []
			: checkScript(args.slice(option + 1, option + 2), "bash", command);
	}

	const option = args.findIndex(({ text }) => POWERSHELL_COMMAND.test(text));
	return option === -1 ? [] : checkScript(args.slice(option + 1), "powershell", command);
}

function checkCommand(words: ReadonlyArray<Word>, command: string): Array<TitleCheck> {
	const { isWrapped, rest } = unwrap(words);
	const [name, ...args] = rest;
	if (name === undefined || name.dynamic) {
		return [];
	}

	if (BASH.test(name.text) || POWERSHELL.test(name.text)) {
		return checkShell(name.text, args, command);
	}

	if (!GH.test(name.text)) {
		const hasHiddenGh =
			args.some(({ text }) => GH.test(text)) && args.some(({ text }) => text === "pr");
		return isWrapped && hasHiddenGh ? [UNPARSED] : [];
	}

	const check = checkGh(args);
	return check === undefined ? [] : [check];
}
