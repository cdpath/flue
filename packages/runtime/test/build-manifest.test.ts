import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../../cli/src/lib/build.ts';
import { resolveConfig } from '../../cli/src/lib/config.ts';
import { isSourceStructurePath } from '../../cli/src/lib/dev.ts';
import type { BuildPlugin } from '../../cli/src/lib/types.ts';

const discoveryOnlyPlugin: BuildPlugin = {
	name: 'discovery-only',
	bundle: 'vite',
	generateEntryPoint(ctx) {
		return `export default ${JSON.stringify({
			agents: ctx.agents.map((agent) => agent.name),
			workflows: ctx.workflows.map((workflow) => workflow.name),
		})};\n`;
	},
};

describe('authored source roots', () => {
	it('resolves `.flue/`, `src/`, and project-root source in priority order', async () => {
		const root = createFixtureRoot('flue-source-roots-');
		const rootConfig = await resolveConfig({ cwd: root, inline: { target: 'node' } });
		expect(rootConfig.flueConfig.sourceRoot).toBe(root);

		fs.mkdirSync(path.join(root, 'src'));
		const srcConfig = await resolveConfig({ cwd: root, inline: { target: 'node' } });
		expect(srcConfig.flueConfig.sourceRoot).toBe(path.join(root, 'src'));

		fs.mkdirSync(path.join(root, '.flue'));
		const dotFlueConfig = await resolveConfig({ cwd: root, inline: { target: 'node' } });
		expect(dotFlueConfig.flueConfig.sourceRoot).toBe(path.join(root, '.flue'));
	});

	it('selects source directories only, not similarly named files', async () => {
		const root = createFixtureRoot('flue-source-root-files-');
		fs.writeFileSync(path.join(root, '.flue'), 'not a directory');
		fs.writeFileSync(path.join(root, 'src'), 'not a directory');
		const config = await resolveConfig({ cwd: root, inline: { target: 'node' } });
		expect(config.flueConfig.sourceRoot).toBe(root);
	});

	it('discovers canonical `src/` modules through the Vite output entry', async () => {
		const root = createFixtureRoot('flue-discovery-output-');
		fs.mkdirSync(path.join(root, 'src', 'agents'), { recursive: true });
		fs.mkdirSync(path.join(root, 'src', 'workflows'), { recursive: true });
		fs.mkdirSync(path.join(root, 'agents'));
		fs.mkdirSync(path.join(root, 'workflows'));
		fs.writeFileSync(path.join(root, 'src', 'agents', 'assistant.ts'), `export const arbitrary = true;\n`);
		fs.writeFileSync(path.join(root, 'src', 'workflows', 'job.ts'), `export default 'ordinary module';\n`);
		fs.writeFileSync(path.join(root, 'agents', 'ignored-agent.ts'), `export const arbitrary = true;\n`);
		fs.writeFileSync(path.join(root, 'workflows', 'ignored-job.ts'), `export default 'ordinary module';\n`);

		const { flueConfig } = await resolveConfig({ cwd: root, inline: { target: 'node' } });
		await expect(build({ root, sourceRoot: flueConfig.sourceRoot, plugin: discoveryOnlyPlugin })).resolves.toEqual({ changed: true });
		const output = fs.readFileSync(path.join(root, 'dist', 'server.mjs'), 'utf-8');
		expect(output).toContain('assistant');
		expect(output).toContain('job');
		expect(output).not.toContain('ignored-agent');
		expect(output).not.toContain('ignored-job');
	});

	it('keeps Cloudflare structural discovery scoped to the selected source root', () => {
		const root = '/project';
		expect(isSourceStructurePath(root, '/project/src', 'src/agents/assistant.ts')).toBe(true);
		expect(isSourceStructurePath(root, '/project/src', 'agents/root.ts')).toBe(false);
		expect(isSourceStructurePath(root, '/project/.flue', '.flue/workflows/job.ts')).toBe(true);
		expect(isSourceStructurePath(root, '/project/.flue', 'src/workflows/job.ts')).toBe(false);
		expect(isSourceStructurePath(root, root, 'app.ts')).toBe(true);
	});
});

function createFixtureRoot(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
