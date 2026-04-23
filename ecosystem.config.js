module.exports = {
  apps: [
    {
      name: "nb-dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "dev -H 0.0.0.0 -p 3005",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
