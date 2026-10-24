import http from 'node:http';
import net from 'node:net';

// CONNECT tunnels preserve the real site's TLS and response bytes. Offline blocks
// the transport itself, including worker script update checks outside page emulation.
// This is a network condition, not Playwright request routing or a fake site response.
export async function createTransportGate() {
  let online = false;
  const events = [], sockets = new Set();
  const track = socket => {sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket;};
  const server = http.createServer((req, res) => {
    const entry = {at: new Date().toISOString(), type: 'http', url: req.url, online, status: online ? 'forwarded' : 'blocked'}; events.push(entry);
    if (!online) {res.destroy(); return;}
    const upstream = http.request(req.url, {method: req.method, headers: req.headers}, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('socket', track); upstream.on('error', error => {entry.error = error.code || error.message; res.destroy();}); req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (request, client, head) => {
    const entry = {at: new Date().toISOString(), type: 'connect', authority: request.url, online, status: online ? 'connecting' : 'blocked'};
    events.push(entry);
    if (!online) {client.destroy(); return;}
    const address = new URL('https://' + request.url);
    const upstream = track(net.connect(Number(address.port || 443), address.hostname));
    upstream.once('connect', () => {
      if (!online) {entry.status = 'blocked-before-connect'; client.destroy(); upstream.destroy(); return;}
      entry.status = 'tunneled'; client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.once('error', error => {entry.error = error.code || error.message; client.destroy();});
    client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server: `http://127.0.0.1:${server.address().port}`, events,
    setOnline(value, phase) {online = value; events.push({at: new Date().toISOString(), type: 'phase', online, phase}); if (!online) for (const socket of sockets) socket.destroy();},
    close: () => new Promise(resolve => {for (const socket of sockets) socket.destroy(); server.close(resolve);})};
}
