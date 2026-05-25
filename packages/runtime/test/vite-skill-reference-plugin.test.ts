import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild, createServer } from 'vite';
import type { PackagedSkillDirectory } from '../src/types.ts';
import { describe, expect, it, vi } from 'vitest';
import { skillReferencePlugin } from '../../cli/src/lib/vite-skill-reference-plugin.ts';

interface BuiltFixtureModule {
	review: {
		__flueSkillReference: true;
		id: string;
		name: string;
		description: string;
	};
	packaged(): Record<string, PackagedSkillDirectory>;
	marker: string;
}

describe('Vite skill-reference plugin', () => {
	it('keeps Vite build dependencies installable with the published CLI', () => {
		const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../cli/package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		expect(packageJson.dependencies?.vite).toBeDefined();
		expect(packageJson.dependencies?.['@cloudflare/vite-plugin']).toBeDefined();
		expect(packageJson.devDependencies?.vite).toBeUndefined();
		expect(packageJson.devDependencies?.['@cloudflare/vite-plugin']).toBeUndefined();
	});

	it('observes attributed direct imports and packages complete skill directories separately from references', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport const marker = 'direct';\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const plugin = createFixturePlugin(root);
		const built = await buildFixture(root, plugin);
		const module = await importBuiltFixture(built);
		const directory = module.packaged()[module.review.id];
		if (!directory) throw new Error('Packaged skill directory missing');

		expect(module.review).toEqual({
			__flueSkillReference: true,
			id: expect.stringContaining('skill:review:'),
			name: 'review',
			description: 'Reviews an implementation when requested.',
		});
		expect(module.review).not.toHaveProperty('body');
		expect(module.review).not.toHaveProperty('files');
		expect(Object.keys(directory.files)).toEqual([
			'LICENSE.txt',
			'SKILL.md',
			'assets/template.txt',
			'references/checklist.md',
			'scripts/inspect.py',
		]);
		expect(decode(directory.files['LICENSE.txt'])).toBe('License text\n');
	});

	it('handles attributed imports in authored TypeScript modules', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import type { PackagedSkillDirectory } from '@flue/runtime';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport const marker: string = 'typescript';\nexport function packaged(): Record<string, PackagedSkillDirectory> { return getPackagedSkills(); }\n`,
		);
		const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));

		expect(module.review.name).toBe('review');
		expect(module.marker).toBe('typescript');
		expect(module.packaged()[module.review.id]).toBeDefined();
	});

	it('accepts attributed barrel re-exports of skill references', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'src/profile.ts', `export { default as review } from '../skills/review/SKILL.md' with { type: 'skill' };\n`);
		writeModule(
			root,
			'src/entry.ts',
			`import { review } from './profile.ts';\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport const marker = 'barrel';\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));

		expect(module.review.name).toBe('review');
		expect(module.marker).toBe('barrel');
		expect(module.packaged()[module.review.id]).toBeDefined();
	});

	it('packages a skill reached through an ordinary transitive module graph', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/profile.ts',
			`import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`,
		);
		writeModule(root, 'src/helper.ts', `export const marker = 'helper';\n`);
		writeModule(
			root,
			'src/entry.ts',
			`import { review } from './profile.ts';\nimport { marker } from './helper.ts';\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review, marker };\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));

		expect(module.marker).toBe('helper');
		expect(module.review.name).toBe('review');
		expect(Object.values(module.packaged())).toHaveLength(1);
	});

	it('derives stable package identity from project-relative skill paths', async () => {
		const firstRoot = createFixtureRoot();
		const secondRoot = createFixtureRoot();
		for (const root of [firstRoot, secondRoot]) {
			writeSkill(root, 'review');
			writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);
		}
		const first = await importBuiltFixture(await buildFixture(firstRoot, createFixturePlugin(firstRoot)));
		const second = await importBuiltFixture(await buildFixture(secondRoot, createFixturePlugin(secondRoot)));

		expect(first.review.id).toBe(second.review.id);
	});

	it('isolates same-named packages at distinct project-relative paths', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'one/review', 'review');
		writeSkill(root, 'two/review', 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import review from '../skills/one/review/SKILL.md' with { type: 'skill' };\nimport other from '../skills/two/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport const marker = other.id;\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));

		expect(module.review.id).not.toBe(module.marker);
		expect(Object.keys(module.packaged())).toEqual(expect.arrayContaining([module.review.id, module.marker]));
	});

	it('rejects unmarked SKILL.md imports without silently changing syntax', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'src/allowed.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);
		writeModule(root, 'src/entry.ts', `import { review } from './allowed.ts';\nimport unmarked from '../skills/review/SKILL.md';\nexport { review, unmarked };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('must use an import attribute');
	});

	it.each(['raw', 'url', 'flue-skill', 'unexpected'])('rejects queried SKILL.md imports with ?%s', async (query) => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md?${query}';\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('must use an import attribute');
	});

	it('rejects directly spelled internal module IDs', async () => {
		const root = createFixtureRoot();
		writeModule(root, 'src/entry.ts', `import review from '__x00__flue-skill:/tmp/review/SKILL.md';\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('Internal packaged-skill module IDs cannot be imported directly');
	});

	it('rejects packaged-store imports from authored modules outside bootstrap', async () => {
		const root = createFixtureRoot();
		writeModule(root, 'src/user.ts', `import { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport const contents = getPackagedSkills();\n`);
		writeModule(root, 'src/entry.ts', `import { contents } from './user.ts';\nexport { contents };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('runtime-owned');
	});

	it('rejects dynamic skill imports with an actionable diagnostic', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'src/entry.ts', `export const load = () => import('../skills/review/SKILL.md', { with: { type: 'skill' } });\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('Dynamic SKILL.md import');
	});

	it('excludes generated files while packaging permitted hidden files', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'skills/review/.notes', 'Included hidden note\n');
		writeModule(root, 'skills/review/node_modules/ignored/index.js', 'ignored\n');
		writeModule(root, 'skills/review/dist/ignored.txt', 'ignored\n');
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport function packaged() { return getPackagedSkills(); }\n`);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));
			const files = Object.keys(module.packaged()[module.review.id]?.files ?? {});
			expect(files).toContain('.notes');
			expect(files).not.toContain('node_modules/ignored/index.js');
			expect(files).not.toContain('dist/ignored.txt');
			expect(warning).toHaveBeenCalledWith(expect.stringContaining('deployed application package'));
		} finally {
			warning.mockRestore();
		}
	});

	it.each(['.env', '.dev.vars.local', '.npmrc', '.netrc', 'credentials.json', 'private.pem', 'api.key', 'secrets.local'])('rejects sensitive packaged file %s', async (filename) => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, `skills/review/${filename}`, 'do-not-package\n');
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('contains sensitive file');
	});

	it.each(['.aws/credentials', '.ssh/id_ed25519'])('rejects sensitive packaged directory content %s', async (filename) => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, `skills/review/${filename}`, 'do-not-package\n');
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('contains sensitive directory');
	});

	it('rejects symlinks inside imported skill directories', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'outside.txt', 'Do not package.\n');
		fs.symlinkSync(path.join(root, 'outside.txt'), path.join(root, 'skills/review/linked.txt'));
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('contains symbolic link');
	});

	it('rejects imported skill paths outside the application root', async () => {
		const root = createFixtureRoot();
		const outsideRoot = createFixtureRoot();
		writeSkill(outsideRoot, 'review');
		writeModule(root, 'src/entry.ts', `import review from ${JSON.stringify(path.join(outsideRoot, 'skills/review/SKILL.md'))} with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('must be inside project root');
	});

	it('rejects skill imports that traverse symlinked directories', async () => {
		const root = createFixtureRoot();
		const outsideRoot = createFixtureRoot();
		writeSkill(outsideRoot, 'review');
		fs.symlinkSync(path.join(outsideRoot, 'skills'), path.join(root, 'linked-skills'), 'dir');
		writeModule(root, 'src/entry.ts', `import review from '../linked-skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('traverses symbolic link');
	});

	it('warns when packaging a large file into the deployed application', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(root, 'skills/review/assets/large.bin', 'x'.repeat(1024 * 1024 + 1));
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			await buildFixture(root, createFixturePlugin(root));
			expect(warning).toHaveBeenCalledWith(expect.stringContaining('packaged into the deployed application'));
		} finally {
			warning.mockRestore();
		}
	});

	it('records binary packaged files independently of directory location', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		const binary = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x41]);
		fs.writeFileSync(path.join(root, 'skills/review/payload.bin'), binary);
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport function packaged() { return getPackagedSkills(); }\n`);

		const module = await importBuiltFixture(await buildFixture(root, createFixturePlugin(root)));
		const packaged = module.packaged()[module.review.id]?.files['payload.bin'];
		if (!packaged) throw new Error('Packaged binary missing');
		expect(packaged.kind).toBe('binary');
		expect(module.packaged()[module.review.id]?.files['LICENSE.txt']?.kind).toBe('text');
		expect(Buffer.from(packaged.content, 'base64')).toEqual(binary);
	});

	it('reuses strict Agent Skills validation during Vite loading', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review', 'wrong-name');
		writeModule(root, 'src/entry.ts', `import review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport { review };\n`);

		await expect(buildFixture(root, createFixturePlugin(root))).rejects.toThrow('requires it to match directory "review"');
	});

	it('loads attributed skill imports through the Vite development module pipeline', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const server = await createServer({
			configFile: false,
			root,
			logLevel: 'silent',
			plugins: [createFixturePlugin(root)],
			server: { middlewareMode: true },
		});
		try {
			const module = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const directory = module.packaged()[module.review.id];
			if (!directory) throw new Error('Packaged skill directory missing');
			expect(module.review.name).toBe('review');
			expect(decode(directory.files['LICENSE.txt'])).toBe('License text\n');
		} finally {
			await server.close();
		}
	});

	it('removes packaged skills when development modules stop importing them', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const server = await createServer({
			configFile: false,
			root,
			logLevel: 'silent',
			plugins: [createFixturePlugin(root)],
			server: { middlewareMode: true },
		});
		try {
			const initial = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			expect(Object.keys(initial.packaged())).toEqual([initial.review.id]);

			writeModule(
				root,
				'src/entry.ts',
				`import { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport const review = { id: 'removed' };\nexport function packaged() { return getPackagedSkills(); }\n`,
			);
			server.watcher.emit('change', fs.realpathSync.native(path.join(root, 'src/entry.ts')));
			await flushWatcher();

			const reloaded = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			expect(Object.keys(reloaded.packaged())).toEqual([]);
		} finally {
			await server.close();
		}
	});

	it('invalidates changed skill metadata and complete packaged directories in Vite development', async () => {
		const root = createFixtureRoot();
		writeSkill(root, 'review');
		writeModule(
			root,
			'src/entry.ts',
			`import review from '../skills/review/SKILL.md' with { type: 'skill' };\nimport { getPackagedSkills } from 'virtual:flue/packaged-skills';\nexport { review };\nexport function packaged() { return getPackagedSkills(); }\n`,
		);
		const server = await createServer({
			configFile: false,
			root,
			logLevel: 'silent',
			plugins: [createFixturePlugin(root)],
			server: { middlewareMode: true },
		});
		try {
			const initial = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const initialDirectory = initial.packaged()[initial.review.id];
			if (!initialDirectory) throw new Error('Packaged skill directory missing');
			expect(decode(initialDirectory.files['LICENSE.txt'])).toBe('License text\n');

			const licensePath = path.join(root, 'skills/review/LICENSE.txt');
			fs.writeFileSync(licensePath, 'Updated license\n');
			server.watcher.emit('change', licensePath);
			await flushWatcher();
			const changedFile = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const changedFileDirectory = changedFile.packaged()[changedFile.review.id];
			if (!changedFileDirectory) throw new Error('Reloaded packaged skill directory missing');
			expect(decode(changedFileDirectory.files['LICENSE.txt'])).toBe('Updated license\n');

			const skillPath = path.join(root, 'skills/review/SKILL.md');
			fs.writeFileSync(skillPath, `---\nname: review\ndescription: Updated review instructions.\nlicense: LICENSE.txt\n---\nUse the updated checklist.\n`);
			server.watcher.emit('change', skillPath);
			await flushWatcher();
			const changedSkill = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const changedSkillDirectory = changedSkill.packaged()[changedSkill.review.id];
			if (!changedSkillDirectory) throw new Error('Changed skill directory missing');
			expect(changedSkill.review.description).toBe('Updated review instructions.');
			expect(decode(changedSkillDirectory.files['SKILL.md'])).toContain('Use the updated checklist.');

			const noticePath = path.join(root, 'skills/review/NOTICE.txt');
			fs.writeFileSync(noticePath, 'Notice text\n');
			server.watcher.emit('add', noticePath);
			await flushWatcher();
			const added = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const addedDirectory = added.packaged()[added.review.id];
			if (!addedDirectory) throw new Error('Added-file skill directory missing');
			expect(decode(addedDirectory.files['NOTICE.txt'])).toBe('Notice text\n');

			fs.rmSync(noticePath);
			server.watcher.emit('unlink', noticePath);
			await flushWatcher();
			const removed = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const removedDirectory = removed.packaged()[removed.review.id];
			if (!removedDirectory) throw new Error('Removed-file skill directory missing');
			expect(removedDirectory.files['NOTICE.txt']).toBeUndefined();

			const nestedPath = path.join(root, 'skills/review/extra/deep/note.txt');
			writeModule(root, 'skills/review/extra/deep/note.txt', 'Nested note\n');
			server.watcher.emit('add', nestedPath);
			await flushWatcher();
			const nestedAdded = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const nestedAddedDirectory = nestedAdded.packaged()[nestedAdded.review.id];
			if (!nestedAddedDirectory) throw new Error('Nested-added skill directory missing');
			expect(decode(nestedAddedDirectory.files['extra/deep/note.txt'])).toBe('Nested note\n');

			fs.rmSync(path.join(root, 'skills/review/extra'), { recursive: true });
			server.watcher.emit('unlink', nestedPath);
			await flushWatcher();
			const nestedRemoved = (await server.ssrLoadModule('/src/entry.ts')) as BuiltFixtureModule;
			const nestedRemovedDirectory = nestedRemoved.packaged()[nestedRemoved.review.id];
			if (!nestedRemovedDirectory) throw new Error('Nested-removed skill directory missing');
			expect(nestedRemovedDirectory.files['extra/deep/note.txt']).toBeUndefined();
		} finally {
			await server.close();
		}
	});
});

function createFixtureRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'flue-vite-skill-reference-'));
}

function writeSkill(root: string, directoryName: string, declaredName = directoryName): void {
	writeModule(
		root,
		`skills/${directoryName}/SKILL.md`,
		`---\nname: ${declaredName}\ndescription: Reviews an implementation when requested.\nlicense: LICENSE.txt\n---\nFollow the checklist.\n`,
	);
	writeModule(root, `skills/${directoryName}/references/checklist.md`, 'Review every changed file.\n');
	writeModule(root, `skills/${directoryName}/scripts/inspect.py`, 'print("inspect")\n');
	writeModule(root, `skills/${directoryName}/assets/template.txt`, 'Template\n');
	writeModule(root, `skills/${directoryName}/LICENSE.txt`, 'License text\n');
}

function writeModule(root: string, relativePath: string, content: string): void {
	const absolutePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content);
}

function createFixturePlugin(root: string) {
	return skillReferencePlugin({ root, bootstrapEntries: [path.join(root, 'src/entry.ts')] });
}

async function flushWatcher(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

async function buildFixture(root: string, plugin: ReturnType<typeof skillReferencePlugin>): Promise<string> {
	const outDir = path.join(root, 'dist');
	await viteBuild({
		configFile: false,
		logLevel: 'silent',
		plugins: [plugin],
		build: {
			outDir,
			emptyOutDir: true,
			minify: false,
			lib: {
				entry: path.join(root, 'src/entry.ts'),
				formats: ['es'],
				fileName: () => 'entry.mjs',
			},
		},
	});
	return path.join(outDir, 'entry.mjs');
}

async function importBuiltFixture(absolutePath: string): Promise<BuiltFixtureModule> {
	return (await import(`${pathToFileURL(absolutePath).href}?time=${Date.now()}`)) as BuiltFixtureModule;
}

function decode(file: { encoding: 'base64'; content: string } | undefined): string {
	if (!file) throw new Error('Packaged file missing');
	return Buffer.from(file.content, file.encoding).toString('utf8');
}
