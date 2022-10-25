const withBundleAnalyzer = require('@next/bundle-analyzer')({
	enabled: process.env.ANALYZE === 'true',
});
const {withIgnext} = require('../../../dist/plugin.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	experimental: {
		runtime: 'experimental-edge',
	},
};

module.exports = withBundleAnalyzer(withIgnext(nextConfig));
