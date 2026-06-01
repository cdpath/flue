import * as path from 'node:path';

export const CONFIG_BASENAMES = Object.freeze([
	'flue.config.ts',
	'flue.config.mts',
	'flue.config.mjs',
	'flue.config.js',
	'flue.config.cjs',
	'flue.config.cts',
]);

export function resolveConfigCandidates(opts: {
	cwd: string;
	searchFrom: string;
	configFile: string | undefined;
}): string[] {
	if (opts.configFile !== undefined) return [path.resolve(opts.cwd, opts.configFile)];
	return CONFIG_BASENAMES.map((basename) => path.join(opts.searchFrom, basename));
}
