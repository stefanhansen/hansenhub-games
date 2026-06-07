'use strict';
// Shared auth + identity for all HansenHub services (hub, learn, games).
// Identical across services so one cookie set validates everywhere.
//
// Cookies (Domain=.hansenhub.net so they span the bare domain + all subdomains):
//   hh_auth = HMAC-SHA256(SESSION_SECRET, "authenticated:" + PASSCODE)
//   hh_who  = base64url(JSON {id,name,emoji}) + "." + HMAC-SHA256(SESSION_SECRET, payload)
const crypto = require('crypto');

const PASSCODE = process.env.PASSCODE || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret';
// Set COOKIE_DOMAIN="" to make host-only cookies (useful for local 127.0.0.1 tests).
const COOKIE_DOMAIN =
  process.env.COOKIE_DOMAIN === undefined ? '.hansenhub.net' : process.env.COOKIE_DOMAIN;
const YEAR = 60 * 60 * 24 * 365;

function hmac(data) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i === -1) return;
    const k = pair.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

// --- auth token ---
function expectedAuthToken() {
  return hmac('authenticated:' + PASSCODE);
}
function isAuthed(req) {
  const t = parseCookies(req).hh_auth;
  return t ? safeEqual(t, expectedAuthToken()) : false;
}
function passcodeMatches(p) {
  return safeEqual(p || '', PASSCODE);
}

// --- identity token (hh_who) ---
function signWho(person) {
  const payload = Buffer.from(
    JSON.stringify({ id: person.id, name: person.name, emoji: person.emoji })
  ).toString('base64url');
  return payload + '.' + hmac(payload);
}
function verifyWho(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!safeEqual(sig, hmac(payload))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof obj.id !== 'number') return null;
    return { id: obj.id, name: String(obj.name || ''), emoji: String(obj.emoji || '⭐') };
  } catch (_) {
    return null;
  }
}
function whoFrom(req) {
  return verifyWho(parseCookies(req).hh_who);
}

// --- Set-Cookie builders ---
function buildCookie(name, value, maxAge) {
  const parts = [`${name}=${value}`, 'Path=/'];
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`);
  parts.push(`Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax', 'Secure');
  return parts.join('; ');
}
const authCookie = () => buildCookie('hh_auth', expectedAuthToken(), YEAR);
const whoCookie = (person) => buildCookie('hh_who', signWho(person), YEAR);
const clearCookie = (name) => buildCookie(name, '', 0);

module.exports = {
  PASSCODE_LEN: String(PASSCODE).length,
  isAuthed,
  passcodeMatches,
  parseCookies,
  whoFrom,
  signWho,
  verifyWho,
  authCookie,
  whoCookie,
  clearCookie,
};
