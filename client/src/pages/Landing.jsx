import {useEffect, useRef} from 'react';
import {Link} from 'react-router-dom';
import {IslandScenery} from '../components/IslandScenery.jsx';
import {MAIN_ISLAND} from '../lib/island.js';
import {useIslandMotion} from '../lib/useIslandMotion.js';
import './Island.css';

export default function Landing() {
  const title = useRef(null);
  const {enabled} = useIslandMotion();
  useEffect(() => {document.title = 'Wee Sports'; title.current?.focus({preventScroll: true});}, []);
  return <main className="island-screen island-landing" data-motion={enabled}>
    <IslandScenery image={MAIN_ISLAND.landing} />
    <h1 ref={title} tabIndex={-1} className="island-landing__wordmark">Wee Sports</h1>
    <Link to="/home" className="island-landing__play">Play</Link>
  </main>;
}
