import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silences a spurious workspace-root warning caused by an unrelated
  // package-lock.json in this machine's home directory, well outside the
  // livepulse repo — not something to leave as an unexplained build warning
  // in a project meant to be read by someone else.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
