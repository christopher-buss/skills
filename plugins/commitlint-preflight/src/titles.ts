// cspell:ignore encodedcommand
import {
	encodedReason,
	missingValueReason,
	quote,
	scriptReason,
	titleReason,
	unknownFlagReason,
	wrapperReason,
} from "./messages.ts";
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
const POWERSHELL_FILE = /^-f(?:i(?:le?)?)?$/iu;
const POWERSHELL_COMMAND = /^-c(?:o(?:m(?:m(?:a(?:nd?)?)?)?)?)?$/iu;
const FILL = new Set(["--fill", "--fill-first", "--fill-verbose", "-f"]);
const WEB = new Set(["--web", "-w"]);
const ENCODED = "encodedcommand";

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
 * Cheap test that a command needs a closer look: a `gh pr` invocation, or a
 * PowerShell call whose script may hide one.
 *
 * @param command - The shell command.
 * @returns True for every command that may hold a title.
 */
export function mayHoldTitle(command: string): boolean {
	return mentionsGhPr(command) || /pwsh|powershell/iu.test(command);
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
 *   `gh pr create` or `gh pr edit`, or why the flags cannot be read.
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
			return { reason: unknownFlagReason(word.text, "gh") };
		}

		positionals.push(...(isFlag(word.text) ? [] : [word.text]));
		index += flag.skip;
	}

	const subcommand = ALIASES.get(positionals[1] ?? "");
	return positionals[0] === "pr" && subcommand !== undefined
		? { start: index, subcommand }
		: undefined;
}

function missingProblem(words: ReadonlyArray<string>): string {
	const fill = words.find((text) => FILL.has(text));
	if (fill !== undefined) {
		return `is not written out (${fill} takes it from the commit subject)`;
	}

	const web = words.find((text) => WEB.has(text));
	return web === undefined
		? "is not written out (gh would prompt for it)"
		: `is not written out (${web} sets it in the browser)`;
}

function titleProblem(
	subcommand: string,
	word: null | undefined | Word,
	words: ReadonlyArray<string>,
): string | undefined {
	if (word === undefined) {
		return subcommand === "create" ? missingProblem(words) : undefined;
	}

	if (word === null) {
		return "flag has no value";
	}

	if (word.unclosed) {
		return "has a quote that does not close";
	}

	return word.dynamic
		? "holds a shell expansion, glob, redirection, or here-document"
		: undefined;
}

function render(word: Word): string {
	return word.dynamic || word.unclosed ? word.text : quote(word.text);
}

/**
 * Reads the subcommand's flags as pflag does.
 *
 * @param args - The words after `gh`.
 * @param start - Where the subcommand's arguments start.
 * @param subcommand - `create` or `edit`, which picks the flag table.
 * @returns The last title flag's value and every other word, or why the flags
 *   cannot be read.
 */
function readSubcommand(
	args: ReadonlyArray<Word>,
	start: number,
	subcommand: keyof typeof SUBCOMMAND_FLAGS,
): { kept: Array<string>; title: null | undefined | Word } | { reason: string } {
	const kept = args.slice(0, start).map(render);
	let title: null | undefined | Word;
	let index = start;
	for (let word = args[index]; word !== undefined && word.text !== "--"; word = args[index]) {
		const flag = isFlag(word.text)
			? readFlag(word, args[index + 1] ?? null, SUBCOMMAND_FLAGS[subcommand])
			: { name: "", skip: 1, value: undefined };
		if (flag === undefined) {
			return { reason: unknownFlagReason(word.text, `gh pr ${subcommand}`) };
		}

		if (flag.value === null && flag.name !== "title") {
			return { reason: missingValueReason(word.text) };
		}

		title = flag.name === "title" ? flag.value : title;
		kept.push(
			...(flag.name === "title" ? [] : args.slice(index, index + flag.skip).map(render)),
		);
		index += flag.skip;
	}

	kept.push(...args.slice(index).map(render));
	return { kept, title };
}

/**
 * Parses the words after `gh` as gh does.
 *
 * @param args - The words after `gh`.
 * @returns The check for its title, `undefined` for none, or why it cannot be
 *   read.
 */
function checkGh(args: ReadonlyArray<Word>): TitleCheck | undefined {
	const root = parseRoot(args);
	if (root === undefined || !("subcommand" in root)) {
		return root;
	}

	const read = readSubcommand(args, root.start, root.subcommand);
	if ("reason" in read) {
		return read;
	}

	const { kept, title } = read;
	const problem = titleProblem(
		root.subcommand,
		title,
		args.map(({ text }) => text),
	);
	if (problem !== undefined) {
		return {
			reason: titleReason(
				problem,
				kept.filter((text) => !FILL.has(text) && !WEB.has(text)),
			),
		};
	}

	return title?.text === undefined ? undefined : { title: title.text };
}

function basename(path: string): string {
	return path.replace(/^.*[/\\]/u, "");
}

/**
 * Whether a PowerShell argument is `-EncodedCommand` in a spelling it takes:
 * `-`, `--`, or `/`, then `ec` or any prefix of `encodedcommand`.
 *
 * @param text - One argument.
 * @returns True for the encoded-command parameter.
 */
function isEncoded(text: string): boolean {
	const lower = text.toLowerCase();
	const name = lower.replace(/^(?:--?|\/)/u, "");
	return name !== lower && (name === "ec" || (name !== "" && ENCODED.startsWith(name)));
}

/**
 * Checks the script a shell runs from its command line.
 *
 * @param script - The words that make up the script, if any.
 * @param dialect - The shell that runs it.
 * @param command - The whole command, raw.
 * @param shell - The shell that runs it.
 * @returns The script's checks.
 */
function checkScript(
	script: ReadonlyArray<Word>,
	dialect: Dialect,
	command: string,
	shell: string,
): Array<TitleCheck> {
	if (script.length === 0 || script.some(({ dynamic, unclosed }) => dynamic || unclosed)) {
		return mentionsGhPr(command) ? [{ reason: scriptReason(basename(shell)) }] : [];
	}

	return findTitleChecks(script.map(({ text }) => text).join(" "), dialect);
}

/**
 * Skips assignments, keywords, and wrapper commands with their options.
 *
 * @param words - One simple command's words.
 * @returns The words from the command name on, and the first wrapper, if any.
 */
function unwrap(words: ReadonlyArray<Word>): { rest: Array<Word>; wrapper: string | undefined } {
	let wrapper: string | undefined;
	const start = words.findIndex(({ text }) => {
		wrapper ??= WRAPPERS.has(text) ? text : undefined;
		const isWrapped = wrapper !== undefined;
		return (
			!WRAPPERS.has(text) &&
			!ASSIGNMENT.test(text) &&
			!PREFIXES.has(text) &&
			(!isWrapped || !isFlag(text))
		);
	});
	return { rest: start === -1 ? [] : words.slice(start), wrapper };
}

function checkShell(name: string, args: ReadonlyArray<Word>, command: string): Array<TitleCheck> {
	if (BASH.test(name)) {
		const option = args.findIndex(({ text }) => BASH_COMMAND.test(text));
		return option === -1
			? []
			: checkScript(args.slice(option + 1, option + 2), "bash", command, name);
	}

	const option = args.findIndex(
		({ text }) => POWERSHELL_COMMAND.test(text) || POWERSHELL_FILE.test(text),
	);
	const flag = args[option];
	if (
		args.slice(0, flag === undefined ? args.length : option).some(({ text }) => isEncoded(text))
	) {
		return [{ reason: encodedReason(basename(name)) }];
	}

	return flag === undefined || POWERSHELL_FILE.test(flag.text)
		? []
		: checkScript(args.slice(option + 1), "powershell", command, name);
}

function checkCommand(words: ReadonlyArray<Word>, command: string): Array<TitleCheck> {
	const { rest, wrapper } = unwrap(words);
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
		return wrapper !== undefined && hasHiddenGh ? [{ reason: wrapperReason(wrapper) }] : [];
	}

	const check = checkGh(args);
	return check === undefined ? [] : [check];
}
