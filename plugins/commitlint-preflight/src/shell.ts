export type Dialect = "bash" | "powershell";

/** One shell word: its text with quotes removed, and whether it is not a fixed string. */
export interface Word {
	/** The word holds an expansion, glob, redirection, or here-document marker. */
	dynamic: boolean;
	text: string;
	/** A quote in the word never closes. */
	unclosed: boolean;
}

interface Lexer {
	commands: Array<Array<Word>>;
	depth: number;
	dialect: Dialect;
	heredocs: Array<string>;
	index: number;
	isBash: boolean;
	source: string;
	syntax: Syntax;
	word: undefined | Word;
	words: Array<Word>;
}

interface Syntax {
	dynamic: ReadonlySet<string>;
	escape: string;
	readSingle: (lexer: Lexer, word: Word) => void;
	separators: ReadonlySet<string>;
}

const SEPARATORS = new Set(["\n", "&", "(", ")", ";", "|"]);
const BLANKS = new Set(["\t", "\r", " "]);
const BASH_DOUBLE_ESCAPES = new Set(["\n", '"', "$", "\\", "`"]);
const POWERSHELL_ESCAPES = new Set(['"', "$", "'", "`"]);
const HEREDOC = /^<<-?[\t ]*(?:'([^\n']*)'|"([^\n"]*)"|([^\s&();<>|]+))/u;

/**
 * Splits shell source into simple commands, each a list of words. Command
 * separators, comments, quotes, and escapes follow the dialect; here-document
 * bodies are skipped, so their text never reads as a command.
 *
 * @param source - The shell source.
 * @param dialect - The shell that runs it.
 * @returns Each simple command's words, in order.
 */
export function splitCommands(source: string, dialect: Dialect): Array<Array<Word>> {
	const lexer = createLexer(source, dialect, 0, []);
	lex(lexer, false);
	return lexer.commands;
}

function endWord(lexer: Lexer): void {
	if (lexer.word === undefined) {
		return;
	}

	lexer.words.push(lexer.word);
	lexer.word = undefined;
}

function endCommand(lexer: Lexer): void {
	endWord(lexer);
	if (lexer.words.length > 0) {
		lexer.commands.push(lexer.words);
	}

	lexer.words = [];
}

function lineEnd(source: string, from: number): number {
	const end = source.indexOf("\n", from);
	return end === -1 ? source.length : end;
}

function skipHeredocBodies(lexer: Lexer): void {
	for (const delimiter of lexer.heredocs) {
		let isClosed = false;
		while (!isClosed && lexer.index < lexer.source.length) {
			const stop = lineEnd(lexer.source, lexer.index);
			isClosed = lexer.source.slice(lexer.index, stop).replace(/^\t+/u, "") === delimiter;
			lexer.index = stop + 1;
		}
	}

	lexer.heredocs = [];
}

/**
 * Handles a comment, blank, or separator.
 *
 * @param lexer - The lexer state.
 * @param char - The character at the lexer's index.
 * @returns Whether the character was one.
 */
function readLayout(lexer: Lexer, char: string): boolean {
	if (char === "#" && lexer.word === undefined) {
		lexer.index = lineEnd(lexer.source, lexer.index);
	} else if (BLANKS.has(char)) {
		endWord(lexer);
		lexer.index += 1;
	} else if (lexer.syntax.separators.has(char)) {
		endCommand(lexer);
		lexer.index += 1;
		if (char === "\n") {
			skipHeredocBodies(lexer);
		}
	} else {
		return false;
	}

	return true;
}

function current(lexer: Lexer): Word {
	lexer.word ??= { dynamic: false, text: "", unclosed: false };
	return lexer.word;
}

function readPlain(lexer: Lexer, char: string): void {
	const word = current(lexer);
	word.dynamic ||= lexer.syntax.dynamic.has(char);
	word.text += char;
	lexer.index += 1;
}

/**
 * Reads commands until the source ends or, when nested, until the `)` that
 * closes the substitution.
 *
 * @param lexer - The lexer state.
 * @param isNested - Whether the lexer reads a `$( … )` body.
 * @returns Whether a nested body closes.
 */
function lex(lexer: Lexer, isNested: boolean): boolean {
	while (lexer.index < lexer.source.length) {
		const char = lexer.source.charAt(lexer.index);
		if (isNested && char === ")" && lexer.depth === 0) {
			endCommand(lexer);
			lexer.index += 1;
			return true;
		}

		lexer.depth = Math.max(0, lexer.depth + Number(char === "(") - Number(char === ")"));
		if (!readLayout(lexer, char) && !readQuoted(lexer, char)) {
			readPlain(lexer, char);
		}
	}

	endCommand(lexer);
	return !isNested;
}

function readHeredocMarker(lexer: Lexer): void {
	const match = HEREDOC.exec(lexer.source.slice(lexer.index));
	const word = current(lexer);
	word.dynamic = true;
	if (match === null) {
		word.text += "<<";
		lexer.index += 2;
		return;
	}

	word.text += match[0];
	lexer.heredocs.push(match[0].replace(/^<<-?\s*/u, "").replaceAll(/["']/gu, ""));
	lexer.index += match[0].length;
}

function readBashSingle(lexer: Lexer, word: Word): void {
	const close = lexer.source.indexOf("'", lexer.index + 1);
	word.unclosed = close === -1;
	const end = word.unclosed ? lexer.source.length : close;
	word.text += lexer.source.slice(lexer.index + 1, end);
	lexer.index = end + 1;
}

function readPowerShellSingle(lexer: Lexer, word: Word): void {
	const { source } = lexer;
	let index = lexer.index + 1;
	while (index < source.length) {
		const char = source.charAt(index);
		const isDoubled = char === "'" && source.charAt(index + 1) === "'";
		if (char === "'" && !isDoubled) {
			lexer.index = index + 1;
			return;
		}

		word.text += char;
		index += isDoubled ? 2 : 1;
	}

	word.unclosed = true;
	lexer.index = index;
}

/**
 * Reads one unit inside double quotes.
 *
 * @param lexer - The lexer state.
 * @param word - The word to append to.
 * @param index - Where the unit starts.
 * @returns How many characters the unit took.
 */
function readDoubleUnit(lexer: Lexer, word: Word, index: number): number {
	const char = lexer.source.charAt(index);
	const next = lexer.source.charAt(index + 1);
	if (lexer.isBash && char === "\\" && BASH_DOUBLE_ESCAPES.has(next)) {
		word.text += next === "\n" ? "" : next;
		return 2;
	}

	if (!lexer.isBash && char === "`") {
		word.dynamic ||= !POWERSHELL_ESCAPES.has(next);
		word.text += next;
		return 2;
	}

	if (!lexer.isBash && char === '"' && next === '"') {
		word.text += '"';
		return 2;
	}

	if (char === "$" && next === "(") {
		return readSubstitution(lexer, word, index);
	}

	if (lexer.isBash && char === "`") {
		return readBackticks(lexer, word, index);
	}

	word.dynamic ||= char === "$";
	word.text += char;
	return 1;
}

/**
 * Reads `$(( … ))` as arithmetic, or `$( … )`, whose commands join the list.
 *
 * @param lexer - The lexer state.
 * @param word - The word the substitution is part of.
 * @param index - Where the `$` is.
 * @returns How many characters the substitution took.
 */
function readSubstitution(lexer: Lexer, word: Word, index: number): number {
	word.dynamic = true;
	if (lexer.isBash && lexer.source.startsWith("$((", index)) {
		let depth = 2;
		let end = index + 3;
		for (; depth > 0 && end < lexer.source.length; end++) {
			const char = lexer.source.charAt(end);
			depth += Number(char === "(") - Number(char === ")");
		}

		word.unclosed ||= depth > 0;
		return end - index;
	}

	const body = createLexer(lexer.source, lexer.dialect, index + 2, lexer.commands);
	word.unclosed ||= !lex(body, true);
	return body.index - index;
}

/**
 * Reads a backtick substitution, whose commands join the list.
 *
 * @param lexer - The lexer state.
 * @param word - The word the substitution is part of.
 * @param index - Where the opening backtick is.
 * @returns How many characters the substitution took.
 */
function readBackticks(lexer: Lexer, word: Word, index: number): number {
	let body = "";
	let end = index + 1;
	while (end < lexer.source.length && lexer.source.charAt(end) !== "`") {
		const char = lexer.source.charAt(end);
		const next = lexer.source.charAt(end + 1);
		const isEscape = char === "\\" && ["$", "\\", "`"].includes(next);
		body += isEscape ? next : char;
		end += isEscape ? 2 : 1;
	}

	word.dynamic = true;
	word.unclosed ||= end >= lexer.source.length;
	lexer.commands.push(...splitCommands(body, "bash"));
	return end + 1 - index;
}

function isDoubleClose(lexer: Lexer, index: number): boolean {
	return (
		lexer.source.charAt(index) === '"' &&
		(lexer.isBash || lexer.source.charAt(index + 1) !== '"')
	);
}

function readDouble(lexer: Lexer, word: Word): void {
	let index = lexer.index + 1;
	while (index < lexer.source.length) {
		if (isDoubleClose(lexer, index)) {
			lexer.index = index + 1;
			return;
		}

		index += readDoubleUnit(lexer, word, index);
	}

	word.unclosed = true;
	lexer.index = index;
}

function readHereString(lexer: Lexer, word: Word): void {
	const quote = lexer.source.charAt(lexer.index + 1);
	const close = lexer.source.indexOf(`\n${quote}@`, lexer.index + 2);
	word.dynamic = true;
	word.unclosed = close === -1;
	lexer.index = word.unclosed ? lexer.source.length : close + 3;
}

function readEscape(lexer: Lexer): void {
	const next = lexer.source.charAt(lexer.index + 1);
	if (next !== "\n") {
		current(lexer).text += next;
	}

	lexer.index += 2;
}

function isHereString(lexer: Lexer, char: string): boolean {
	return (
		!lexer.isBash &&
		char === "@" &&
		lexer.word === undefined &&
		/^@["']\r?\n/u.test(lexer.source.slice(lexer.index))
	);
}

/**
 * Handles a quote, escape, or here-document.
 *
 * @param lexer - The lexer state.
 * @param char - The character at the lexer's index.
 * @returns Whether the character began one.
 */
function readQuoted(lexer: Lexer, char: string): boolean {
	switch (char) {
		case '"': {
			readDouble(lexer, current(lexer));

			break;
		}
		case "'": {
			lexer.syntax.readSingle(lexer, current(lexer));

			break;
		}
		case lexer.syntax.escape: {
			readEscape(lexer);

			break;
		}
		default: {
			if (lexer.source.startsWith("$(", lexer.index) || (lexer.isBash && char === "`")) {
				lexer.index += readDoubleUnit(lexer, current(lexer), lexer.index);
			} else if (lexer.isBash && lexer.source.startsWith("<<", lexer.index)) {
				readHeredocMarker(lexer);
			} else if (isHereString(lexer, char)) {
				readHereString(lexer, current(lexer));
			} else {
				return false;
			}
		}
	}

	return true;
}

const SYNTAX = {
	bash: {
		dynamic: new Set(["$", "*", "<", ">", "?", "[", "`", "{", "~"]),
		escape: "\\",
		readSingle: readBashSingle,
		separators: SEPARATORS,
	},
	powershell: {
		dynamic: new Set(["$", "<", ">", "@"]),
		escape: "`",
		readSingle: readPowerShellSingle,
		separators: new Set([...SEPARATORS, "{", "}"]),
	},
} satisfies Record<Dialect, Syntax>;

function createLexer(
	source: string,
	dialect: Dialect,
	index: number,
	commands: Array<Array<Word>>,
): Lexer {
	return {
		commands,
		depth: 0,
		dialect,
		heredocs: [],
		index,
		isBash: dialect === "bash",
		source,
		syntax: SYNTAX[dialect],
		word: undefined,
		words: [],
	};
}
