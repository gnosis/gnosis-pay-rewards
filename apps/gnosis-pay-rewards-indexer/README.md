# Gnosis Pay Rewards Indexer

Indexes GP transactions that eligible for rewards.

# Environment Variables

| Variable                           | Description                                            | Default     |
| ---------------------------------- | ------------------------------------------------------ | ----------- |
| NODE_ENV                           | The environment the app is running in                  | development |
| IS_DOCKER                          | Whether the app is running in a Docker container       | false       |
| HTTP_SERVER_PORT                   | The port for the HTTP server                           | 3000        |
| HTTP_SERVER_HOST                   | The host for the HTTP server                           | 0.0.0.0     |
| JSON_RPC_PROVIDER_GNOSIS           | The JSON RPC provider for the Gnosis network           | undefined   |
| WEBSOCKET_JSON_RPC_PROVIDER_GNOSIS | The websocket JSON RPC provider for the Gnosis network | undefined   |
| SENTRY_DSN                         | The DSN for Sentry                                     | undefined   |
