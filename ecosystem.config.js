module.exports = {
  apps: [
    {
      name: "monitoring-backend",
      cwd: "./backend",
      script: "main.py",
      interpreter: "python",
      env: {
        SKIP_BOOTSTRAP: "true",
        NETWORK_PROFILE: "enterprise",
      },
      max_memory_restart: "500M",
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: "monitoring-frontend",
      cwd: "./frontend",
      script: "node_modules/.bin/vite",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "200M",
    },
  ],
};
