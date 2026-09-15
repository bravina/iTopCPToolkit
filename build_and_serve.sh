#!/bin/bash
#
# Build the image and run it on http://localhost:5001.
#
# Works both ways round:   ./build_and_serve.sh   or   . build_and_serve.sh
# Sourcing leaves no `set -e` behind in your shell, and any stray carriage
# return in AB_TAG / TCT_VERSION / TCT_EXAMPLES_REF (a shell that once sourced
# a CRLF version of this script keeps one in the variable) is stripped rather
# than passed on to docker, which would reject the tag.
#
# TopCPToolkit itself is public since its move to
# gitlab.cern.ch/atlas/amg/software, so no CERN token is needed to build.
# Export CERN_TOKEN to also pull in TopCPToolkit_Examples (ATLAS-internal, the
# source of most analysis templates and custom blocks) or to clone a private
# TopCPToolkit fork: it is passed as a build secret, never stored in a layer.

# Defaults, with any CR removed.
AB_TAG="${AB_TAG:-25.2.110}";                 AB_TAG="${AB_TAG//$'\r'/}"
TCT_VERSION="${TCT_VERSION:-v3.7.0}";         TCT_VERSION="${TCT_VERSION//$'\r'/}"
TCT_EXAMPLES_REF="${TCT_EXAMPLES_REF:-main}"; TCT_EXAMPLES_REF="${TCT_EXAMPLES_REF//$'\r'/}"

BUILD_ARGS=(
  --build-arg AB_TAG="${AB_TAG}"
  --build-arg TCT_VERSION="${TCT_VERSION}"
  --build-arg TCT_EXAMPLES_REF="${TCT_EXAMPLES_REF}"
)
if [ -n "${CERN_TOKEN}" ]; then
  BUILD_ARGS+=(--secret id=cern_token,env=CERN_TOKEN)
else
  echo "No CERN_TOKEN set — building without the TopCPToolkit_Examples templates."
fi

echo "Building tct-gui: AnalysisBase ${AB_TAG}, TopCPToolkit ${TCT_VERSION}"
docker build --platform linux/amd64 "${BUILD_ARGS[@]}" -t tct-gui . && \
docker image prune -f && \
{ docker rm -f tct-gui-app >/dev/null 2>&1 || true; } && \
docker run --platform linux/amd64 --name tct-gui-app -p 5001:5000 tct-gui
