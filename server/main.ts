import { createDbFromEnv } from './db';
import { createGameServer } from './gameServer';
import { createStore } from './store';

const db = await createDbFromEnv();
const store = createStore(db);
await store.migrate();
const server = createGameServer(store);
const port = await server.start();
console.log(`ANIME TASO ARENA sunucusu :${port} (veritabanı: ${db.kind})`);

const shutdown = async (sig: string) => {
  console.log(`${sig}: kapatılıyor, bekleyen yazmalar tamamlanıyor...`);
  await server.stop().catch(() => undefined);
  await store.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
