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
	heredocs: Array<string>;
	index: number;
	isBash: boolean;
	source: string;
	word: undefined | Word;
	words: Array<Word>;
}

const SEPARATORS = new Set(["\n", "&", "(", ")", ";", "|"]);
const POWERSHELL_SEPARATORS = new Set([...SEPARATORS, "{", "}"]);
const BLANKS = new Set(["\t", "\r", " "]);
const BASH_DYNAMIC = new Set(["$", "*", "<", ">", "?", "[", "`", "{", "~"]);
const POWERSHELL_DYNAMIC = new Set(["$", "<", ">", "@"]);
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
	const lexer = createLexer(source, dialect);
	while (lexer.index < source.length) {
		const char = source.charAt(lexer.index);
		if (!readLayout(lexer, char) && !readQuoted(lexer, char)) {
			readPlain(lexer, char);
		}
	}

	endCommand(lexer);
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
	} else if ((lexer.isBash ? SEPARATORS : POWERSHELL_SEPARATORS).has(char)) {
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

	word.dynamic ||= char === "$" || (lexer.isBash && char === "`");
	word.text += char;
	return 1;
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
			(lexer.isBash ? readBashSingle : readPowerShellSingle)(lexer, current(lexer));

			break;
		}
		case lexer.isBash ? "\\" : "`": {
			readEscape(lexer);

			break;
		}
		default: {
			if (lexer.isBash && lexer.source.startsWith("<<", lexer.index)) {
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

function readPlain(lexer: Lexer, char: string): void {
	const word = current(lexer);
	word.dynamic ||= (lexer.isBash ? BASH_DYNAMIC : POWERSHELL_DYNAMIC).has(char);
	word.text += char;
	lexer.index += 1;
}

function createLexer(source: string, dialect: Dialect): Lexer {
	return {
		commands: [],
		heredocs: [],
		index: 0,
		isBash: dialect === "bash",
		source,
		word: undefined,
		words: [],
	};
}
