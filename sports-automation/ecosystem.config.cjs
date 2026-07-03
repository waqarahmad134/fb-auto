module.exports = {
  apps: [{
    name: "sports-automation",
    script: "src/index.js",
    autorestart: true,
    max_memory_restart: "600M",
    env: { NODE_ENV: "production" },
    out_file: "logs/pm2-out.log",
    error_file: "logs/pm2-err.log",
    time: true
  }]
};
