'use strict';

function corsHeaders(extraHeaders = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-token-monitor-secret',
    ...extraHeaders
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, corsHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders
  }));
  res.end(body);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, corsHeaders({
    'content-type': contentType,
    'cache-control': 'no-store'
  }));
  res.end(body);
}

// An ingest body carries per-session detail for four periods, so it is
// routinely hundreds of KB and grows with the device's history. The old 256 KB
// cap silently killed long-lived devices: once a device crossed it the hub
// destroyed the socket before writing a response, so the client saw an opaque
// network failure rather than a size error and just stopped appearing.
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
// On overflow, keep draining up to this multiple of the cap so the sender can
// finish its upload and actually read the 413. Past it the sender is ignoring
// us and the socket does get cut.
const OVERFLOW_DRAIN_FACTOR = 4;

function bodyTooLargeError(bytes, maxBytes, socketDestroyed) {
  const error = new Error(`Request body too large: ${bytes} bytes exceeds the ${maxBytes} byte limit`);
  error.statusCode = 413;
  error.socketDestroyed = socketDestroyed;
  return error;
}

function readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (!tooLarge && bytes > maxBytes) {
        tooLarge = true;
        body = '';
      }
      if (!tooLarge) {
        body += chunk;
        return;
      }
      if (bytes > maxBytes * OVERFLOW_DRAIN_FACTOR) {
        reject(bodyTooLargeError(bytes, maxBytes, true));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(bodyTooLargeError(bytes, maxBytes, false));
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (error) { reject(new Error(`Invalid JSON body: ${error.message}`)); }
    });
    req.on('error', reject);
  });
}

function requestSecret(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-token-monitor-secret'] || '').trim();
}

function isAuthorized(req, expectedSecret) {
  if (!expectedSecret) return true;
  return requestSecret(req) === expectedSecret;
}

module.exports = { DEFAULT_MAX_BODY_BYTES, isAuthorized, readJsonBody, sendJson, sendText };
