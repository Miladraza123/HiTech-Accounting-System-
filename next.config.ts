import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server actions default to a 1MB request body. Branding images (Logo, Signature, Stamp)
    // may be up to 2MB (checked in actions/companyBranding.ts), plus multipart overhead.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
