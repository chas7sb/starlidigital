#!/bin/sh
set -eu
installer_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$installer_dir/starli.mjs" "$@"
