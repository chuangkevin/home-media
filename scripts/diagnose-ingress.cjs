'use strict';
// Only sanitized JSON goes to stdout. Do not import the application or its logger.
const http = require('node:http');
const https = require('node:https');
const { performance } = require('node:perf_hooks');
const mode = process.argv[2];
const choices = {
  public: {base: 'https://radio.sisihome.org', vantage: 'github_runner_public_before_tailnet'},
  nginx: {base: 'http://frontend:80', vantage: 'backend_container_to_nginx'},
  tailnet: {base: 'https://radio.sisihome.org', vantage: 'github_runner_tailnet_hostname'},
};
if (!Object.hasOwn(choices, mode)) {
  console.log(JSON.stringify({stage: 'diagnostic', category: 'unsupported_probe_mode'}));
  process.exit(1);
}
const {base: BASE, vantage} = choices[mode];
const client = mode === 'nginx' ? http : https;
const tlsFailures = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);
function report(stage, result, category) {
  console.log(JSON.stringify({vantage, stage, status: result?.status || null,
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
    const req = client.get(BASE + path, {rejectUnauthorized: true}, res => {
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
    req.on('error', error => finish(tlsFailures.has(error.code) ? 'tls_verification_failed' :
      error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? 'dns_resolution_failed' :
      error.code === 'ECONNREFUSED' ? 'connection_refused' : 'request_error'));
    const timer = setTimeout(() => finish('deadline_exceeded'), timeout);
  });
}
function json(result) { try { return JSON.parse(result.body.toString('utf8')); } catch { return null; } }
async function main() {
  const health = await get('/health', {timeout: 8000, limit: 8192});
  report('health', health, health.category === 'complete' && health.status === 200 ?
    'http_ok' : health.category !== 'complete' ? health.category : 'http_error');
  const recommendations = await get('/api/recommendations/personalized', {timeout: 15000});
  const body = json(recommendations);
  const valid = recommendations.category === 'complete' && recommendations.status === 200 &&
    body && ['recentlyPlayed','mostPlayed','favorites'].every(k => Array.isArray(body[k]));
  report('personalized', recommendations, valid ? 'http_json_schema_ok' :
    recommendations.category !== 'complete' ? recommendations.category :
    recommendations.status !== 200 ? 'http_error' : 'unexpected_json_schema');
  report('stream', null, 'skipped_existing_route_may_trigger_upstream_work');
}
main().catch(() => { report('diagnostic', null, 'internal_probe_error'); process.exitCode = 1; });
