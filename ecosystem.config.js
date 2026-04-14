/**
 * PM2 ECOSYSTEM CONFIG
 * ============================================================
 * PM2 keeps your app running 24/7:
 *  - Auto-restarts if it crashes
 *  - Restarts on server reboot
 *  - Logs errors to files
 *  - Cluster mode uses all CPU cores
 *
 * Install PM2:  npm install -g pm2
 * Start:        pm2 start ecosystem.config.js
 * Save:         pm2 save
 * Auto-start:   pm2 startup   (then run the command it shows)
 * ============================================================
 */

module.exports = {
  apps: [{
    name:         'anton-craftex',
    script:       'server.js',
    instances:    1,              // Single instance by default (server.js handles opt-in clustering)
    exec_mode:    'fork',         // Keep PM2 simple and predictable
    autorestart:  true,           // Auto-restart on crash
    watch:        false,          // Don't restart on file changes (production)
    max_memory_restart: '500M',   // Restart if memory exceeds 500MB

    env: {
      NODE_ENV: 'development',
      PORT:     3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT:     3000
    },

    // Log files
    error_file: './logs/error.log',
    out_file:   './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }]
};
