// simple-peer (used by y-webrtc) expects a few Node globals. Loaded as a
// classic script before the app so a strict CSP can forbid inline scripts.
var global = globalThis;
var process = globalThis.process || {
  env: { NODE_ENV: 'production' },
  cwd: function () { return '/'; },
  nextTick: function (cb) {
    var args = Array.prototype.slice.call(arguments, 1);
    queueMicrotask(function () { cb.apply(null, args); });
  }
};
