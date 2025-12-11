#!/bin/bash
set -e

MONGO_HOST="${MONGO_HOST:-mongodb}"
MONGO_PORT="${MONGO_PORT:-27017}"

echo "Waiting for MongoDB to be ready..."
until mongosh --host ${MONGO_HOST}:${MONGO_PORT} --eval "db.adminCommand('ping')" --quiet > /dev/null 2>&1; do
  echo "MongoDB is not ready yet. Waiting..."
  sleep 2
done

echo "Initializing replica set..."
# Use localhost:27017 as the member host so connections from the host machine work
# If running inside Docker network, this can be overridden via REPLICA_SET_HOST env var
REPLICA_SET_HOST="${REPLICA_SET_HOST:-localhost:27017}"
mongosh --host ${MONGO_HOST}:${MONGO_PORT} --eval "
  try {
    rs.status()
    print('Replica set already initialized')
  } catch (err) {
    if (err.message.includes('no replset config')) {
      rs.initiate({
        _id: 'rs0',
        members: [{ _id: 0, host: '${REPLICA_SET_HOST}' }]
      })
      print('Replica set initialized successfully with host: ${REPLICA_SET_HOST}')
    } else {
      throw err
    }
  }
" --quiet

echo "Replica set initialization complete!"

