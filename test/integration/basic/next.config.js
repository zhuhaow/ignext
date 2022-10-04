const {withIgnext} = require('../../../dist/index.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	swcMinify: true,
	experimental: {
		runtime: 'experimental-edge',
	},
};

module.exports = withIgnext(nextConfig);
