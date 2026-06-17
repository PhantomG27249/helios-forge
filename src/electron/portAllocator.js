import net from 'node:net';

export async function allocateLoopbackPort(preferredPort = 3777) {
  const tryPort = (port) => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      const address = server.address();
      const chosen = typeof address === 'object' && address ? address.port : port;
      server.close(() => resolve(chosen));
    });
  });

  try {
    return await tryPort(preferredPort);
  } catch {
    return tryPort(0);
  }
}
