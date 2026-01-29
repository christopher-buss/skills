import * as prompts from "@clack/prompts";

import { execSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { manual, submodules, vendors } from "../meta.ts";

// eslint-disable-next-line flawless/naming-convention, unused-imports/no-unused-vars -- convention
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface Project {
	name: string;
	path: string;
	type: "source" | "vendor";
	url: string;
}

interface VendorConfig {
	/** SourceSkillName -> outputSkillName. */
	skills: Record<string, string>;
	source: string;
}

async function checkUpdates() {
	const spinner = prompts.spinner();
	spinner.start("Fetching remote changes...");

	try {
		exec("git submodule foreach git fetch");
		spinner.stop("Fetched remote changes");
	} catch (err) {
		spinner.stop(`Failed to fetch: ${err}`);
		return;
	}

	const updates: Array<{ behind: number; name: string; type: string }> = [];

	// Check sources
	for (const name of Object.keys(submodules)) {
		const path = join(ROOT, "sources", name);
		if (!existsSync(path)) {
			continue;
		}

		const behind = execSafe("git rev-list HEAD..@{u} --count", path);
		const count = behind !== null ? Number.parseInt(behind) : 0;
		if (count > 0) {
			updates.push({ name, behind: count, type: "source" });
		}
	}

	// Check vendors
	for (const [name, config] of Object.entries(vendors)) {
		const vendorConfig = config as VendorConfig;
		const path = join(ROOT, "vendor", name);
		if (!existsSync(path)) {
			continue;
		}

		const behind = execSafe("git rev-list HEAD..@{u} --count", path);
		const count = behind !== null ? Number.parseInt(behind) : 0;
		if (count > 0) {
			const skillNames = Object.values(vendorConfig.skills).join(", ");
			updates.push({ name: `${name} (${skillNames})`, behind: count, type: "vendor" });
		}
	}

	if (updates.length === 0) {
		prompts.log.success("All submodules are up to date");
	} else {
		prompts.log.info("Updates available:");
		for (const update of updates) {
			prompts.log.message(
				`  ${update.name} (${update.type}): ${update.behind} commits behind`,
			);
		}
	}
}

async function cleanup(skipPrompt = false) {
	const spinner = prompts.spinner();
	let hasChanges = false;

	// 1. Find and remove extra submodules
	const allProjects: Array<Project> = [
		...Object.entries(submodules).map(([name, url]) => {
			return { name, path: `sources/${name}`, type: "source" as const, url };
		}),
		...Object.entries(vendors).map(([name, config]) => {
			return {
				name,
				path: `vendor/${name}`,
				type: "vendor" as const,
				url: (config as VendorConfig).source,
			};
		}),
	];

	const existingSubmodulePaths = getExistingSubmodulePaths();
	const expectedSubmodulePaths = new Set(allProjects.map((project) => project.path));
	const extraSubmodules = existingSubmodulePaths.filter(
		(path) => !expectedSubmodulePaths.has(path),
	);

	if (extraSubmodules.length > 0) {
		prompts.log.warn(`Found ${extraSubmodules.length} submodule(s) not in meta.ts:`);
		for (const path of extraSubmodules) {
			prompts.log.message(`  - ${path}`);
		}

		const shouldRemove = skipPrompt
			? true
			: await prompts.confirm({
					initialValue: true,
					message: "Remove these extra submodules?",
				});

		if (prompts.isCancel(shouldRemove)) {
			prompts.cancel("Cancelled");
			return;
		}

		if (shouldRemove) {
			hasChanges = true;
			for (const submodulePath of extraSubmodules) {
				spinner.start(`Removing submodule: ${submodulePath}`);
				try {
					removeSubmodule(submodulePath);
					spinner.stop(`Removed: ${submodulePath}`);
				} catch (err) {
					spinner.stop(`Failed to remove ${submodulePath}: ${err}`);
				}
			}
		}
	}

	// 2. Find and remove extra skills
	const existingSkills = getExistingSkillNames();
	const expectedSkills = getExpectedSkillNames();
	const extraSkills = existingSkills.filter((name) => !expectedSkills.has(name));

	if (extraSkills.length > 0) {
		prompts.log.warn(`Found ${extraSkills.length} skill(s) not in meta.ts:`);
		for (const name of extraSkills) {
			prompts.log.message(`  - skills/${name}`);
		}

		const shouldRemove = skipPrompt
			? true
			: await prompts.confirm({
					initialValue: true,
					message: "Remove these extra skills?",
				});

		if (prompts.isCancel(shouldRemove)) {
			prompts.cancel("Cancelled");
			return;
		}

		if (shouldRemove) {
			hasChanges = true;
			for (const skillName of extraSkills) {
				spinner.start(`Removing skill: ${skillName}`);
				try {
					rmSync(join(ROOT, "skills", skillName), { recursive: true });
					spinner.stop(`Removed: skills/${skillName}`);
				} catch (err) {
					spinner.stop(`Failed to remove skills/${skillName}: ${err}`);
				}
			}
		}
	}

	if (!hasChanges && extraSubmodules.length === 0 && extraSkills.length === 0) {
		prompts.log.success("Everything is clean, no unused submodules or skills found");
	} else if (hasChanges) {
		prompts.log.success("Cleanup completed");
	}
}

function copyFilesFromSourceSkill(sourceSkillPath: string, outputPath: string) {
	const files = readdirSync(sourceSkillPath, {
		recursive: true,
		withFileTypes: true,
	});
	for (const file of files) {
		if (!file.isFile()) {
			continue;
		}

		const fullPath = join(file.parentPath, file.name);
		const relativePath = fullPath.replace(sourceSkillPath, "");
		const destinationPath = join(outputPath, relativePath);

		// Ensure destination directory exists
		const destinationDirectory = dirname(destinationPath);

		if (!existsSync(destinationDirectory)) {
			mkdirSync(destinationDirectory, { recursive: true });
		}

		cpSync(fullPath, destinationPath);
	}
}

function exec(cmd: string, cwd = ROOT): string {
	return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function execSafe(cmd: string, cwd = ROOT): null | string {
	try {
		return exec(cmd, cwd);
	} catch {
		return null;
	}
}

function getExistingSkillNames(): Array<string> {
	const skillsDirectory = join(ROOT, "skills");
	if (!existsSync(skillsDirectory)) {
		return [];
	}

	return readdirSync(skillsDirectory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

function getExistingSubmodulePaths(): Array<string> {
	const gitmodules = join(ROOT, ".gitmodules");
	if (!existsSync(gitmodules)) {
		return [];
	}

	const content = readFileSync(gitmodules, "utf-8");
	const matches = content.matchAll(/path\s*=\s*(.+)/g);
	return Array.from(matches, (match) => match[1]?.trim() ?? "");
}

function getExpectedSkillNames(): Set<string> {
	const expected = new Set<string>();

	// Skills from submodules (generated skills use same name as submodule key)
	for (const name of Object.keys(submodules)) {
		expected.add(name);
	}

	// Skills from vendors (use the output skill name)
	for (const config of Object.values(vendors)) {
		const vendorConfig = config as VendorConfig;
		for (const outputName of Object.values(vendorConfig.skills)) {
			expected.add(outputName);
		}
	}

	// Manual skills
	for (const name of manual) {
		expected.add(name);
	}

	return expected;
}

function getGitSha(repositoryPath: string): null | string {
	return execSafe("git rev-parse HEAD", repositoryPath);
}

async function initSubmodules(skipPrompt = false) {
	const allProjects: Array<Project> = [
		...Object.entries(submodules).map(([name, url]) => {
			return { name, path: `sources/${name}`, type: "source" as const, url };
		}),
		...Object.entries(vendors).map(([name, config]) => {
			return {
				name,
				path: `vendor/${name}`,
				type: "vendor" as const,
				url: (config as VendorConfig).source,
			};
		}),
	];

	const spinner = prompts.spinner();

	// Check for extra submodules that are not in meta.ts
	const existingSubmodulePaths = getExistingSubmodulePaths();
	const expectedPaths = new Set(allProjects.map((project) => project.path));
	const extraSubmodules = existingSubmodulePaths.filter((path) => !expectedPaths.has(path));

	if (extraSubmodules.length > 0) {
		prompts.log.warn(`Found ${extraSubmodules.length} submodule(s) not in meta.ts:`);
		for (const path of extraSubmodules) {
			prompts.log.message(`  - ${path}`);
		}

		const shouldRemove = skipPrompt
			? true
			: await prompts.confirm({
					initialValue: true,
					message: "Remove these extra submodules?",
				});

		if (prompts.isCancel(shouldRemove)) {
			prompts.cancel("Cancelled");
			return;
		}

		if (shouldRemove) {
			for (const submodulePath of extraSubmodules) {
				spinner.start(`Removing submodule: ${submodulePath}`);
				try {
					removeSubmodule(submodulePath);
					spinner.stop(`Removed: ${submodulePath}`);
				} catch (err) {
					spinner.stop(`Failed to remove ${submodulePath}: ${err}`);
				}
			}
		}
	}

	const existingProjects = allProjects.filter((project) => submoduleExists(project.path));
	const untrackedProjects = allProjects.filter((project) => !submoduleExists(project.path));

	if (untrackedProjects.length === 0) {
		prompts.log.info("All submodules already initialized");
		return;
	}

	const selected = skipPrompt
		? untrackedProjects
		: await prompts.multiselect({
				initialValues: untrackedProjects,
				message: "Select projects to initialize",
				options: untrackedProjects.map((project) => {
					return {
						hint: project.url,
						label: `${project.name} (${project.type})`,
						value: project,
					};
				}),
			});

	if (prompts.isCancel(selected)) {
		prompts.cancel("Cancelled");
		return;
	}

	for (const project of selected) {
		spinner.start(`Adding submodule: ${project.name}`);

		// Ensure parent directory exists
		const parentDirectory = join(ROOT, dirname(project.path));
		if (!existsSync(parentDirectory)) {
			mkdirSync(parentDirectory, { recursive: true });
		}

		try {
			exec(`git submodule add ${project.url} ${project.path}`);
			spinner.stop(`Added: ${project.name}`);
		} catch (err) {
			spinner.stop(`Failed to add ${project.name}: ${err}`);
		}
	}

	prompts.log.success("Submodules initialized");

	if (existingProjects.length > 0) {
		prompts.log.info(
			`Already initialized: ${existingProjects.map((project) => project.name).join(", ")}`,
		);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const shouldSkipPrompt = args.includes("-y") || args.includes("--yes");
	const command = args.find((argument) => !argument.startsWith("-"));

	// Handle subcommands directly
	if (command === "init") {
		prompts.intro("Skills Manager - Init");
		await initSubmodules(shouldSkipPrompt);
		prompts.outro("Done");
		return;
	}

	if (command === "sync") {
		prompts.intro("Skills Manager - Sync");
		await syncSubmodules();
		prompts.outro("Done");
		return;
	}

	if (command === "check") {
		prompts.intro("Skills Manager - Check");
		await checkUpdates();
		prompts.outro("Done");
		return;
	}

	if (command === "cleanup") {
		prompts.intro("Skills Manager - Cleanup");
		await cleanup(shouldSkipPrompt);
		prompts.outro("Done");
		return;
	}

	// No subcommand: show interactive menu (requires interaction)
	if (shouldSkipPrompt) {
		prompts.log.error("Command required when using -y flag");
		prompts.log.info("Available commands: init, sync, check, cleanup");
		process.exit(1);
	}

	prompts.intro("Skills Manager");

	const action = await prompts.select({
		message: "What would you like to do?",
		options: [
			{ hint: "Pull latest and sync Type 2 skills", label: "Sync submodules", value: "sync" },
			{ hint: "Add new submodules", label: "Init submodules", value: "init" },
			{ hint: "See available updates", label: "Check updates", value: "check" },
			{ hint: "Remove unused submodules and skills", label: "Cleanup", value: "cleanup" },
		],
	});

	if (prompts.isCancel(action)) {
		prompts.cancel("Cancelled");
		process.exit(0);
	}

	switch (action) {
		case "check": {
			await checkUpdates();
			break;
		}
		case "cleanup": {
			await cleanup();
			break;
		}
		case "init": {
			await initSubmodules();
			break;
		}
		case "sync": {
			await syncSubmodules();
			break;
		}
	}

	prompts.outro("Done");
}

function removeSubmodule(submodulePath: string): void {
	// De-initialize the submodule
	// cspell:ignore deinit
	execSafe(`git submodule deinit -f ${submodulePath}`);
	// Remove from .git/modules
	const gitModulesPath = join(ROOT, ".git", "modules", submodulePath);
	if (existsSync(gitModulesPath)) {
		rmSync(gitModulesPath, { recursive: true });
	}

	// Remove from working tree and .gitmodules
	exec(`git rm -f ${submodulePath}`);
}

function submoduleExists(path: string): boolean {
	const gitmodules = join(ROOT, ".gitmodules");
	if (!existsSync(gitmodules)) {
		return false;
	}

	const content = readFileSync(gitmodules, "utf-8");
	return content.includes(`path = ${path}`);
}

async function syncSubmodules() {
	const spinner = prompts.spinner();

	// Update all submodules
	spinner.start("Updating submodules...");
	try {
		exec("git submodule update --remote --merge");
		spinner.stop("Submodules updated");
	} catch (err) {
		spinner.stop(`Failed to update submodules: ${err}`);
		return;
	}

	// Sync Type 2 skills
	for (const [vendorName, config] of Object.entries(vendors)) {
		const vendorConfig = config as VendorConfig;
		const vendorPath = join(ROOT, "vendor", vendorName);
		const vendorSkillsPath = join(vendorPath, "skills");
		const vendorSkillFile = join(vendorPath, "SKILL.md");

		if (!existsSync(vendorPath)) {
			prompts.log.warn(`Vendor submodule not found: ${vendorName}. Run init first.`);
			continue;
		}

		const hasSkillsDirectory = existsSync(vendorSkillsPath);
		const hasSkillFile = existsSync(vendorSkillFile);

		if (!hasSkillsDirectory && !hasSkillFile) {
			prompts.log.warn(`No skills directory or SKILL.md in vendor/${vendorName}/`);
			continue;
		}

		// Sync each specified skill
		for (const [sourceSkillName, outputSkillName] of Object.entries(vendorConfig.skills)) {
			const sourceSkillPath = join(vendorSkillsPath, sourceSkillName);
			const outputPath = join(ROOT, "skills", outputSkillName);

			// Check if source exists (either as dir in skills/ or as root
			// SKILL.md)
			const isSourceDirectory = hasSkillsDirectory && existsSync(sourceSkillPath);
			const isSourceRootFile = !isSourceDirectory && hasSkillFile && sourceSkillName === ".";

			if (!isSourceDirectory && !isSourceRootFile) {
				prompts.log.warn(`Skill not found: vendor/${vendorName}/skills/${sourceSkillName}`);
				continue;
			}

			spinner.start(`Syncing skill: ${sourceSkillName} → ${outputSkillName}`);

			// Remove existing output directory to ensure clean sync
			if (existsSync(outputPath)) {
				rmSync(outputPath, { recursive: true });
			}

			mkdirSync(outputPath, { recursive: true });

			if (isSourceRootFile) {
				// Copy single SKILL.md from vendor root
				cpSync(vendorSkillFile, join(outputPath, "SKILL.md"));
			} else {
				// Copy all files from source skill directory
				copyFilesFromSourceSkill(sourceSkillPath, outputPath);
			}

			// Copy LICENSE file from vendor repo root if it exists
			const licenseNames = [
				"LICENSE",
				"LICENSE.md",
				"LICENSE.txt",
				"license",
				"license.md",
				"license.txt",
			];
			for (const licenseName of licenseNames) {
				const licensePath = join(vendorPath, licenseName);
				if (existsSync(licensePath)) {
					cpSync(licensePath, join(outputPath, "LICENSE.md"));
					break;
				}
			}

			// Update SYNC.md (instead of GENERATION.md for vendored skills)
			const sha = getGitSha(vendorPath);
			const syncPath = join(outputPath, "SYNC.md");
			const date = new Date().toISOString().split("T")[0];
			const sourcePath = isSourceRootFile
				? `vendor/${vendorName}/SKILL.md`
				: `vendor/${vendorName}/skills/${sourceSkillName}`;

			const syncContent = `# Sync Info

- **Source:** \`${sourcePath}\`
- **Git SHA:** \`${sha}\`
- **Synced:** ${date}
`;

			writeFileSync(syncPath, syncContent);

			spinner.stop(`Synced: ${sourceSkillName} → ${outputSkillName}`);
		}
	}

	prompts.log.success("All skills synced");
}

main().catch(console.error);
