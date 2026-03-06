#!/bin/bash
# deploy.sh — build, push, and deploy iTopCPToolkit to CERN PaaS
#
# Prerequisites:
#   - docker login registry.cern.ch
#   - oc login https://api.paas.okd.cern.ch (via SSO at paas.cern.ch)
#   - export CERN_TOKEN=glpat-xxxxxxxxxxxx   (for TCT build only)
#
# Usage:
#   ./deploy.sh [TCT_VERSION]
#   ./deploy.sh                  # no TCT
#   ./deploy.sh latest           # TCT from main
#   ./deploy.sh v2.24.0          # specific TCT tag

set -e

# ── Configuration ─────────────────────────────────────────────────────────────
# Harbor registry project name (top-level, no username prefix)
REGISTRY_PROJECT="${REGISTRY_PROJECT:-itopcptoolkit}"
AB_TAG="${AB_TAG:-25.2.86}"
TCT_VERSION="${1:-}"

IMAGE="registry.cern.ch/${REGISTRY_PROJECT}/itopcptoolkit:latest"

# ── Build ─────────────────────────────────────────────────────────────────────
echo "Building image: ${IMAGE}"
echo "  AnalysisBase: ${AB_TAG}"
echo "  TCT version:  ${TCT_VERSION:-none}"

BUILD_ARGS="--build-arg AB_TAG=${AB_TAG}"

if [ -n "${TCT_VERSION}" ]; then
    if [ -z "${CERN_TOKEN}" ]; then
        echo "ERROR: TCT_VERSION is set but CERN_TOKEN is not exported." >&2
        exit 1
    fi
    BUILD_ARGS="${BUILD_ARGS} --build-arg TCT_VERSION=${TCT_VERSION}"
    docker build ${BUILD_ARGS} \
        --secret id=cern_token,env=CERN_TOKEN \
        -t "${IMAGE}" .
else
    docker build ${BUILD_ARGS} -t "${IMAGE}" .
fi

# ── Push ──────────────────────────────────────────────────────────────────────
echo "Pushing image to registry.cern.ch..."
docker push "${IMAGE}"

# ── Deploy to OKD ─────────────────────────────────────────────────────────────
echo "Applying OKD manifests..."
# Substitute the image name into the deployment manifest before applying
sed "s|registry.cern.ch/itopcptoolkit/itopcptoolkit:latest|${IMAGE}|g" \
    okd/deployment.yaml | oc apply -f -
oc apply -f okd/service.yaml
oc apply -f okd/route.yaml

# Trigger a rollout so the new image is picked up
oc rollout restart deployment/itopcptoolkit

echo ""
echo "Deployment complete. App URL:"
oc get route itopcptoolkit -o jsonpath='{.spec.host}' && echo ""
