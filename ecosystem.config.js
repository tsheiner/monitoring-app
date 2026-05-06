const path = require('path');

module.exports = {
  apps: [
    {
      name: 'monitoring-backend',
      cwd: '/opt/monitoring-app/backend',
      script: 'uv',
      args: 'run python main.py',
      interpreter: 'none',
      env: {
        UV_CACHE_DIR: '/opt/monitoring-app/.uv-cache',
        SKIP_BOOTSTRAP: 'true',
        NETWORK_PROFILE: 'enterprise',
        HTTP_PORT: '5030',
        WS_PORT: '5031',
      },
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'monitoring-frontend',
      cwd: '/opt/monitoring-app/frontend',
      script: 'node_modules/.bin/vite',
      interpreter: '/usr/local/node20/bin/node',
      env: {
        VITE_PORT: '5032',
        VITE_HTTP_PORT: '5030',
        VITE_WS_PORT: '5031',
      },
      max_memory_restart: '200M',
    },
  ]
};
