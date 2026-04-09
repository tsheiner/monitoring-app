module.exports = {
  apps: [
    {
      name: "monitoring-backend",
      cwd: "./backend",
      script: "main.py",
      interpreter: "./backend/.venv/bin/python",
      env: {
        SKIP_BOOTSTRAP: "true",
        NETWORK_PROFILE: "enterprise",
        HTTP_PORT: "5030",
        WS_PORT: "5031",
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
        VITE_PORT: "5032",
        VITE_HTTP_PORT: "5030",
        VITE_WS_PORT: "5031",
      },
      max_memory_restart: "200M",
    },
  ],
};
