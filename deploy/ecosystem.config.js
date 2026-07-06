/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: "erna",
      cwd: process.env.ERNA_APP_DIR || "/home/erna/erna",
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};