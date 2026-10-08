#!/bin/sh
# Read-only snapshot of the two named containers; JSON summaries only.
set -u

inspect_one() {
  name="$1"
  if ! timeout 6s docker inspect "$name" >/dev/null 2>&1; then
    printf '{"stage":"container_state","container":"%s","category":"not_found"}\n' "$name"
    return
  fi
  info=$(timeout 6s docker inspect --format \
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.Image}}' \
    "$name" 2>/dev/null) || {
      printf '{"stage":"container_state","container":"%s","category":"inspect_failed"}\n' "$name"
      return
    }
  old_ifs=$IFS; IFS='|'; set -- $info; IFS=$old_ifs
  printf '{"stage":"container_state","container":"%s","status":"%s","health":"%s","restart_count":%s,"oom_killed":%s,"exit_code":%s,"started_at":"%s","image_id":"%s"}\n' \
    "$name" "$1" "$2" "$3" "$4" "$5" "$6" "$7"
}

disk_one() {
  scope="$1"; path="$2"
row=$(timeout 5s df -Pk "$path" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5, $4}')
  if [ -n "$row" ]; then
    set -- $row
    printf '{"stage":"disk","scope":"%s","used_pct":%s,"available_kib":%s}\n' "$scope" "$1" "$2"
  else
    printf '{"stage":"disk","scope":"%s","category":"unavailable"}\n' "$scope"
  fi
}

inspect_one home-media-backend
inspect_one home-media-frontend
disk_one host_root /
cache_path=$(timeout 6s docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/app/data/audio-cache"}}{{.Source}}{{end}}{{end}}' \
  home-media-backend 2>/dev/null || true)
if [ -n "$cache_path" ]; then disk_one audio_cache_mount "$cache_path"; fi

if stats=$(timeout 6s docker stats --no-stream --format \
  '{"stage":"container_stats","container":"{{.Name}}","cpu_pct":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memory_pct":"{{.MemPerc}}","pids":"{{.PIDs}}"}' \
  home-media-backend home-media-frontend 2>/dev/null); then
  printf '%s\n' "$stats"
else
  printf '{"stage":"container_stats","category":"unavailable"}\n'
fi

# Container lifecycle history is restricted to backend and the prior 15 minutes.
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
events=$(timeout 6s docker events --since 15m --until "$now" --filter type=container \
  --filter container=home-media-backend --format '{{.Time}} {{.Action}}' 2>/dev/null || true)
printf '%s\n' "$events" | awk '$2 ~ /^(oom|die|restart|start|stop|kill)$/ {printf "{\"stage\":\"container_event\",\"container\":\"home-media-backend\",\"time_unix\":%s,\"action\":\"%s\"}\n", $1, $2}'

# Probe only non-personal health endpoints from inside the existing backend.
if [ "$(timeout 6s docker inspect --format '{{.State.Running}}' home-media-backend 2>/dev/null || true)" = true ]; then
  if ! timeout 12s docker exec -i home-media-backend node - <<'NODE'
const http = require('node:http');
function probe(stage, url) {
  return new Promise(resolve => {
    const start = Date.now(); let done = false;
    const finish = (category, status = null) => {
      if (done) return; done = true; clearTimeout(deadline);
      console.log(JSON.stringify({stage, status, duration_ms: Date.now() - start, category}));
      resolve();
    };
    let deadline;
    const req = http.get(url, res => {
      res.resume();
      res.on('end', () => finish(res.statusCode === 200 ? 'http_ok' : 'http_error', res.statusCode));
      res.on('error', () => finish('response_error', res.statusCode));
    });
    deadline = setTimeout(() => { finish('deadline_exceeded'); req.destroy(); }, 5000);
    req.on('error', () => finish('request_error'));
  });
}
Promise.all([
  probe('backend_health', 'http://127.0.0.1:3001/health'),
  probe('nginx_to_backend_health', 'http://frontend:80/health'),
]).catch(() => { console.log('{"stage":"health_probe","category":"internal_probe_error"}'); });
NODE
  then
    printf '{"stage":"health_probe","category":"container_exec_failed"}\n'
  fi
else
  printf '{"stage":"health_probe","category":"backend_container_not_running"}\n'
fi

# Classify bounded recent Docker log tails; print counters only, never excerpts.
backend_logs=$(timeout 6s docker logs --since 15m --tail 200 home-media-backend 2>&1 | head -c 65536 || true)
frontend_logs=$(timeout 6s docker logs --since 15m --tail 200 home-media-frontend 2>&1 | head -c 65536 || true)
count() { printf '%s' "$1" | grep -Eic -- "$2" || true; }
printf '{"stage":"backend_log_summary","stream_start":%s,"spawn":%s,"oom_or_killed":%s,"fatal":%s}\n' \
  "$(count "$backend_logs" '\[Stream\] yt-dlp direct stream:')" \
  "$(count "$backend_logs" '\[Stream\] Spawning yt-dlp for:')" \
  "$(count "$backend_logs" 'out of memory|oom-kill|killed process')" \
  "$(count "$backend_logs" 'uncaught exception|fatal error|EADDRINUSE')"
printf '{"stage":"nginx_log_summary","http_502":%s,"upstream_timeout":%s,"upstream_connect_error":%s,"upstream_closed":%s,"no_live_upstreams":%s}\n' \
  "$(count "$frontend_logs" '" 502 [0-9]+')" \
  "$(count "$frontend_logs" 'upstream timed out')" \
  "$(count "$frontend_logs" 'connect\(\) failed')" \
  "$(count "$frontend_logs" 'upstream prematurely closed|upstream reset')" \
  "$(count "$frontend_logs" 'no live upstreams')"

# Production Winston logs are file-only. Read 64 KiB per file inside backend;
# emit allow-listed category counts only, never URLs, IDs, or log messages.
if [ "$(timeout 6s docker inspect --format '{{.State.Running}}' home-media-backend 2>/dev/null || true)" = true ]; then
  timeout 10s docker exec -i home-media-backend node - <<'NODE' || \
    printf '{"stage":"backend_file_log_summary","category":"unavailable"}\n'
const fs = require('node:fs');
const max = 65536;
const patterns = {
  stream_start: /Streaming audio for video: .* via yt-dlp direct/gi,
  yt_dlp_failure: /yt-dlp stream failed/gi,
  http_403: /HTTP Error 403\b|HTTP 403\b/gi,
  http_429: /HTTP Error 429\b|HTTP 429\b/gi,
  http_5xx: /HTTP Error 5\d\d\b|HTTP 5\d\d\b/gi,
  bot_challenge: /sign in to confirm.{0,80}not a bot|captcha/gi,
  timeout: /timed? out|timeout|deadline exceeded/gi,
  dns_tls: /\bENOTFOUND\b|\bEAI_AGAIN\b|\bECONNRESET\b|certificate|\bTLS\b/gi,
  disk_full: /\bENOSPC\b|\bEDQUOT\b|no space left on device/gi,
  disk_io: /\bEIO\b/gi,
  remux_failed: /\[Remux\] Failed|Audio cache finalization failed/gi,
};
for (const name of ['error.log', 'combined.log']) {
  try {
    const file = `/app/logs/${name}`, stat = fs.statSync(file), size = Math.min(stat.size, max);
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(size);
    fs.readSync(fd, bytes, 0, size, stat.size - size); fs.closeSync(fd);
    const text = bytes.toString('utf8');
    const counts = Object.fromEntries(Object.entries(patterns).map(([key, re]) => [key, (text.match(re) || []).length]));
    console.log(JSON.stringify({stage:'backend_file_log_summary',source:name,window:'last_64KiB_time_window_unknown',file_bytes:stat.size,tail_bytes:size,counts}));
  } catch {
    console.log(JSON.stringify({stage:'backend_file_log_summary',source:name,window:'last_64KiB_time_window_unknown',category:'unavailable'}));
  }
}
NODE
else
  printf '{"stage":"backend_file_log_summary","category":"container_not_running"}\n'
fi
