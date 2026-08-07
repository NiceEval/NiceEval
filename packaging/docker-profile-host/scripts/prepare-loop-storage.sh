#!/usr/bin/env bash
# Prepare or adopt a loop-backed ext4 image for a docker profile data root.
# Idempotent. Refuses to reformat an existing image of unexpected size unless
# FORCE_RECREATE=1. Does not mount; a separate mount unit / fileSystems entry
# attaches the image.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-loop-storage.sh --image PATH --size BYTES|--size-human 30G [--mount PATH]

Creates a sparse loop image and mkfs.ext4 when missing. When --mount is given,
also ensures the mountpoint directory exists (0755 root:root).
EOF
}

IMAGE=""
SIZE_BYTES=""
MOUNT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE=$2; shift 2 ;;
    --size) SIZE_BYTES=$2; shift 2 ;;
    --size-human)
      # shellcheck disable=SC2001
      human=$2
      # Accept N[KMG] binary units
      if [[ "$human" =~ ^([0-9]+)([KkMmGgTt])i?[Bb]?$ ]]; then
        n="${BASH_REMATCH[1]}"
        u=$(echo "${BASH_REMATCH[2]}" | tr '[:upper:]' '[:lower:]')
        case "$u" in
          k) SIZE_BYTES=$((n * 1024)) ;;
          m) SIZE_BYTES=$((n * 1024 * 1024)) ;;
          g) SIZE_BYTES=$((n * 1024 * 1024 * 1024)) ;;
          t) SIZE_BYTES=$((n * 1024 * 1024 * 1024 * 1024)) ;;
        esac
      else
        echo "invalid --size-human: $human" >&2
        exit 2
      fi
      shift 2
      ;;
    --mount) MOUNT=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$IMAGE" || -z "$SIZE_BYTES" ]]; then
  usage
  exit 2
fi

if [[ -n "$MOUNT" ]]; then
  mkdir -p "$MOUNT"
  chmod 0755 "$MOUNT"
fi

mkdir -p "$(dirname "$IMAGE")"

if [[ -e "$IMAGE" ]]; then
  current=$(stat -c '%s' "$IMAGE" 2>/dev/null || stat -f '%z' "$IMAGE")
  if [[ "$current" -eq "$SIZE_BYTES" ]]; then
    echo "loop image exists with expected size: $IMAGE ($SIZE_BYTES bytes)"
    # Ensure filesystem is present; blkid failure means we still need mkfs.
    if blkid "$IMAGE" >/dev/null 2>&1; then
      exit 0
    fi
    echo "image has no filesystem; formatting ext4"
  else
    if [[ "${FORCE_RECREATE:-0}" != "1" ]]; then
      echo "refusing to recreate $IMAGE: size $current != expected $SIZE_BYTES (set FORCE_RECREATE=1)" >&2
      exit 1
    fi
    rm -f "$IMAGE"
  fi
fi

if [[ ! -e "$IMAGE" ]]; then
  echo "creating sparse loop image $IMAGE ($SIZE_BYTES bytes)"
  truncate -s "$SIZE_BYTES" "$IMAGE"
fi

if ! blkid "$IMAGE" >/dev/null 2>&1; then
  mkfs.ext4 -F -L "ne-dp-data" "$IMAGE"
  echo "formatted ext4 on $IMAGE"
fi

chmod 0600 "$IMAGE"
echo "ready $IMAGE"
