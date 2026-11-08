/** Shared TV lobby: scan, join and start from the lead player's phone. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, PHASES } from '@wee/shared/protocol.js';
import { QrCode } from '../components/QrCode.jsx';
import { TvCountdown } from '../components/TvCountdown.jsx';
import { TvGame } from '../components/TvGame.jsx';
import { TvReady } from '../components/TvReady.jsx';
import { TvTutorial } from '../components/TvTutorial.jsx';
import { TvVote } from '../components/TvVote.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { LobbyBackdrop } from '../components/LobbyBackdrop.jsx';
import { errorText } from '../lib/errors.js';
import { usePhoneLink } from '../lib/usePhoneLink.js';
import { request } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';
import { enterFullscreen, exitFullscreen, fullscreenElement } from '../lib/fullscreen.js';
import { useTvAudio } from '../lib/useTvAudio.jsx';
import { useRevealHold } from '../lib/useRevealHold.js';
import '../styles/game-shell.css';
import './HostLobby.css';

export default function HostStub() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { url, loading: phoneLinkLoading, status: phoneLinkStatus } = usePhoneLink(code);
  const { snapshot: lobby, reconnecting, ended, storageWarning, leave } = useReconnect('host', code);
  const audio = useTvAudio(lobby, reconnecting || Boolean(ended));
  // Holds the vote's reveal on screen for a moment before the tutorial or game.
  // A vote cancelled by someone leaving has nothing to reveal.
  const revealing = useRevealHold(lobby?.phase) && Boolean(lobby?.vote?.picks);
  const [startError, setStartError] = useState(null);
  const [returning, setReturning] = useState(false);
  const returnPending = useRef(false);
  const [pausing, setPausing] = useState(false);
  const pausePending = useRef(false);
  const currentGame = useRef(lobby?.gameId);
  currentGame.current = lobby?.gameId;

  const [immersive, setImmersive] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const requestedFullscreen = useRef(false);

  function leaveGameView() {
    setImmersive(false);
    requestedFullscreen.current = false;
    void exitFullscreen(document);
  }

  function enterGameView() {
    setImmersive(true);
    requestedFullscreen.current = true;
    // Called directly by the Full screen button, before a network await consumes the gesture.
    void enterFullscreen(document).then(entered => {
      if (entered && !requestedFullscreen.current) void exitFullscreen(document);
    });
  }

  const active = lobby?.phase === PHASES.GAME;
  useEffect(() => {
    const changed = () => {
      const entered = Boolean(fullscreenElement(document));
      setFullscreen(entered);
      // Escape should return to the windowed view without remounting the game.
      if (!entered && requestedFullscreen.current) {
        requestedFullscreen.current = false;
        setImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
      if (requestedFullscreen.current) { requestedFullscreen.current = false; void exitFullscreen(document); }
    };
  }, []);
  useEffect(() => {
    if (active) setImmersive(true);
    else if (requestedFullscreen.current) {
      requestedFullscreen.current = false;
      void exitFullscreen(document);
    }
  }, [active]);

  // A failed request is old news once the phase moves.
  const phase = lobby?.phase;
  useEffect(() => setStartError(null), [phase]);

  // Nobody presses Play on the TV any more: the phones start the countdown.
  // Browsers only start sound after the page has been interacted with, so
  // unlock it on the first click or key press here, and try again as the
  // countdown starts (the click that opened this lobby usually counts).
  const { activateForPlay } = audio;
  useEffect(() => {
    if (!lobby?.code) return;
    const unlock = () => { void activateForPlay(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [activateForPlay, lobby?.code]);
  useEffect(() => { if (phase === PHASES.COUNTDOWN) void activateForPlay(); }, [phase, activateForPlay]);

  async function returnToLobby() {
    if (reconnecting || !lobby?.gameId || returnPending.current) return;
    const gameId = lobby.gameId;
    returnPending.current = true; setReturning(true); setStartError(null);
    const result = await request(EVENTS.HOST_RETURN_TO_LOBBY, { gameId });
    returnPending.current = false; setReturning(false);
    if (currentGame.current !== gameId) return;
    if (result?.ok) leaveGameView();
    else setStartError(result?.error ?? 'disconnected');
  }

  const togglePause = useCallback(async () => {
    if (reconnecting || returning || !lobby?.gameId || lobby.phase !== PHASES.GAME || pausePending.current) return;
    const gameId = lobby.gameId;
    pausePending.current = true; setPausing(true); setStartError(null);
    const result = await request(EVENTS.HOST_PAUSE, { gameId, paused: !lobby.manuallyPaused });
    pausePending.current = false; setPausing(false);
    if (currentGame.current !== gameId) return;
    if (!result?.ok) setStartError(result?.error ?? 'disconnected');
  }, [reconnecting, returning, lobby?.gameId, lobby?.phase, lobby?.manuallyPaused]);

  if (ended || (!lobby && !reconnecting)) {
    return (
      <main className="stub host-lobby">
        <p className="eyebrow">TV lobby</p>
        <h1>Lobby closed</h1>
        <p className="stub__muted">
          {ended === 'replaced' ? 'This lobby was opened in another tab. Continue there or reload to take control.' : 'This game has ended or the reconnect window expired. Start a new lobby from the homepage.'}
        </p>
        <div className="stub__actions">
          <Link className="btn btn--primary" to="/home">
            Back to sports
          </Link>
        </div>
      </main>
    );
  }

  // Keep the game mounted through a temporary drop, so its local state survives.
  if (lobby?.phase === PHASES.GAME && !revealing) return <TvGame lobby={lobby}
    onAudio={audio.onAudio} audioControls={audio.controls}
    onReturnToLobby={returnToLobby} returning={returning} returnDisabled={reconnecting || pausing}
    onPauseToggle={togglePause} pauseDisabled={reconnecting || pausing || returning || (lobby.gameState?.phase === 'complete' && !lobby.manuallyPaused)}
    immersive={immersive} fullscreen={fullscreen} onToggleView={immersive ? leaveGameView : enterGameView}
    paused={reconnecting || lobby.paused} error={startError ? errorText(startError) : null} onClose={async () => {
      if (await leave()) navigate('/home');
      else setStartError('disconnected');
    }} />;

  if (reconnecting || lobby?.paused) return <ReconnectNotice lobby={lobby} reconnecting={reconnecting} code={code} />;

  if (!lobby) {
    return (
      <main className="stub host-lobby">
        <p className="stub__muted">Opening lobby…</p>
      </main>
    );
  }

  // The vote, then its reveal for a moment, then the tutorial if anyone asked.
  if (lobby.phase === PHASES.VOTE || revealing) return <TvVote lobby={lobby} />;
  if (lobby.phase === PHASES.TUTORIAL) return <TvTutorial lobby={lobby} />;

  return (
    <main className="stub host-lobby" data-party={lobby.players.length > 4} data-empty={!lobby.players.length}>
      <LobbyBackdrop />
      <header className="host-lobby__heading">
        <h1>{sportName(lobby.sport)}</h1>
        <div className="host-lobby__utilities">{audio.controls}<ThemeToggle /></div>
      </header>
      {storageWarning ? <p className="alert">Browser storage is unavailable. Keep this tab open to preserve your session.</p> : null}
      <div className="host-lobby__content">
        <section className="host-lobby__invite" aria-label="Join with your phone">
          <h2>Scan to play</h2>
          {url ? <QrCode value={url} className="stub__qr" label={`Scan to join lobby ${code}`} /> : null}
          <div className="host-lobby__room-code">
            <span className="visually-hidden">Room code</span>
            <p className="stub__code" data-testid="lobby-code">{code}</p>
          </div>
          {!url ? <p className="stub__muted" role="status">{phoneLinkLoading || phoneLinkStatus === 'connecting' ? 'Preparing phone connection…' : phoneLinkStatus === 'reconnecting' ? 'Reconnecting your phone link…' : 'Phone connection unavailable. Restart the phone session on your computer.'}</p> : null}
        </section>
        <div className="host-lobby__players">
          <TvReady lobby={lobby} />
          {lobby.phase === PHASES.COUNTDOWN ? <TvCountdown lobby={lobby} onTick={audio.onCountdown} /> : null}
        </div>
      </div>

      {startError ? (
        <p className="alert" role="alert">
          {errorText(startError)}
        </p>
      ) : null}

      {lobby.recovery?.ownerRequired ? <p className="alert">Continuing a saved solo game. Sign in to the same profile on your phone, then join this room.</p> : null}
      <div className="stub__actions">
        <button type="button" className="btn btn--ghost" onClick={async () => { if (await leave()) navigate('/home'); else setStartError('disconnected'); }}>
          Close lobby
        </button>
      </div>
    </main>
  );
}
