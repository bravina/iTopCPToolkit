#!/bin/bash

# docker build --build-arg AB_TAG=25.2.88 -t tct-gui . && \
# docker rm -f tct-gui-app 2>/dev/null; \
# docker run --name tct-gui-app -p 5001:5000 tct-gui

# or : docker build   --secret id=cern_token,env=CERN_TOKEN   --build-arg AB_TAG=25.2.88 --build-arg TCT_VERSION=v2.24.0  -t tct-gui .

docker build \
  --platform linux/amd64 \
  --secret id=cern_token,env=CERN_TOKEN \
  --build-arg AB_TAG=25.2.88 \
  --build-arg TCT_VERSION=v2.24.0 \
  -t tct-gui . && \
docker image prune -f && \
docker rm -f tct-gui-app 2>/dev/null || true && \
docker run --platform linux/amd64 --name tct-gui-app -p 5001:5000 tct-gui
