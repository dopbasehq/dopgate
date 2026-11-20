#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/release/common.sh
source "$(dirname "$0")/common.sh"
version=${1:?Usage: prepare-image.sh VERSION DIRECTORY CONTEXT}
directory=${2:?Missing directory}
context=${3:?Missing context directory}
require_version "$version"
directory=$(cd "$directory" && pwd)
[[ -s "$directory/checksums.txt" ]] || release_error "Missing checksums.txt in $directory"
mkdir -p "$context"
context=$(cd "$context" && pwd)
for arch in amd64 arm64; do
  archive="dopgate_${version}_linux_${arch}.tar.gz"
  # Check this archive against the manifest; an archive missing from it fails too.
  awk -v name="$archive" '$2 == name' "$directory/checksums.txt" \
    | (cd "$directory" && sha256sum --check --strict) || release_error "Checksum failed for $archive"
  mkdir -p "$context/linux/$arch"
  tar -xzf "$directory/$archive" -C "$context/linux/$arch" dopgate
  [[ -x "$context/linux/$arch/dopgate" ]] || release_error "Extracted binary is not executable: $archive"
done
cp "$(dirname "$0")/image.Dockerfile" "$context/Dockerfile"
printf 'Prepared image context %s\n' "$context"
