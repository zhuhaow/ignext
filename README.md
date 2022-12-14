# ignext

Ignite your Next.js website for Cloudflare.

ignext aims to run Next.js website on Cloudflare Pages. 

Read this first, [Want Next.js at the edge? Just use Vercel](https://zhuhaow.me/want-nextjs-at-edge-just-use-vercel/). I explained why ignext is not ideal and compared all solutions I could find on the market.

**Currectly in alpha state. Do not use it in production.**

## Development progress

- [x] Serve static assets
- [x] Serve statically generated pages
- [x] Serve dynamic pages
- [ ] Cache
- [ ] Middleware
- [x] Basepath and locales
- [x] Headers, rewrites and redirects
- [ ] Images
- [ ] Fonts
- [ ] Wasm

## Try Ignext

Add `ignext@alpha` to your project

E.g.,
```
pnpm add ignext@alpha
```

Then update your `next.config.js` with runtime config and wrap the config with `withIgnext`.

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    runtime: "experimental-edge",
  }
}

module.exports = require("ignext/dist/plugin").withIgnext(nextConfig);
```

After `pnpm next build`, run `pnpm ignext export`. You'll find the website ready for Cloudflare Pages under `.ignext/`.

Make sure you set Cloudflare Pages Functions compatible flag to `transformstream_enable_standard_constructor, streams_enable_constructors`.

A running example is available at https://ignext-demo.pages.dev, where a mid-size page ([template](https://tailwindui.com/components/marketing/page-examples/landing-pages#component-6b663161ec9333a3e026306b01ae45f8)) is rendered by a free Pages account.

