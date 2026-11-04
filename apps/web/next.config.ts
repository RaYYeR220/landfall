import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@landfall/sdk"],
  serverExternalPackages: [],
};
export default config;
