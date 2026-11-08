import { useState } from 'react';
import { isSoundEnabled, setSoundEnabled } from './lib/sound';
import { getStoredName, useGame } from './net/useGame';
import {
  LoginScreen,
  MenuScreen,
  ResultsScreen,
  RoomSelectScreen,
  SearchingScreen,
  StakePickScreen,
} from './screens/MenuScreens';
import { TableScreen } from './screens/TableScreen';

type Screen = 'menu' | 'rooms';

export function App() {
  const [name, setName] = useState<string | null>(() => getStoredName() || null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [sound, setSound] = useState(isSoundEnabled());
  const game = useGame(name);
  const { me, view, socket } = game;

  let body: React.ReactNode;
  if (!name) {
    body = <LoginScreen initial="" onSubmit={setName} />;
  } else if (!me || !socket) {
    body = (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-8 border-white/20 border-t-amber-300" />
          <div className="mt-4 font-bold">{game.error ?? 'Sunucuya bağlanılıyor…'}</div>
          {game.error && (
            <button
              className="btn btn-ghost mt-4"
              onClick={() => {
                setName(null);
              }}
            >
              Adı değiştir
            </button>
          )}
        </div>
      </div>
    );
  } else if (view && view.phase === 'ended') {
    body = (
      <ResultsScreen
        summary={view.summary}
        names={view.names}
        you={view.you}
        reason={view.endReason}
        onMenu={() => {
          game.clearMatch();
          setScreen('menu');
        }}
      />
    );
  } else if (view && view.phase === 'stakes') {
    body = (
      <StakePickScreen
        key={`${view.matchId}-${view.round}`}
        view={view}
        viewAt={game.viewAt}
        inventory={me.inventory}
        shooterUid={me.shooterUid}
        onConfirm={game.confirmStakes}
        onLeave={game.leaveMatch}
      />
    );
  } else if (view && view.state && view.shooters) {
    body = (
      <TableScreen
        key={`${view.matchId}-${view.round}`}
        view={view}
        viewAt={game.viewAt}
        socket={socket}
        onDecision={game.decide}
      />
    );
  } else if (me.queued) {
    body = <SearchingScreen roomId={me.queued} onCancel={game.leaveQueue} />;
  } else if (screen === 'rooms') {
    body = (
      <RoomSelectScreen
        me={me}
        onBack={() => setScreen('menu')}
        onShooter={game.setShooter}
        onPick={(r) => game.joinQueue(r.id)}
      />
    );
  } else {
    body = <MenuScreen me={me} onPlay={() => setScreen('rooms')} onRescue={game.rescue} />;
  }

  return (
    <div className="relative h-full">
      {name && (
        <button
          className="absolute right-3 top-3 z-[60] rounded-full bg-black/50 px-3 py-1 text-sm"
          onClick={() => {
            setSoundEnabled(!sound);
            setSound(!sound);
          }}
          aria-label="Sesi aç/kapat"
        >
          {sound ? '🔊 Ses açık' : '🔇 Ses kapalı'}
        </button>
      )}
      {body}
      {game.everConnected && !game.connected && (
        <div className="absolute inset-x-0 top-0 z-[70] bg-rose-600 py-1 text-center text-sm font-bold">
          Bağlantı koptu — yeniden bağlanılıyor… (maçın korunuyor)
        </div>
      )}
      {game.error && me && (
        <div
          className="absolute inset-x-4 bottom-4 z-[70] mx-auto max-w-md cursor-pointer rounded-2xl bg-slate-800 px-4 py-3 text-center text-sm font-bold shadow-xl ring-1 ring-white/20"
          onClick={game.clearError}
        >
          {game.error}
        </div>
      )}
    </div>
  );
}
