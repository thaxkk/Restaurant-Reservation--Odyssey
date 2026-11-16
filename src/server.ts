import { app } from './app.js';
import { config } from './config.js';
import { client } from './db.js';
import { processExpiredOffers } from './features/waitlist/promotion.js';

await client.connect();

const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});

let processingOffers = false;
async function expireOffers() {
  if (processingOffers) return;
  processingOffers = true;
  try {
    await processExpiredOffers();
  } catch (error) {
    console.error('Could not process expired waitlist offers', error);
  } finally {
    processingOffers = false;
  }
}
const offerTimer = setInterval(() => { void expireOffers(); }, 60_000);
offerTimer.unref();
void expireOffers();

function shutdown() {
  clearInterval(offerTimer);
  server.close(() => {
    void client.close().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
