module.exports = {
  apps: [
    {
      name: 'doubao-follow',
      script: 'src/follow-await.mjs',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      restart_delay: 1000,
    },
    {
      name: 'doubao-web',
      script: 'src/web.mjs',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      restart_delay: 2000,
    },
  ],
}