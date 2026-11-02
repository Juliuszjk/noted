// Preloaded into the throwaway API server (scripts/local-api.mjs): whatever host the code asks
// for, it listens on 127.0.0.1 only, so the test server never shows up on the LAN or the tailnet.
import net from 'node:net';

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function patched(...args) {
  if (typeof args[0] === 'object' && args[0] !== null) args[0] = { ...args[0], host: '127.0.0.1' };
  else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  }
  return listen.apply(this, args);
};
