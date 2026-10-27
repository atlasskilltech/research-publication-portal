// PM2 process configuration for the Research Publication Portal (Next.js).
//
// This app is a Next.js server, NOT a plain Node script, so PM2 must launch
// the Next binary — never the project directory. Pointing PM2 at the folder
// (e.g. `pm2 start research-publication-portal`) throws MODULE_NOT_FOUND
// because there is no index.js / "main" entry to require().
//
// Deploy:
//   npm ci
//   npm run build                     # builds .next/ — required before start
//   pm2 start ecosystem.config.js
//   pm2 save
//
// The port (5630) matches the `start` script in package.json.

module.exports = {
  apps: [
    {
      name: 'research-publication-portal',
      // Run the Next.js binary directly so PM2 tracks the real process
      // (and forwards signals for graceful reloads) instead of an npm wrapper.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 5630',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '5630',
      },
    },
  ],
};
