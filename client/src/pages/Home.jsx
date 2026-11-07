import {useEffect, useRef, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {EVENTS, PROTOCOL_VERSION} from '@wee/shared/protocol.js';
import {createControllerCapabilities} from '../../../shared/controllerCapabilities.js';
import {IslandScenery} from '../components/IslandScenery.jsx';
import {IslandMenu} from '../components/IslandMenu.jsx';
import {MAIN_ISLAND, presentIslandSports} from '../lib/island.js';
import {useIslandMotion} from '../lib/useIslandMotion.js';
import {errorText} from '../lib/errors.js';
import {request, useConnection} from '../lib/socket.js';
import {saveToken} from '../lib/reconnect.js';
import {SPORTS, playerRange} from '../lib/sports.js';
import './Island.css';

const PRESENTATION = presentIslandSports(SPORTS);
const ORDERED_SPORTS = [...PRESENTATION.venues.map(venue => venue.sport), ...PRESENTATION.unmapped]
  .sort((a, b) => Number(b.open) - Number(a.open));

function ArrowLeft() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>;
}

/** One activation uses the existing authenticated room-creation path. */
export default function Home() {
  const navigate = useNavigate();
  const connection = useConnection();
  const {enabled} = useIslandMotion();
  const title = useRef(null);
  const mounted = useRef(false);
  const openingRef = useRef(false);
  const gamesDialog = useRef(null);
  const gamesButton = useRef(null);
  const [opening, setOpening] = useState(null);
  const [failure, setFailure] = useState(null);
  const [highlighted, setHighlighted] = useState(null);

  useEffect(() => {
    mounted.current = true;
    document.title = 'Choose a sport · Wee Sports';
    title.current?.focus({preventScroll: true});
    return () => {mounted.current = false;};
  }, []);

  async function host(sport) {
    if (!sport.open || openingRef.current || connection !== 'online') return;
    openingRef.current = true;
    setOpening(sport.id);
    setFailure(null);
    const result = await request(EVENTS.HOST_CREATE, {v: PROTOCOL_VERSION, sport: sport.id,
      capabilities: createControllerCapabilities({buttons: true})});
    openingRef.current = false;
    if (result?.ok) {
      saveToken('host', result.code, result.token);
      if (mounted.current) navigate(`/host/${result.code}`);
    } else if (mounted.current) {
      setOpening(null);
      setFailure({sport: sport.id, message: errorText(result?.error)});
    }
  }

  function sportControl(sport, mode = 'map') {
    const {Icon} = sport;
    const error = failure?.sport === sport.id ? failure.message : null;
    const busy = opening === sport.id;
    const disabled = Boolean(opening) || connection !== 'online';
    const errorId = `island-${mode}-${sport.id}-error`;
    const contents = <>
      <Icon className="island-venue__icon" />
      <span className="island-venue__copy"><span className="island-venue__name">{sport.name}</span>
        <span className="island-venue__meta">{sport.open ? playerRange(sport.players) : 'Coming soon'}</span>
        {busy && <span className="island-venue__pending">Opening…</span>}
        {error && <span className="island-venue__retry">Try again</span>}
      </span>
    </>;
    return <>
      {sport.open ? <button type="button" className="island-venue" data-sport={sport.id}
        data-highlighted={highlighted === sport.id} disabled={disabled}
        aria-label={`${error ? 'Try again' : 'Play'}: ${sport.name}`} aria-busy={busy}
        aria-describedby={error ? errorId : undefined} onClick={() => host(sport)}
        onPointerEnter={() => setHighlighted(sport.id)} onPointerLeave={() => setHighlighted(null)}
        onFocus={() => setHighlighted(sport.id)} onBlur={() => setHighlighted(null)}>{contents}</button>
        : <div className="island-venue island-venue--future" data-sport={sport.id}>{contents}</div>}
      {error && <p className="island-venue-error" id={errorId}>{error}</p>}
    </>;
  }

  const status = opening ? `Opening ${SPORTS.find(sport => sport.id === opening)?.name}…`
    : failure ? failure.message
      : connection === 'online' ? '' : connection === 'connecting' ? 'Connecting…' : 'Offline. Reconnecting to the game server…';

  return <main className="island-screen island-home" data-motion={enabled}>
    <IslandScenery image={MAIN_ISLAND.image}>
      {rect => <>
        <svg className="island-connectors" width={rect.width} height={rect.height} aria-hidden="true">
          {PRESENTATION.venues.map(venue => {
            const selected = highlighted === venue.sportId;
            return <g key={venue.sportId} data-highlighted={selected}>
              <line x1={venue.label.x * rect.width} y1={venue.label.y * rect.height}
                x2={venue.anchor.x * rect.width} y2={venue.anchor.y * rect.height} />
              {selected && <circle className="island-target-halo" cx={venue.anchor.x * rect.width} cy={venue.anchor.y * rect.height} r="13" />}
              <circle cx={venue.anchor.x * rect.width} cy={venue.anchor.y * rect.height} r="5" />
            </g>;
          })}
        </svg>
        <nav className="island-map-venues" aria-label="Sports on the island">
          {PRESENTATION.venues.map(venue => <div className="island-venue-anchor" key={venue.sportId}
            style={{left: `${venue.label.x * 100}%`, top: `${venue.label.y * 100}%`}}>
            {sportControl(venue.sport)}
          </div>)}
        </nav>
      </>}
    </IslandScenery>
    <header className="island-header">
      <Link className="island-wordmark" to="/">Wee Sports</Link>
      <h1 ref={title} tabIndex={-1}>Choose a sport</h1>
      <div className="island-header__menu"><IslandMenu /></div>
    </header>
    <section className="island-mobile-games" aria-label="Games">
      {ORDERED_SPORTS.map(sport => <div key={sport.id}>{sportControl(sport, 'mobile')}</div>)}
    </section>
    <div className="island-status" role="status" aria-live="polite">{status}</div>
    <footer className="island-footer">
      <Link to="/" className="island-small-control"><ArrowLeft />Back</Link>
      <button type="button" ref={gamesButton} className="island-small-control island-games-button"
        aria-haspopup="dialog" onClick={() => gamesDialog.current.showModal()}>Games</button>
      {PRESENTATION.unmapped.length > 0 && <span className="island-unmapped-note">More sports in Games</span>}
    </footer>
    <dialog ref={gamesDialog} className="island-games-dialog" aria-labelledby="island-games-title"
      onClose={() => gamesButton.current?.focus({preventScroll: true})}
      onClick={event => {if (event.target === gamesDialog.current) gamesDialog.current.close();}}>
      <div className="island-games-dialog__content">
        <header><h2 id="island-games-title">Games</h2><button type="button" className="island-small-control"
          aria-label="Close games" onClick={() => gamesDialog.current.close()}>Close</button></header>
        <div className="island-games-list">{ORDERED_SPORTS.map(sport => <div key={sport.id}>{sportControl(sport, 'list')}</div>)}</div>
        <p role="status">{status}</p>
      </div>
    </dialog>
  </main>;
}
