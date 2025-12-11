module.exports = {
  apps: [
    {
      name: 'gpr-indexer-v1',
      script: 'src/start-all.ts',
      ignore_watch: ['node_modules', 'dist', 'logs', 'data'],
      kill_timeout: 10000,
      instances: 1,
      interpreter: 'deno',
      interpreterArgs: 'run -A',
    },
  ],
  deploy: {
    production: {},
  },
};
