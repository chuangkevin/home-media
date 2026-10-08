'use strict';
// One bounded post-deploy handshake over the existing Tailnet connection.
// Confirms HTTP/WebSocket upgrade only, not a Socket.IO session or audio playback.
const https = require('node:https');
const { randomBytes, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const start = performance.now();
const key = randomBytes(16).toString('base64');
const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
let done = false;
function finish(category, status = null) {
  if (done) return;
  done = true;
  clearTimeout(deadline);
  console.log(JSON.stringify({vantage: 'github_runner_tailnet_hostname',
    stage: 'websocket_upgrade', status, duration_ms: Math.round(performance.now() - start), category}));
}
const req = https.request('https://radio.sisihome.org/socket.io/?EIO=4&transport=websocket', {
  method: 'GET', rejectUnauthorized: true,
  headers: {Origin: 'https://radio.sisihome.org', Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key},
});
const deadline = setTimeout(() => {
  finish('deadline_exceeded');
  req.destroy();
}, 15000);
req.on('response', res => {
  finish(res.statusCode >= 300 && res.statusCode < 400 ? 'redirect_refused' : 'no_websocket_upgrade', res.statusCode);
  res.destroy();
  req.destroy();
});
req.on('upgrade', (res, socket) => {
  const valid = res.statusCode === 101 &&
    String(res.headers.upgrade || '').toLowerCase() === 'websocket' &&
    String(res.headers.connection || '').toLowerCase().split(',').map(s => s.trim()).includes('upgrade') &&
    res.headers['sec-websocket-accept'] === expected;
  socket.on('error', () => {}); // Do not log network details or payloads.
  finish(valid ? 'websocket_upgrade_101_valid_not_socketio_or_audio_pass' : 'invalid_websocket_handshake', res.statusCode);
  if (!valid) { socket.destroy(); return; }
  // RFC6455 client close frame: FIN + close, masked 2-byte status1000. No application message.
  const mask = randomBytes(4);
  const close = Buffer.from([0x88, 0x82, ...mask, 0x03 ^ mask[0], 0xe8 ^ mask[1]]);
  socket.end(close);
  setTimeout(() => socket.destroy(), 100);
});
req.on('error', error => {
  const tls = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);
  finish(tls.has(error.code) ? 'tls_verification_failed' :
    error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? 'dns_resolution_failed' :
    error.code === 'ECONNREFUSED' ? 'connection_refused' : 'request_error');
});
req.end();
