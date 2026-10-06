import { describe, expect, it } from "vitest";

import { splitCommands } from "../src/shell.ts";
import { findTitleChecks, mentionsGhPr } from "../src/titles.ts";

function denied(pattern: RegExp): Array<unknown> {
	return [{ reason: expect.stringMatching(pattern) as unknown }];
}

describe(mentionsGhPr, () => {
	it("should match a gh pr command and skip others", () => {
		expect.assertions(2);

		expect(mentionsGhPr("git status && gh pr create")).toBe(true);
		expect(mentionsGhPr("git status")).toBe(false);
	});
});

describe("findTitleChecks in bash", () => {
	it.for<[string, string]>([
		["gh pr create --title feat:x", "feat:x"],
		["gh pr create --title 'feat: add x' --body b", "feat: add x"],
		['gh pr create --title "feat: say \\"hi\\" \\\\ \\$5 \\`x\\`"', 'feat: say "hi" \\ $5 `x`'],
		['gh pr create --title "a\\b"', "a\\b"],
		["gh pr create --title=feat:\\ x", "feat: x"],
		["gh pr create -t 'feat: x'", "feat: x"],
		["gh pr create '-t'\"feat: x\"", "feat: x"],
		["gh pr create -t first -t 'feat: last'", "feat: last"],
		["GH_TOKEN=abc gh pr create -t 'feat: x'", "feat: x"],
		["/usr/bin/gh pr edit 1 -t 'feat: x'", "feat: x"],
		["git push && gh pr create -t 'feat: x'", "feat: x"],
		["false || gh pr create -t 'feat: x'", "feat: x"],
		["cd a; gh pr create -t 'feat: x'", "feat: x"],
		["echo | gh pr create -t 'feat: x'", "feat: x"],
		["(gh pr create -t 'feat: x')", "feat: x"],
		["if true; then gh pr create -t 'feat: x'; fi", "feat: x"],
		["{ gh pr create -t 'feat: x'; }", "feat: x"],
		["git push\ngh pr create -t 'feat: x' \\\n  --body b", "feat: x"],
		["gh pr create -t 'feat: x' -- --title '$(no)'", "feat: x"],
		['gh pr create -t "feat: a \\\nb"', "feat: a b"],
		["gh pr create -t 'feat: x' # --title $(y)", "feat: x"],
		["# gh pr create --fill\ngh pr create -t 'feat: x'", "feat: x"],
		["gh pr create -t feat:x\\", "feat:x"],
	])("should read the literal title of %j", ([command, title]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual([{ title }]);
	});

	it.for([
		'gh pr create --title "$TITLE"',
		'gh pr create --title "feat: $(git log -1)"',
		"gh pr create --title `cat t`",
		'gh pr create --title "feat: `x`"',
		"gh pr create --title=$T",
		"gh pr create --title feat:*",
		"gh pr create --title {a,b}",
		"gh pr create --title ~",
		"gh pr create --title <title.txt",
		"gh pr create --title <<EOF\nfeat: x\nEOF",
		"gh pr create --title $'feat: x'",
	])("should deny the expansion in %j", (command) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual(
			denied(/shell expansion.*literal --title/su),
		);
	});

	it.for<[string, RegExp]>([
		["gh pr create --title 'feat: x", /does not close/u],
		['gh pr create --title "feat: x', /does not close/u],
		['gh pr create --title "feat: x\\', /does not close/u],
		["gh pr create --title", /no value/u],
		["gh pr edit 1 -t", /no value/u],
		["gh pr create --fill", /not on the command line/u],
		["gh pr create --web", /not on the command line/u],
		["gh pr create", /not on the command line/u],
	])("should deny %j", ([command, pattern]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual(denied(pattern));
	});

	it.for([
		"echo 'gh pr create'",
		'echo "gh pr create --fill"',
		"gh pr view 1",
		"gh pr edit 1 --body b",
		"gh issue create",
		"gh",
		"gh pr",
		"$GH pr create",
		"FOO=bar",
		"bash -c",
		"gh -R",
		"bash script.sh",
		"pwsh -File x.ps1",
		"git status",
		"cat <<EOF\ngh pr create --fill\nEOF\necho done",
		"cat <<-'EOF'\n\tgh pr create --fill\n\tEOF",
		'cat <<"EOF"\ngh pr create --fill',
		"",
	])("should find no title to check in %j", (command) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual([]);
	});

	it("should check every title in the command", () => {
		expect.assertions(1);

		expect(
			findTitleChecks("gh pr edit 1 -t 'feat: a' && gh pr edit 2 -t 'fix: b'", "bash"),
		).toStrictEqual([{ title: "feat: a" }, { title: "fix: b" }]);
	});

	it.for<[string, string]>([
		["gh -R o/r pr create -t 'feat: x'", "feat: x"],
		["gh --repo o/r pr edit 3 -t 'feat: x'", "feat: x"],
		["gh --repo=o/r pr create -t 'feat: x'", "feat: x"],
		["gh -Ro/r pr create -t 'feat: x'", "feat: x"],
		["gh pr -R o/r create -t 'feat: x'", "feat: x"],
		["gh pr new -t 'feat: x'", "feat: x"],
		["gh pr create -t 'feat: x' --body '--title=fix: no'", "feat: x"],
		["gh pr create -t 'feat: x' -b '-tests pass'", "feat: x"],
		["gh pr create -t=feat:x", "feat:x"],
		["gh pr create -dt 'feat: x'", "feat: x"],
		["gh pr create -dt'feat: x'", "feat: x"],
		["gh pr create --draft=true -t 'feat: x'", "feat: x"],
		["gh pr create -d=true -t 'feat: x'", "feat: x"],
		["gh pr create -t 'feat: x' -B main -H b -a @me -l l -m m -p p -r r -T t -F f", "feat: x"],
		[
			"gh pr create -t 'feat: x' --recover r --dry-run -w -e -f --fill-first --fill-verbose --no-maintainer-edit",
			"feat: x",
		],
		[
			"gh pr edit 3 -t 'feat: x' --add-label a --remove-label b --remove-milestone --add-assignee c --remove-assignee d --add-project e --remove-project f --add-reviewer g --remove-reviewer h",
			"feat: x",
		],
		["gh pr create -t 'feat: x' - --help", "feat: x"],
		["env A=b gh pr create -t 'feat: x'", "feat: x"],
		["env -i A=b gh pr create -t 'feat: x'", "feat: x"],
		["sudo gh pr create -t 'feat: x'", "feat: x"],
		["command gh pr create -t 'feat: x'", "feat: x"],
		["exec gh pr create -t 'feat: x'", "feat: x"],
		["time gh pr create -t 'feat: x'", "feat: x"],
		["nohup gh pr create -t 'feat: x'", "feat: x"],
		["bash -c \"gh pr create -t 'feat: x'\"", "feat: x"],
		["sh -lc 'gh pr create -t \"feat: x\"'", "feat: x"],
		["pwsh -Command \"gh pr create -t 'feat: x'\"", "feat: x"],
		["powershell.exe -c gh pr create -t feat:x", "feat:x"],
		["echo $((1<<2))\ngh pr create -t 'feat: x'", "feat: x"],
		["echo $(( (1+2)<<1 ))\ngh pr create -t 'feat: x'", "feat: x"],
	])("should read the title gh gets from %j", ([command, title]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual([{ title }]);
	});

	it.for<[string, string]>([
		["echo \"$(gh pr create -t 'bad')\"", "bad"],
		['echo "`gh pr create -t bad`"', "bad"],
		["echo `gh pr create -t bad`", "bad"],
		['echo "$(echo ")"; gh pr create -t bad)"', "bad"],
		["echo $(gh pr create -t bad)x", "bad"],
		["echo `gh pr create -t b\\ad`", "bad"],
		["echo `gh pr create -t \\\\\\\\b`", "\\b"],
		["echo `gh pr create -t 'a\\$'`", "a$"],
		["echo `gh pr create -t bad", "bad"],
	])("should read the title of the substitution in %j", ([command, title]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toContainEqual({ title });
	});

	it.for<[string, RegExp]>([
		["gh -X pr create -t 'feat: x'", /cannot be parsed/u],
		["gh pr create --bogus -t 'feat: x'", /cannot be parsed/u],
		["gh pr create -zt 'feat: x'", /cannot be parsed/u],
		["gh pr create -t 'feat: x' -b", /cannot be parsed/u],
		["S='gh pr create -t bad'; bash -c \"$S\"", /cannot be parsed/u],
		["bash -c # gh pr", /cannot be parsed/u],
		['pwsh -c "gh pr $x"', /cannot be parsed/u],
		["sudo -u root gh pr create -t 'feat: x'", /cannot be parsed/u],
	])("should deny %j, which cannot be parsed", ([command, pattern]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "bash")).toStrictEqual(denied(pattern));
	});

	it("should treat a stray heredoc marker as an expansion", () => {
		expect.assertions(1);

		expect(splitCommands("a <<", "bash")).toStrictEqual([
			[
				{ dynamic: false, text: "a", unclosed: false },
				{ dynamic: true, text: "<<", unclosed: false },
			],
		]);
	});
});

describe("findTitleChecks in PowerShell", () => {
	it.for<[string, string]>([
		["gh pr create --title 'feat: it''s x'", "feat: it's x"],
		['gh pr create --title "feat: say ""hi"" `$5 `""', 'feat: say "hi" $5 "'],
		["gh pr create --title feat:` x", "feat: x"],
		["gh.exe pr create -t 'feat: x'", "feat: x"],
		["& gh pr create -t 'feat: x'", "feat: x"],
		["$env:GH_TOKEN = 'a'; gh pr create -t 'feat: x'", "feat: x"],
		["git push; if ($?) { gh pr create -t 'feat: x' }", "feat: x"],
		["gh pr create -t 'feat: x' `\n  --body b", "feat: x"],
		["C:\\tools\\gh.exe pr edit 2 --title='feat: x'", "feat: x"],
		["gh pr create -t 'a\\b'", "a\\b"],
	])("should read the literal title of %j", ([command, title]) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "powershell")).toStrictEqual([{ title }]);
	});

	it.for([
		'gh pr create --title "feat: $title"',
		'gh pr create --title "feat: $(Get-Date)"',
		"gh pr create --title $title",
		'gh pr create --title "feat: `n"',
		'gh pr create --title @"\nfeat: x\n"@',
		"gh pr create --title @'\nfeat: x\n'@",
		"gh pr create --title (Get-Content t.txt)",
	])("should deny %j", (command) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "powershell")).toStrictEqual(
			denied(/shell expansion|no value/u),
		);
	});

	it.for([
		"gh pr create --title 'feat: x",
		'gh pr create --title "feat: x',
		'gh pr create --title "feat: x`',
		"gh pr create --title @'\nfeat: x",
	])("should deny the unclosed quote in %j", (command) => {
		expect.assertions(1);

		expect(findTitleChecks(command, "powershell")).toStrictEqual(denied(/does not close/u));
	});

	it("should read the title of a $( … ) in a string", () => {
		expect.assertions(1);

		expect(
			findTitleChecks('Write-Output "$(gh pr create -t bad)"', "powershell"),
		).toContainEqual({ title: "bad" });
	});

	it("should not read a quoted gh pr as an invocation", () => {
		expect.assertions(1);

		expect(findTitleChecks("Write-Output 'gh pr create'", "powershell")).toStrictEqual([]);
	});
});
