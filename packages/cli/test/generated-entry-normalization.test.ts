import { describe, expect, it } from 'vitest';
import { generateBuiltModuleNormalizationSource } from '../src/lib/generated-entry-normalization.ts';

type NormalizeBuiltModules = (
	agentModules: Record<string, Record<string, unknown>>,
	workflowModules: Record<string, Record<string, unknown>>,
) => {
	manifest: {
		agents: Array<Record<string, unknown>>;
		workflows: Array<Record<string, unknown>>;
	};
};

// The normalization function ships as generated source inside built server
// entries; evaluate it the same way a generated entry does.
const normalizeBuiltModules = new Function(
	`${generateBuiltModuleNormalizationSource()}; return normalizeBuiltModules;`,
)() as NormalizeBuiltModules;

function agentModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { default: { __flueCreatedAgent: true, initialize: () => ({}) }, ...overrides };
}

describe('normalizeBuiltModules()', () => {
	it('collects the module-level description export into the agent manifest entry when present', () => {
		const { manifest } = normalizeBuiltModules(
			{ support: agentModule({ description: 'Resolves customer support tickets.' }) },
			{},
		);

		expect(manifest.agents).toEqual([
			{
				name: 'support',
				description: 'Resolves customer support tickets.',
				transports: {},
				created: true,
			},
		]);
	});

	it('omits description from the agent manifest entry when the module does not export one', () => {
		const { manifest } = normalizeBuiltModules({ support: agentModule() }, {});

		expect(manifest.agents).toEqual([{ name: 'support', transports: {}, created: true }]);
	});

	it('throws when an agent description export is not a string', () => {
		expect(() => normalizeBuiltModules({ support: agentModule({ description: 42 }) }, {})).toThrow(
			'[flue] Agent "support" description export must be a non-empty string.',
		);
	});

	it('throws when an agent description export is an empty string', () => {
		expect(() =>
			normalizeBuiltModules({ support: agentModule({ description: '   ' }) }, {}),
		).toThrow('[flue] Agent "support" description export must be a non-empty string.');
	});
});
