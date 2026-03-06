#!/bin/bash

docker build --build-arg AB_TAG=25.2.86 -t tct-gui . && \
docker rm -f tct-gui-app 2>/dev/null; \
docker run --name tct-gui-app -p 5001:5000 tct-gui
