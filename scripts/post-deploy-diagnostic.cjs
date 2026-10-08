'use strict';
// Only sanitized JSON goes to stdout. Do not import the application or its logger.
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const BASE = 'http://127.0.0.1:3001'; // Same container-local target as existing health check.
function report(stage, result, category) {
  console.log(JSON.stringify({stage, status: result?.status || null,
    duration_ms: result?.duration_ms ?? null, bytes: result?.bytes ?? 0, category}));
}
function get(path, {limit = 262144, timeout = 10000} = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    let settled = false, response, bytes = 0, chunks = [];
    const finish = category => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const body = Buffer.concat(chunks);
      chunks = [];
      resolve({category, status: response?.statusCode || null, bytes,
        duration_ms: Math.round(performance.now() - start), body});
      response?.destroy();
      req.destroy();
    };
    const req = http.get(BASE + path, res => {
      response = res;
      // Never follow redirects or send credentials elsewhere.
      if (res.statusCode >= 300 && res.statusCode < 400) return finish('redirect_refused');
      res.on('data', chunk => {
        const available = Math.max(0, limit - bytes);
        if (available) chunks.push(chunk.subarray(0, available));
        bytes += Math.min(chunk.length, available);
        if (chunk.length > available) finish('body_limit');
      });
      res.on('end', () => finish('complete'));
      res.on('aborted', () => finish('response_interrupted'));
      res.on('error', () => finish('response_error'));
    });
    req.on('error', error => finish(error.code === 'ECONNREFUSED' ? 'connection_refused' : 'request_error'));
    const timer = setTimeout(() => finish('deadline_exceeded'), timeout);
  });
}
function json(result) { try { return JSON.parse(result.body.toString('utf8')); } catch { return null; } }
async function main() {
  const health = await get('/health', {timeout: 5000, limit: 8192});
  report('health', health, health.category === 'complete' && health.status === 200 ?
    'http_ok' : health.category !== 'complete' ? health.category : 'http_error');
  const recommendations = await get('/api/recommendations/personalized');
  const body = json(recommendations);
  const valid = recommendations.category === 'complete' && recommendations.status === 200 &&
    body && ['recentlyPlayed','mostPlayed','favorites'].every(k => Array.isArray(body[k]));
  report('personalized', recommendations, valid ? 'http_json_schema_ok' :
    recommendations.category !== 'complete' ? recommendations.category :
    recommendations.status !== 200 ? 'http_error' : 'unexpected_json_schema');
  report('stream', null, 'skipped_existing_route_may_trigger_upstream_work');
}
main().catch(() => { report('diagnostic', null, 'internal_probe_error'); process.exitCode = 1; });
