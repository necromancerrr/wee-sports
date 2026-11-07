/**
 * The phone's side of the ready check: one big toggle and the count. Once
 * everyone is ready the countdown shows here too, and the toggle stays so a
 * player can still back out. Kept out of JoinStub so the phone display owner
 * can restyle it on its own.
 */

import { useEffect, useState } from 'react';
import { EVENTS, PHASES, isController } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useCountdown } from '../lib/useCountdown.js';

/** lobby is the latest snapshot; slot is this phone's seat. */
export function PhoneReady({ lobby, slot, disabled = false, automatic = false, allowStart = true, onStart, onHold }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown.msLeft : null);

  // The snapshot is the source of truth, so the button always matches the TV.
  const ready = lobby.players.find((player) => player.slot === slot)?.ready ?? false;
  const needsSetup = isController(lobby.sport, slot) && !lobby.players.find(player => player.slot === slot)?.setup;
  const readyCount = lobby.players.filter((player) => player.ready).length;

  useEffect(() => {
    if (!automatic || !allowStart || lobby.phase !== PHASES.READY || ready || needsSetup || disabled) return;
    let current = true;
    setError(null);
    request(EVENTS.PLAYER_READY, {ready: true}).then(result => {
      if (current && !result.ok) setError(result.error);
    });
    return () => {current = false;};
  }, [automatic, allowStart, lobby.code, lobby.phase, slot, ready, needsSetup, disabled, attempt]);

  async function toggle() {
    setSending(true);
    setError(null);
    const result = await request(EVENTS.PLAYER_READY, { ready: !ready });
    setSending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <section className="phone-ready">
      {counting ? (
        <h2 className="phone-ready__title" role="timer">
          {secondsLeft > 0 ? `Starting in ${secondsLeft}…` : 'Go!'}
        </h2>
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      {automatic ? <>
        {!counting ? <p className="phone-ready__count" role="status">
          {!allowStart ? 'Take your time. Everyone can join here.' : needsSetup ? 'Getting your controller ready…' : ready ? 'You’re in. Watch the TV.' : 'Joining the game…'}
        </p> : null}
        {!allowStart ? <button type="button" className="btn btn--primary" disabled={disabled || needsSetup} onClick={onStart}>Play</button>
          : !needsSetup && onHold ? <button type="button" className="btn btn--ghost" disabled={disabled || sending}
            onClick={async () => {setSending(true); const result = await onHold(); setSending(false); if (!result.ok) setError(result.error);}}>Wait for friends</button> : null}
        {error ? <button type="button" className="btn btn--ghost" onClick={() => setAttempt(value => value + 1)}>Try again</button> : null}
      </> : <>

      <button
        type="button"
        className={`btn ${ready ? 'btn--ghost' : 'btn--primary'} phone-ready__btn`}
        aria-pressed={ready}
        disabled={sending || disabled || needsSetup}
        onClick={toggle}
      >
        {ready ? 'Ready ✓ (tap to undo)' : 'Ready'}
      </button>
      {needsSetup ? <p className="stub__muted">Finish controller setup below to unlock Ready.</p> : null}
      <p className="phone-ready__count" aria-live="polite">
        {readyCount}/{lobby.players.length} ready
      </p>
      </>}
    </section>
  );
}
