#!/bin/sh
# Refresh plugins/ai/LiteRTLM from an upstream LiteRT-LM tag. Usage: scripts/vendor-litertlm.sh v0.17.1
# Needs only git + curl + swift (no git-lfs): LFS files are never checked out, only swift/ and LICENSE.
set -eu
TAG="${1:?usage: vendor-litertlm.sh <tag, e.g. v0.17.1>}"
HERE=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST="$HERE/LiteRTLM"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 --no-checkout --branch "$TAG" https://github.com/google-ai-edge/LiteRT-LM.git "$WORK/src"
(cd "$WORK/src" && git -c filter.lfs.smudge=cat -c filter.lfs.process= -c filter.lfs.required=false checkout HEAD -- swift LICENSE)
COMMIT=$(git -C "$WORK/src" rev-parse HEAD)

rm -rf "$DEST/Sources/LiteRTLM"
mkdir -p "$DEST/Sources/LiteRTLM"
for f in "$WORK/src"/swift/*.swift; do
    case "$(basename "$f")" in *Tests.swift) ;; *) cp "$f" "$DEST/Sources/LiteRTLM/" ;; esac
done
cp "$WORK/src/LICENSE" "$DEST/LICENSE"

URL="https://github.com/google-ai-edge/LiteRT-LM/releases/download/$TAG/CLiteRTLM.xcframework.zip"
curl -sSL -o "$WORK/CLiteRTLM.zip" "$URL"
SUM=$(swift package compute-checksum "$WORK/CLiteRTLM.zip")

sed -i.bak -E "s#releases/download/[^/]+/CLiteRTLM#releases/download/$TAG/CLiteRTLM#; s#checksum: \"[0-9a-f]+\"#checksum: \"$SUM\"#" "$DEST/Package.swift"
sed -i.bak -E "s#tag \`v[0-9.]+\`#tag \`$TAG\`#; s#commit \`[0-9a-f]+\`#commit \`$COMMIT\`#" "$DEST/VENDORED.md"
rm -f "$DEST"/*.bak
echo "Vendored $TAG ($COMMIT), xcframework checksum $SUM"
