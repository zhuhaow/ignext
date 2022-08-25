const importsWithSideEffect = {allow: ['isomorphic-fetch']};

module.exports = {
	rules: {
		'unicorn/prefer-module': 'off',
		'import/extensions': 'off',
		'n/prefer-global/process': ['error', 'always'],
		'import/no-unassigned-import': ['error', importsWithSideEffect],
	},
	ignores: ['test/**/next-env.d.ts'],
	prettier: true,
};
