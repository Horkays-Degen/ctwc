const fs = require('fs');
const content = `/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
      { protocol: "https", hostname: "unavatar.io" },
    ],
  },
};
module.exports = nextConfig;`;
fs.writeFileSync('./next.config.js', content);
console.log('next.config.js updated!');
