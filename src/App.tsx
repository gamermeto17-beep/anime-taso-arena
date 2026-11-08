import { useCallback, useState } from 'react';
import { LevelUpOverlay } from './components/LevelUpOverlay';
import { isSoundEnabled, setSoundEnabled } from './lib/sound';
import { loadSession, logout, saveSession, type Session } from './net/auth';
import { useGame } from './net/useGame';
import { CollectionScreen } from './screens/CollectionScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MenuScreen, ResultsScreen, RoomSelectScreen, SearchingScreen, StakePickScreen } from './screens/MenuScreens';
import { ProfileScreen } from './screens/ProfileScreen';
import { TableScreen } from './screens/TableScreen';

type Screen = 'menu' | 'rooms' | 'collection' | 'profile';

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [screen, setScreen] = useState<Screen>('menu');
  const [sound, setSound] = useState(isSoundEnabled());
  const game = useGame(session?.token ?? null);
  const { me, view, socket } = game;

  const signOut = useCallback(() => {
    if (session) void logout(session.token);
    saveSession(null);
    setSession(null);
    setScreen('menu');
  }, [session]);

  const clearXp = game.clearXpResult;
  let body: React.ReactNode;
  if (!session || game.authFailed) {
    body = (
      <LoginScreen
        onDone={(s) => {
          saveSession(s);
          setSession(s);
          setScreen('menu');
        }}
      />
    );
  } else if (!me || !socket) {
    body = (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-8 border-white/20 border-t-amber-300" />
          <div className="mt-4 font-bold">{game.error ?? 'Sunucuya bağlanılıyor…'}</div>
          {game.error && (
            <button className="btn btn-ghost mt-4" onClick={signOut}>
              Çıkış yap
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
    body = <TableScreen key={`${view.matchId}-${view.round}`} view={view} viewAt={game.viewAt} socket={socket} onDecision={game.decide} />;
  } else if (me.queued) {
    body = <SearchingScreen roomId={me.queued} onCancel={game.leaveQueue} />;
  } else if (screen === 'rooms') {
    body = <RoomSelectScreen me={me} onBack={() => setScreen('menu')} onShooter={game.setShooter} onPick={(r) => game.joinQueue(r.id)} />;
  } else if (screen === 'collection') {
    body = (
      <CollectionScreen
        me={me}
        onBack={() => setScreen('menu')}
        onShooter={game.setShooter}
        onFlag={game.setFlag}
        onUploadXp={game.uploadXp}
      />
    );
  } else if (screen === 'profile') {
    body = <ProfileScreen me={me} onBack={() => setScreen('menu')} onLogout={signOut} />;
  } else {
    body = (
      <MenuScreen
        me={me}
        onPlay={() => setScreen('rooms')}
        onRescue={game.rescue}
        onCollection={() => setScreen('collection')}
        onProfile={() => setScreen('profile')}
      />
    );
  }

  return (
    <div className="relative h-full">
      {session && !game.authFailed && (
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
      {game.xpResult && me && (
        <LevelUpOverlay result={game.xpResult} tile={me.inventory.find((t) => t.uid === game.xpResult!.targetUid)} onClose={clearXp} />
      )}
      {game.everConnected && !game.connected && (
        <div className="absolute inset-x-0 top-0 z-[110] bg-rose-600 py-1 text-center text-sm font-bold">
          Bağlantı koptu — yeniden bağlanılıyor… (maçın korunuyor)
        </div>
      )}
      {game.error && me && (
        <div
          className="absolute inset-x-4 bottom-4 z-[110] mx-auto max-w-md cursor-pointer rounded-2xl bg-slate-800 px-4 py-3 text-center text-sm font-bold shadow-xl ring-1 ring-white/20"
          onClick={game.clearError}
        >
          {game.error}
        </div>
      )}
    </div>
  );
}
