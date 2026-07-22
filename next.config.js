/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.pixa.com" },
      { protocol: "https", hostname: "**.pixelcut.ai" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "**.googleapis.com" },
    ],
  },
};

module.exports = nextConfig;
