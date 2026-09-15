#!/bin/bash
set -e

# TopCPToolkit is public since its move to gitlab.cern.ch/atlas/amg/software,
# so no CERN token is needed.  Export CERN_TOKEN before running this script to
# clone a private fork instead; it is then passed as a build secret and never
# stored in a layer.
AB_TAG=${AB_TAG:-25.2.110}
TCT_VERSION=${TCT_VERSION:-v3.7.0}

SECRET_ARGS=()
if [ -n "${CERN_TOKEN}" ]; then
  SECRET_ARGS=(--secret id=cern_token,env=CERN_TOKEN)
fi

docker build \
  --platform linux/amd64 \
  "${SECRET_ARGS[@]}" \
  --build-arg AB_TAG="${AB_TAG}" \
  --build-arg TCT_VERSION="${TCT_VERSION}" \
  -t tct-gui . && \
docker image prune -f && \
docker rm -f tct-gui-app 2>/dev/null || true && \
docker run --platform linux/amd64 --name tct-gui-app -p 5001:5000 tct-gui
