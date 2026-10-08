#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1:-}
manifest=${2:-}
container_name=home-media-backend
container_cache=/app/data/video-cache
host_cache=./data/video-cache
max_cache_bytes=$((5000 * 1024 * 1024))
stage_dir=

fail() {
  printf 'video_cache_%s: status=failed\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$stage_dir" && -d "$stage_dir" ]]; then
    rm -rf -- "$stage_dir"
  fi
  exit "$status"
}
trap cleanup EXIT

is_cache_name() {
  [[ "$1" =~ ^[A-Za-z0-9_-]+\.mp4$ ]]
}

cache_stats_and_manifest() {
  local cache_dir=$1
  local output_manifest=$2
  local list_file=$3
  local name size count=0 bytes=0

  if find "$cache_dir" -maxdepth 1 -type l -name '*.mp4' -print -quit 2>/dev/null | grep -q .; then
    return 1
  fi
  if ! (cd "$cache_dir" && find . -maxdepth 1 -type f -name '*.mp4' -size +0c -print0 2>/dev/null | LC_ALL=C sort -z) > "$list_file"; then
    return 1
  fi
  : > "$output_manifest"
  while IFS= read -r -d '' name; do
    name=${name#./}
    # yt-dlp's temporary output is never a completed cache entry.
    [[ "$name" == *.tmp.mp4 ]] && continue
    is_cache_name "$name" || return 1
    size=$(stat -c '%s' -- "$cache_dir/$name" 2>/dev/null) || return 1
    [[ "$size" =~ ^[0-9]+$ && "$size" -gt 0 ]] || return 1
    count=$((count + 1))
    bytes=$((bytes + size))
    (cd "$cache_dir" && sha256sum -- "$name" 2>/dev/null) >> "$output_manifest" || return 1
  done < "$list_file"

  printf '%s %s\n' "$count" "$bytes"
}

print_summary() {
  printf 'video_cache_%s: count=%s total_bytes=%s same_content=%s\n' "$1" "$2" "$3" "$4"
}

case "$mode" in
  prepare)
    [[ -n "$manifest" ]] || fail prepare
    mkdir -p -- "$host_cache" || fail prepare
    [[ -d "$host_cache" && ! -L "$host_cache" ]] || fail prepare
    host_cache=$(cd "$host_cache" && pwd -P) || fail prepare
    docker info >/dev/null 2>&1 || fail prepare

    stage_dir=$(mktemp -d "$host_cache/.video-cache-migration.XXXXXX") || fail prepare
    # Cleanup owns only this freshly allocated path; a hard-killed run may leave it behind.
    host_list="$stage_dir/host.list"
    source_list="$stage_dir/source.list"
    source_manifest="$stage_dir/source.manifest"

    if docker container inspect "$container_name" >/dev/null 2>&1; then
      running=$(docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null) || fail prepare
      [[ "$running" == true ]] || fail prepare
      actual_cwd=$(docker exec "$container_name" node -e 'process.stdout.write(require("fs").realpathSync("/proc/1/cwd"))' 2>/dev/null) || fail prepare
      [[ "$actual_cwd" == /app ]] || fail prepare
      container_cache="$actual_cwd/data/video-cache"
      mount_record=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data/video-cache"}}{{.Type}}|{{.Source}}{{end}}{{end}}' "$container_name" 2>/dev/null) || fail prepare

      cache_path_state=$(docker exec "$container_name" node -e 'const fs=require("fs"),p=process.argv[1];let s;try{s=fs.lstatSync(p)}catch(e){if(e.code==="ENOENT"){process.stdout.write("missing");process.exit(0)}process.exit(1)}if(s.isSymbolicLink()){process.stdout.write("symlink");process.exit(0)}if(!s.isDirectory()){process.stdout.write("other");process.exit(0)}if(fs.readdirSync(p,{withFileTypes:true}).some(e=>e.isSymbolicLink()&&e.name.endsWith(".mp4"))){process.stdout.write("linked-file");process.exit(0)}process.stdout.write("directory")' "$container_cache" 2>/dev/null) || fail prepare
      case "$cache_path_state" in
        directory) ;;
        missing)
          cache_path_state=missing
          ;;
        *)
          fail prepare
          ;;
      esac

      if [[ "$cache_path_state" == directory ]]; then
        if [[ "$mount_record" != "bind|$host_cache" ]]; then
          if ! docker exec "$container_name" find "$container_cache" -maxdepth 1 -type f -name '*.mp4' -size +0c -print0 > "$source_list" 2>/dev/null; then
            fail prepare
          fi
          host_stats=$(cache_stats_and_manifest "$host_cache" "$manifest" "$host_list") || fail prepare
          read -r host_count host_bytes <<< "$host_stats"
          [[ "$host_bytes" -le "$max_cache_bytes" ]] || fail prepare
          planned_bytes=$host_bytes
          copy_bytes=0
          : > "$source_manifest"
          while IFS= read -r -d '' source_file; do
            name=${source_file##*/}
            [[ "$name" == *.tmp.mp4 ]] && continue
            is_cache_name "$name" || fail prepare
            source_size=$(docker exec "$container_name" stat -c '%s' -- "$source_file" 2>/dev/null) || fail prepare
            [[ "$source_size" =~ ^[0-9]+$ && "$source_size" -gt 0 ]] || fail prepare
            source_digest=$(docker exec "$container_name" sha256sum -- "$source_file" 2>/dev/null) || fail prepare
            source_digest=${source_digest%% *}
            destination="$host_cache/$name"
            if [[ -e "$destination" || -L "$destination" ]]; then
              [[ -f "$destination" && ! -L "$destination" ]] || fail prepare
              destination_size=$(stat -c '%s' -- "$destination" 2>/dev/null) || fail prepare
              destination_digest=$(sha256sum -- "$destination" 2>/dev/null) || fail prepare
              destination_digest=${destination_digest%% *}
              [[ "$destination_size" == "$source_size" && "$destination_digest" == "$source_digest" ]] || fail prepare
            else
              planned_bytes=$((planned_bytes + source_size))
              [[ "$planned_bytes" -le "$max_cache_bytes" ]] || fail prepare
              copy_bytes=$((copy_bytes + source_size))
            fi
            printf '%s  %s\n' "$source_digest" "$name" >> "$source_manifest"
          done < "$source_list"

          available_kb=$(df -Pk -- "$host_cache" 2>/dev/null | awk 'NR == 2 {print $4}') || fail prepare
          [[ "$available_kb" =~ ^[0-9]+$ ]] || fail prepare
          [[ $((available_kb * 1024)) -ge "$copy_bytes" ]] || fail prepare

          while read -r digest name; do
            [[ -n "${name:-}" ]] || continue
            destination="$host_cache/$name"
            if [[ -e "$destination" || -L "$destination" ]]; then
              [[ -f "$destination" && ! -L "$destination" ]] || fail prepare
              destination_size=$(stat -c '%s' -- "$destination" 2>/dev/null) || fail prepare
              destination_digest=$(sha256sum -- "$destination" 2>/dev/null) || fail prepare
              destination_digest=${destination_digest%% *}
              [[ "$destination_digest" == "$digest" ]] && continue
              fail prepare
            fi
            source_file="$container_cache/$name"
            staged_file="$stage_dir/$name"
            docker cp "$container_name:$source_file" "$staged_file" >/dev/null 2>&1 || fail prepare
            [[ -f "$staged_file" && ! -L "$staged_file" ]] || fail prepare
            staged_size=$(stat -c '%s' -- "$staged_file" 2>/dev/null) || fail prepare
            staged_digest=$(sha256sum -- "$staged_file" 2>/dev/null) || fail prepare
            staged_digest=${staged_digest%% *}
            source_size=$(docker exec "$container_name" stat -c '%s' -- "$source_file" 2>/dev/null) || fail prepare
            [[ "$source_size" == "$staged_size" && "$digest" == "$staged_digest" ]] || fail prepare
            if ln -- "$staged_file" "$destination" 2>/dev/null; then
              rm -- "$staged_file"
            elif [[ -f "$destination" && ! -L "$destination" ]] && cmp -s -- "$staged_file" "$destination"; then
              :
            else
              fail prepare
            fi
          done < "$source_manifest"
        fi
      fi

      if [[ -f "$source_manifest" ]]; then
        while read -r digest name; do
          [[ -n "${name:-}" ]] || continue
          destination="$host_cache/$name"
          [[ -f "$destination" && ! -L "$destination" ]] || fail prepare
          current_digest=$(sha256sum -- "$destination" 2>/dev/null) || fail prepare
          current_digest=${current_digest%% *}
          [[ "$current_digest" == "$digest" ]] || fail prepare
        done < "$source_manifest"
      fi

      host_stats=$(cache_stats_and_manifest "$host_cache" "$manifest" "$host_list") || fail prepare
      read -r host_count host_bytes <<< "$host_stats"
      [[ "$host_bytes" -le "$max_cache_bytes" ]] || fail prepare
      same_content=true
      if [[ -s "$source_manifest" ]]; then
        while read -r digest name; do
          [[ -n "${name:-}" ]] || continue
          current_digest=$(sha256sum -- "$host_cache/$name" 2>/dev/null) || fail prepare
          current_digest=${current_digest%% *}
          [[ "$current_digest" == "$digest" ]] || same_content=false
        done < "$source_manifest"
      fi
      [[ "$same_content" == true ]] || fail prepare
      print_summary prepare "$host_count" "$host_bytes" "$same_content"
    else
      host_stats=$(cache_stats_and_manifest "$host_cache" "$manifest" "$host_list") || fail prepare
      read -r host_count host_bytes <<< "$host_stats"
      [[ "$host_bytes" -le "$max_cache_bytes" ]] || fail prepare
      print_summary prepare "$host_count" "$host_bytes" true
    fi
    ;;

  verify)
    [[ -n "$manifest" && -f "$manifest" ]] || fail verify
    docker info >/dev/null 2>&1 || fail verify
    docker container inspect "$container_name" >/dev/null 2>&1 || fail verify
    running=$(docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null) || fail verify
    [[ "$running" == true ]] || fail verify
    actual_cwd=$(docker exec "$container_name" node -e 'process.stdout.write(require("fs").realpathSync("/proc/1/cwd"))' 2>/dev/null) || fail verify
    [[ "$actual_cwd" == /app ]] || fail verify
    host_cache=$(cd "$host_cache" && pwd -P) || fail verify
    mount_record=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data/video-cache"}}{{.Type}}|{{.Source}}{{end}}{{end}}' "$container_name" 2>/dev/null) || fail verify
    [[ "$mount_record" == "bind|$host_cache" ]] || fail verify
    same_content=true
    while read -r expected_digest name; do
      [[ -n "${name:-}" ]] || continue
      if current_digest=$(docker exec "$container_name" sha256sum -- "$container_cache/$name" 2>/dev/null); then
        current_digest=${current_digest%% *}
        [[ "$current_digest" == "$expected_digest" ]] || same_content=false
      else
        same_content=false
      fi
    done < "$manifest"
    final_stats=$(docker exec "$container_name" node -e 'const fs=require("fs"),p="/app/data/video-cache";let n=0,b=0;for(const e of fs.readdirSync(p,{withFileTypes:true})){if(!e.name.endsWith(".mp4")||e.name.endsWith(".tmp.mp4"))continue;if(e.isSymbolicLink()||!e.isFile()||!/^[A-Za-z0-9_-]+\.mp4$/.test(e.name))process.exit(2);const s=fs.statSync(p+"/"+e.name);if(s.size>0){n++;b+=s.size}}process.stdout.write(`${n} ${b}`)' 2>/dev/null) || fail verify
    read -r final_count final_bytes <<< "$final_stats"
    [[ "$final_bytes" =~ ^[0-9]+$ && "$final_bytes" -le "$max_cache_bytes" ]] || fail verify
    print_summary verify "$final_count" "$final_bytes" "$same_content"
    [[ "$same_content" == true ]] || fail verify
    ;;

  *)
    fail usage
    ;;
esac
