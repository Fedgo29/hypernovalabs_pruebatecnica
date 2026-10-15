#!/bin/sh
# Conserva TLS e integridad npm. Adapta la CA y DNS del proxy de esta nube.
set -eu
cd "$(dirname "$0")/.."
export DOCKER_CONFIG=/tmp/hypernova-docker-config
mkdir -p "$DOCKER_CONFIG"
if [ -n "${HTTPS_PROXY:-}" ] && [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
  HYPERNOVA_PROXY_HOST=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlparse(os.environ["HTTPS_PROXY"]).hostname)')
  HYPERNOVA_PROXY_IP=$(python3 -c 'import os,socket,urllib.parse;print(socket.gethostbyname(urllib.parse.urlparse(os.environ["HTTPS_PROXY"]).hostname))')
  export HYPERNOVA_PROXY_HOST HYPERNOVA_PROXY_IP
  exec docker compose -f docker-compose.yml -f infra/docker/compose.cloud.yml "$@"
fi
exec docker compose "$@"
