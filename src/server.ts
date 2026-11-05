import { app } from './app.js';
import { config } from './config.js';
import { client } from './db.js';

await client.connect();

const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});

function shutdown() {
  server.close(() => {
    void client.close().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
