module.exports = {
	rules: {
		'unicorn/prefer-module': 'off',
		'import/extensions': 'off',
		'n/prefer-global/process': ['error', 'always'],
	},
	ignores: [
		'test/**/next-env.d.ts',
	],
};
