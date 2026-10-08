#!/usr/bin/env bash
# Read-only snapshot of the two named containers; JSON summaries only.
set -uo pipefail

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
# This is the exact bind mount destination in docker-compose.yml.
cache_row=$(timeout 6s docker exec home-media-backend sh -c 'df -Pk /app/data/audio-cache' 2>/dev/null | \
  awk 'NR==2 {gsub(/%/, "", $5); print $5, $4}')
if [ -n "$cache_row" ]; then
  set -- $cache_row
  printf '{"stage":"disk","scope":"audio_cache_volume","used_pct":%s,"available_kib":%s}\n' "$1" "$2"
else
  printf '{"stage":"disk","scope":"audio_cache_volume","category":"unavailable"}\n'
fi

if stats=$(timeout 6s docker stats --no-stream --format \
  '{"stage":"container_stats","container":"{{.Name}}","cpu_pct":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memory_pct":"{{.MemPerc}}","pids":"{{.PIDs}}"}' \
  home-media-backend home-media-frontend 2>/dev/null); then
  printf '%s\n' "$stats"
else
  printf '{"stage":"container_stats","category":"unavailable"}\n'
fi

# Exact UTC window for the reported failure. No unbounded host inventory.
incident_start=2026-10-08T09:30:00Z
incident_end=2026-10-08T09:36:00Z
for name in home-media-backend home-media-frontend; do
  event_rc=0
  events=$(timeout 8s docker events --since "$incident_start" --until "$incident_end" \
    --filter type=container --filter "container=$name" --format '{{.Time}} {{.Action}}' 2>&1 | tail -c 16384) || event_rc=$?
  if [ "$event_rc" -ne 0 ]; then events=''; fi
  event_count=$(printf '%s\n' "$events" | awk '$2 ~ /^(oom|die|restart|start|stop|kill)$/ {n++} END {print n+0}')
  case "$event_rc" in
    124) event_status=timeout;;
    0) event_status=empty; [ "$event_count" -gt 0 ] && event_status=records_found;;
    *) event_status=command_error;;
  esac
  printf '{"stage":"historical_event_summary","container":"%s","window_utc":"%s/%s","capture_status":"%s","sampled_event_count":%s,"sample_bytes_max":16384,"sample_limit":20}\n' \
    "$name" "$incident_start" "$incident_end" "$event_status" "$event_count"
  printf '%s\n' "$events" | awk -v name="$name" '$2 ~ /^(oom|die|restart|start|stop|kill)$/ {printf "{\"stage\":\"historical_event\",\"container\":\"%s\",\"time_unix\":%s,\"action\":\"%s\"}\n", name, $1, $2}' | tail -n 20
done

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

# Classify bounded Docker log slices for the exact incident window. Counters
# only; raw messages, IDs, paths, URLs, headers, and user text never leave host.
backend_logs_rc=0
backend_logs=$(timeout 8s docker logs --timestamps --since "$incident_start" --until "$incident_end" \
  --tail 200 home-media-backend 2>&1 | tail -c 65536) || backend_logs_rc=$?
frontend_logs_rc=0
frontend_logs=$(timeout 8s docker logs --timestamps --since "$incident_start" --until "$incident_end" \
  --tail 200 home-media-frontend 2>&1 | tail -c 65536) || frontend_logs_rc=$?
if [ "$backend_logs_rc" -ne 0 ]; then backend_logs=''; fi
if [ "$frontend_logs_rc" -ne 0 ]; then frontend_logs=''; fi
count() { printf '%s' "$1" | grep -Eic -- "$2" || true; }
backend_log_bytes=$(printf '%s' "$backend_logs" | wc -c | tr -d ' ')
frontend_log_bytes=$(printf '%s' "$frontend_logs" | wc -c | tr -d ' ')
backend_log_capped=false; [ "$backend_log_bytes" -lt 65536 ] || backend_log_capped=true
frontend_log_capped=false; [ "$frontend_log_bytes" -lt 65536 ] || frontend_log_capped=true
case "$backend_logs_rc" in 0) backend_log_status=empty; [ "$backend_log_bytes" -gt 0 ] && backend_log_status=captured;; 124) backend_log_status=timeout;; *) backend_log_status=command_error;; esac
case "$frontend_logs_rc" in 0) frontend_log_status=empty; [ "$frontend_log_bytes" -gt 0 ] && frontend_log_status=captured;; 124) frontend_log_status=timeout;; *) frontend_log_status=command_error;; esac
printf '{"stage":"historical_backend_log_summary","window_utc":"%s/%s","capture_status":"%s","bytes_captured":%s,"byte_cap_reached":%s,"tail_bytes_max":65536,"tail_lines_max":200,"stream_start":%s,"spawn":%s,"oom_or_killed":%s,"fatal":%s}\n' \
  "$incident_start" "$incident_end" "$backend_log_status" "$backend_log_bytes" "$backend_log_capped" \
  "$(count "$backend_logs" '\[Stream\] yt-dlp direct stream:')" \
  "$(count "$backend_logs" '\[Stream\] Spawning yt-dlp for:')" \
  "$(count "$backend_logs" 'out of memory|oom-kill|killed process')" \
  "$(count "$backend_logs" 'uncaught exception|fatal error|EADDRINUSE')"
printf '{"stage":"historical_nginx_log_summary","window_utc":"%s/%s","capture_status":"%s","bytes_captured":%s,"byte_cap_reached":%s,"tail_bytes_max":65536,"tail_lines_max":200,"http_502":%s,"upstream_timeout":%s,"upstream_connect_error":%s,"upstream_closed":%s,"no_live_upstreams":%s}\n' \
  "$incident_start" "$incident_end" "$frontend_log_status" "$frontend_log_bytes" "$frontend_log_capped" \
  "$(count "$frontend_logs" '" 502 [0-9]+')" \
  "$(count "$frontend_logs" 'upstream timed out')" \
  "$(count "$frontend_logs" 'connect\(\) failed')" \
  "$(count "$frontend_logs" 'upstream prematurely closed|upstream reset')" \
  "$(count "$frontend_logs" 'no live upstreams')"

# Production Winston logs are file-only. logger.ts formats local timestamps as
# YYYY-MM-DD HH:mm:ss; docker-compose.yml sets TZ=Asia/Taipei (fixed UTC+08:00).
# Read at most 64 KiB per file and count only entries in the exact UTC window.
if [ "$(timeout 6s docker inspect --format '{{.State.Running}}' home-media-backend 2>/dev/null || true)" = true ]; then
  timeout 10s docker exec -i home-media-backend node - <<'NODE' || \
    printf '{"stage":"backend_file_log_summary","category":"unavailable"}\n'
const fs = require('node:fs');
const max = 65536;
const windowStart = Date.parse('2026-10-08T09:30:00Z');
const windowEnd = Date.parse('2026-10-08T09:36:00Z');
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
function timestampMs(raw) {
  if (typeof raw !== 'string') return NaN;
  const taipei = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (taipei) return Date.parse(`${taipei[1]}-${taipei[2]}-${taipei[3]}T${taipei[4]}:${taipei[5]}:${taipei[6]}+08:00`);
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return Date.parse(raw);
  return NaN;
}
for (const name of ['error.log', 'combined.log']) {
  try {
    const file = `/app/logs/${name}`, stat = fs.statSync(file), size = Math.min(stat.size, max);
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(size);
    fs.readSync(fd, bytes, 0, size, stat.size - size); fs.closeSync(fd);
    const targetLines = [], timestamps = [];
    let unparsedLines = 0;
    for (const line of bytes.toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const ms = timestampMs(entry.timestamp);
        if (!Number.isFinite(ms)) { unparsedLines++; continue; }
        timestamps.push(ms);
        if (ms >= windowStart && ms < windowEnd) targetLines.push(line);
      } catch { unparsedLines++; }
    }
    const sampleMin = timestamps.length ? Math.min(...timestamps) : null;
    const sampleMax = timestamps.length ? Math.max(...timestamps) : null;
    const counts = Object.fromEntries(Object.entries(patterns).map(([key, re]) =>
      [key, (targetLines.join('\n').match(re) || []).length]));
    console.log(JSON.stringify({stage:'backend_file_log_summary',source:name,
      window_utc:'2026-10-08T09:30:00Z/2026-10-08T09:36:00Z',
      file_bytes:stat.size,tail_bytes:size,unparsed_tail_lines:unparsedLines,
      sample_first_utc:sampleMin === null ? null : new Date(sampleMin).toISOString(),
      sample_last_utc:sampleMax === null ? null : new Date(sampleMax).toISOString(),
      sample_spans_window:sampleMin !== null && sampleMin <= windowStart && sampleMax >= windowEnd,
      target_records:targetLines.length,counts}));
  } catch {
    console.log(JSON.stringify({stage:'backend_file_log_summary',source:name,
      window_utc:'2026-10-08T09:30:00Z/2026-10-08T09:36:00Z',category:'unavailable'}));
  }
}
NODE
else
  printf '{"stage":"backend_file_log_summary","category":"container_not_running"}\n'
fi
