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
      merge_logs: true,
      out_file: 'storage/logs/pm2-out.log',
      error_file: 'storage/logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '512M',
    },
  ],
};
