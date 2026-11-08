import { createGameServer } from './gameServer';

const server = createGameServer();
server.start().then((port) => {
  console.log(`Anime Taso Arena sunucusu hazır: http://localhost:${port}`);
});
