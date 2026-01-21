module.exports = {
  apps: [
    {
      name: 'visolux',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      time: true,
      max_memory_restart: '512M',
    },
  ],
};
