import {useEffect, useRef, useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {JoinBox} from '../components/JoinBox.jsx';
import {ThemeToggle} from '../components/ThemeToggle.jsx';
import {scannedRoom, startRoomCamera} from '../lib/roomScan.js';
import './RemoteHome.css';

function ScanMark() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z" />
  </svg>;
}

export default function RemoteHome() {
  const navigate = useNavigate();
  const title = useRef(null), dialog = useRef(null), video = useRef(null), scanButton = useRef(null);
  const manual = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [cameraStatus, setCameraStatus] = useState('Starting camera…');
  useEffect(() => {document.title = 'Your controller · Wee Sports'; title.current?.focus({preventScroll: true});}, []);
  useEffect(() => {
    if (!scanning) return;
    const stop = startRoomCamera(video.current, {
      onReady: () => setCameraStatus('Point at the QR code on your TV.'),
      onError: error => {setMessage(error); dialog.current?.close(); if (manual.current) manual.current.open = true;},
      onCode: value => {
        const target = scannedRoom(value, location.origin);
        if (!target) {setCameraStatus('Use the Wee Sports QR code on your TV.'); return false;}
        dialog.current?.close();
        const url = new URL(target);
        if (url.origin === location.origin) navigate(url.pathname + url.search);
        else location.assign(target);
        return true;
      },
    });
    const hidden = () => {if (document.hidden) dialog.current?.close();};
    document.addEventListener('visibilitychange', hidden);
    return () => {stop(); document.removeEventListener('visibilitychange', hidden);};
  }, [scanning, navigate]);
  return <main className="remote-home" data-display-role="remote">
    <header className="remote-header"><Link to="/" className="remote-wordmark">Wee Sports<span>Controller</span></Link><ThemeToggle /></header>
    <section className="remote-connect">
      <div className="remote-controller-mark" aria-hidden="true"><svg viewBox="0 0 80 100" fill="none"><rect x="19" y="7" width="42" height="86" rx="14" /><path d="M33 16h14M30 79h20M29 43h22m-11-11v22" /><circle cx="40" cy="66" r="3" /></svg></div>
      <h1 ref={title} tabIndex={-1}>Ready to play?</h1>
      <p>Connect to your TV.<br />Your phone does the rest.</p>
      <button ref={scanButton} type="button" className="remote-scan" onClick={() => {
        setMessage(''); setCameraStatus('Starting camera…'); dialog.current.showModal(); setScanning(true);
      }}><ScanMark />Scan TV code</button>
      {message && <p className="remote-notice" role="status">{message}</p>}
      <details ref={manual} className="remote-manual"><summary>Enter a code instead</summary>
        <JoinBox title="TV code" description="Enter the four characters shown on your TV." />
      </details>
    </section>
    <footer className="remote-footer"><Link to="/profile">Profile &amp; history<span aria-hidden="true">›</span></Link>
      <p>No account needed to play.</p></footer>
    <dialog ref={dialog} className="remote-scanner" aria-labelledby="remote-scan-title" onClose={() => {
      setScanning(false); scanButton.current?.focus({preventScroll: true});
    }}>
      <header><h2 id="remote-scan-title">Scan your TV</h2><button type="button" aria-label="Close scanner" onClick={() => dialog.current.close()}>Close</button></header>
      <div className="remote-viewfinder"><video ref={video} muted playsInline /><span aria-hidden="true" /></div>
      <p role="status">{cameraStatus}</p>
    </dialog>
  </main>;
}
