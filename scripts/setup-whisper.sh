#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=927cfce34f31707e17f2bff35c349632fb9e2c3a
source_dir=.local/whisper-source
if [[ ! -d "$source_dir/.git" ]]; then
  git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git "$source_dir"
fi
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$revision" ]] || { echo 'Unexpected whisper.cpp revision' >&2; exit 1; }
cmake -S "$source_dir" -B .local/whisper -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DBUILD_SHARED_LIBS=OFF -DGGML_METAL_EMBED_LIBRARY=ON
cmake --build .local/whisper --target whisper-cli --parallel 4
cp "$source_dir/LICENSE" .local/whisper/LICENSE
printf 'Built whisper.cpp %s\n' "$revision"
