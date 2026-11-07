import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Gyroscope } from 'expo-sensors';
import { EVENTS, normalizeCode } from '../../shared/protocol.js';
import { createControllerCapabilities } from '../../shared/controllerCapabilities.js';
import { ControllerSession, parseRoomLink, serverOrigin } from './src/session.js';
import { NativeMotionController } from './src/motion.js';
import { profileRequest, readPrivate, writePrivate } from './src/storage.js';
import { createGuestClaimVault } from './src/guestClaims.js';

const title = sport => ({ bowling: 'Bowling', tennis: 'Tennis', 'table-tennis': 'Table Tennis' })[sport] || 'Wee Sports';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const guestClaims = createGuestClaimVault({read: () => readPrivate('guestClaims'), write: values => writePrivate('guestClaims', values)});
function Button({ children, onPress, disabled, quiet = false }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, quiet && styles.quietButton, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, quiet && styles.quietText]}>{children}</Text>
  </Pressable>;
}
function Field({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#8792aa" style={styles.input} {...props}/></View>;
}
function Stepper({ label, value, change, min = -1, max = 1, step = .1 }) {
  return <View style={styles.stepper}><Text style={styles.label}>{label} {Math.round(value * 100)}%</Text>
    <View style={styles.row}><Button quiet onPress={() => change(clamp(value - step, min, max))}>−</Button><Button quiet onPress={() => change(clamp(value + step, min, max))}>+</Button></View></View>;
}

export default function App() {
  const [origin, setOrigin] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('Player');
  const [seat, setSeat] = useState(null);
  const [status, setStatus] = useState('Ready to join');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [savedSession, setSavedSession] = useState(null);
  const [setup, setSetup] = useState(null);
  const [mode, setMode] = useState('touch');
  const [motionStatus, setMotionStatus] = useState({ state: 'off' });
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(.55);
  const [spin, setSpin] = useState(0);
  const [rollState, setRollState] = useState(null);
  const [hand, setHand] = useState('Right');
  const [haptics, setHaptics] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [profileOpen, setProfileOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState([]);
  const sessionRef = useRef(null), motionRef = useRef(null), hapticsRef = useRef(true);
  const boundaryRef = useRef(null);
  const pendingRoll = useRef(false), touch = useRef(null), poseTimer = useRef(null);
  hapticsRef.current = haptics;
  const buzz = type => {
    if (!hapticsRef.current) return;
    const task = type === 'contact' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) : Haptics.selectionAsync();
    task.catch(() => {});
  };
  const task = async work => { setBusy(true); setNotice(''); try { await work(); } catch (error) { setNotice(error.message); } finally { setBusy(false); } };
  const result = value => { if (!value?.ok) throw new Error(value?.error === 'outcome-unknown' ? 'The outcome is unknown. Check the TV before trying another action.' : value?.error || 'The server did not accept this action.'); return value; };

  useEffect(() => {
    readPrivate('room').then(value => { if (value?.origin && value?.code && value?.token) setSavedSession(value); }).catch(() => {});
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        motionRef.current?.stop(); setSetup(null); setMotionStatus({ state: 'off' }); setScanner(false);
        sessionRef.current?.background();
      } else sessionRef.current?.foreground();
    });
    return () => { subscription.remove(); motionRef.current?.stop(); sessionRef.current?.dispose(); clearInterval(poseTimer.current); };
  }, []);

  useEffect(() => {
    if (seat?.gameState?.phase === 'rolling' || seat?.gameState?.phase === 'complete') { pendingRoll.current = false; setRollState(null); }
    if (!seat || seat.paused || !['game', 'ready', 'countdown'].includes(seat.phase)) motionRef.current?.recenter();
  }, [seat?.gameState?.phase, seat?.phase, seat?.paused]);
  useEffect(() => {
    if (mode === 'motion') { motionRef.current?.stop(); setSetup(null); setMotionStatus({ state: 'recalibrate', message: 'Check your grip for this sport.' }); }
  }, [seat?.sport]);

  async function makeSession(address) {
    motionRef.current?.stop(); sessionRef.current?.dispose(); setSetup(null); pendingRoll.current = false;
    const savedProfile = await readPrivate('profile').catch(() => null);
    const session = new ControllerSession(address, {
      profileToken: savedProfile?.origin === address ? savedProfile.token : null,
      save: value => writePrivate('room', value).catch(() => setNotice('Secure storage is unavailable. Keep the app open to retain this room.')),
      saveClaim: (address, claim) => guestClaims.remember(address, claim),
      changed: (next, connection) => {
        const boundary = next ? `${next.gameId}:${next.inputGeneration}:${next.hostEpoch}` : null;
        if (boundary !== boundaryRef.current) { motionRef.current?.recenter(); touch.current = null; }
        boundaryRef.current = boundary;
        const currentPlayer = next?.players?.find(value => value.slot === next.slot);
        if (currentPlayer?.setup === null) setSetup(null);
        setSeat(next); setStatus(connection);
        if (connection !== 'online') { motionRef.current?.stop(); setSetup(null); clearInterval(poseTimer.current); }
      },
      feedback: () => { buzz('contact'); setNotice('Contact confirmed by the TV'); },
    });
    sessionRef.current = session;
    return session;
  }

  async function join() {
    const address = serverOrigin(origin.trim(), __DEV__);
    const session = await makeSession(address);
    const motionAvailable = await Gyroscope.isAvailableAsync().catch(() => false);
    result(await session.join(code, name, createControllerCapabilities({
      sports: ['tennis', 'bowling', 'table-tennis'], motion: motionAvailable, orientation: motionAvailable, haptics, buttons: true })));
    setOrigin(address); setScanner(false); setSavedSession(null); buzz('ready');
  }
  async function setController(kind) {
    result(await sessionRef.current.request(EVENTS.PLAYER_SETUP, { setup: kind }));
    setSetup(kind); buzz('ready');
  }
  async function useTouch() {
    motionRef.current?.stop(); setMode('touch'); setMotionStatus({ state: 'off' });
    await setController('buttons');
  }
  async function calibrate() {
    motionRef.current?.stop(); setMode('motion'); setSetup(null); setMotionStatus({ state: 'collecting', progress: 0 });
    await sessionRef.current.request(EVENTS.PLAYER_SETUP, { setup: null });
    const motion = new NativeMotionController({ session: sessionRef.current, hand, sensitivity,
      onStatus: setMotionStatus,
      onRelease: roll => { buzz('recognized'); setNotice('Release recognized locally…'); release(roll).catch(error => setNotice(error.message)); },
    });
    motionRef.current = motion;
    await motion.calibrate();
  }
  async function release(roll = { aim, power, spin }) {
    if (pendingRoll.current) throw new Error('Wait for the TV to resolve the previous roll.');
    pendingRoll.current = true;
    const accepted = await sessionRef.current.action(EVENTS.PLAYER_ROLL, { type: 'roll', power: roll.power, spin: roll.spin, aim: roll.aim });
    if (!accepted.ok && accepted.error !== 'outcome-unknown') pendingRoll.current = false;
    setRollState(accepted.error === 'outcome-unknown' ? { id: accepted.id, status: 'unknown', gameId: seat.gameId } : null);
    result(accepted); setNotice('Roll accepted by the TV');
  }
  async function checkRoll() {
    if (!rollState) return;
    const checked = result(await sessionRef.current.request(EVENTS.PLAYER_ACTION_STATUS, { id: rollState.id, gameId: rollState.gameId }));
    if (checked.status === 'rejected') { pendingRoll.current = false; setRollState(null); setNotice('The TV rejected that roll. You may try a new delivery.'); }
    else if (checked.status === 'accepted') { setRollState(null); setNotice('The TV accepted that roll. Wait for it to finish.'); }
    else setNotice('The roll is still unresolved. Check the TV; no duplicate will be sent.');
  }
  const command = async (action, extra = {}) => result(await sessionRef.current.action(EVENTS.PLAYER_GAME_COMMAND, { action, ...extra }));
  function touchPose(event, start = false) {
    const { locationX, locationY } = event.nativeEvent;
    const time = performance.now();
    const reach = { x: clamp((locationX - 150) / 150, -1, 1), y: clamp((90 - locationY) / 90, -1, 1) };
    const previous = touch.current;
    const dt = previous && !start ? Math.max(.016, (time - previous.time) / 1000) : Infinity;
    const velocity = { x: previous ? clamp((reach.y - previous.reach.y) / dt, -12, 12) : 0,
      y: previous ? clamp((reach.x - previous.reach.x) / dt, -12, 12) : 0, z: 0 };
    touch.current = { reach, time, velocity };
    sessionRef.current.latest('pose', { orientation: [0, 0, 0, 1], angularVelocity: velocity, reach, calibrationRevision: 0 });
  }
  async function openProfile() {
    const address = serverOrigin(origin.trim(), __DEV__);
    const saved = await readPrivate('profile');
    setProfileOpen(true);
    if (saved?.origin !== address) { setAccount(null); return; }
    const current = await profileRequest(address, '', { token: saved.token });
    await sessionRef.current?.captureGuestClaim();
    await guestClaims.claimFor(address, claim => profileRequest(address, '/claim', {method:'POST',token:saved.token,body:{claim}}));
    setAccount({ ...saved, profile: current.profile });
    setHistory((await profileRequest(address, '/history', { token: saved.token })).history || []);
  }
  async function authenticate(register) {
    const address = serverOrigin(origin.trim(), __DEV__);
    const auth = await profileRequest(address, register ? '/register' : '/login', { method: 'POST', body: { username, password, ...(register ? { displayName: name } : {}) } });
    if (!auth.token) throw new Error('This server does not support native profile sessions. Continue as a guest.');
    const saved = { origin: address, token: auth.token, profile: auth.profile };
    await writePrivate('profile', saved); setAccount(saved); setPassword(''); setName(auth.profile.displayName);
    await sessionRef.current?.captureGuestClaim();
    await guestClaims.claimFor(address, claim => profileRequest(address, '/claim', {method:'POST',token:auth.token,body:{claim}}));
    if (sessionRef.current?.origin === address) sessionRef.current.setProfileToken(auth.token);
    const preferences = auth.profile.preferences;
    if (preferences) { setHand(preferences.hand); setHaptics(preferences.haptics); setSensitivity(preferences.sensitivity); }
    setHistory((await profileRequest(address, '/history', { token: auth.token })).history || []);
  }

  const player = seat?.players?.find(value => value.slot === seat.slot);
  const playable = seat?.phase === 'game' && !seat.paused && status === 'online';
  const canRoll = playable && seat?.gameState?.phase === 'ready' && seat?.gameState?.currentPlayer === seat.slot + 1;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Text style={styles.brand}>wee<Text style={styles.brandAccent}> sports</Text></Text><Text style={styles.pill}>CONTROLLER</Text></View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status === 'online' ? '● Connected to your TV' : status}</Text>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {profileOpen ? <View style={styles.card}>
      <Text style={styles.heading}>Your profile</Text><Text style={styles.copy}>Optional. Guest play is always available.</Text>
      {account ? <>
        <Text style={styles.subheading}>{account.profile.displayName}</Text>
        <Button quiet onPress={() => setHand(hand === 'Right' ? 'Left' : 'Right')}>{hand} handed</Button>
        <Button quiet onPress={() => setHaptics(!haptics)}>Haptics {haptics ? 'on' : 'off'}</Button>
        <Stepper label="Sensitivity" value={sensitivity} change={setSensitivity} min={.5} max={2}/>
        <Button disabled={busy} onPress={() => task(async () => {
          const saved = await profileRequest(account.origin, '', { method: 'PATCH', token: account.token,
            body: { revision: account.profile.revision, preferences: { ...account.profile.preferences, hand, haptics, sensitivity } } });
          const updated = { ...account, profile: saved.profile }; setAccount(updated); await writePrivate('profile', updated);
        })}>Save preferences</Button>
        <Text style={styles.subheading}>Match history</Text>
        {history.length ? history.slice(0, 20).map((entry, index) => <Text key={entry.matchId || index} style={styles.copy}>{title(entry.sport)} · {entry.outcome || entry.status}{Number.isFinite(entry.score) ? ` · ${entry.score}` : ''}{Number.isFinite(entry.savedAt || entry.startedAt) ? ` · ${new Date(entry.savedAt || entry.startedAt).toLocaleDateString()}` : ''}</Text>) : <Text style={styles.copy}>No saved matches yet.</Text>}
        <Button quiet onPress={() => task(async () => { await profileRequest(account.origin, '/logout', { method: 'POST', token: account.token }); await writePrivate('profile', null); sessionRef.current?.setProfileToken(null); setAccount(null); })}>Sign out</Button>
      </> : <>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}/>
        <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}/>
        <Button disabled={busy} onPress={() => task(() => authenticate(false))}>Sign in</Button>
        <Button quiet disabled={busy} onPress={() => task(() => authenticate(true))}>Create optional account</Button>
      </>}
      <Button quiet onPress={() => setProfileOpen(false)}>Back to controller</Button>
    </View> : !seat ? <>
      <Text style={styles.heading}>Your next game{ '\n' }starts here.</Text><Text style={styles.copy}>Open Wee Sports on your TV, then scan its room code. You can also play entirely in your phone’s browser.</Text>
      {scanner && permission?.granted ? <View style={styles.cameraFrame}>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
          try { const scanned = parseRoomLink(data); setOrigin(scanned.origin); setCode(scanned.code); setScanner(false); setNotice('Room scanned. Check the server address and tap Join room.'); } catch (error) { setNotice(error.message); }
        }}/><Button quiet onPress={() => setScanner(false)}>Cancel scan</Button>
      </View> : <Button onPress={() => task(async () => { const granted = permission?.granted || (await requestPermission()).granted; if (!granted) throw new Error('Camera permission was denied. Enter the room below.'); setScanner(true); })}>Scan to play</Button>}
      <View style={styles.card}>
        <Text style={styles.subheading}>Or join manually</Text>
        <Field label="HTTPS game server" placeholder="https://your-game.example" value={origin} onChangeText={setOrigin} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
        <Field label="Room code" placeholder="K7PM" value={code} onChangeText={value => setCode(normalizeCode(value))} autoCapitalize="characters" maxLength={4}/>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={12}/>
        <Button disabled={busy || !origin || code.length !== 4 || !name.trim()} onPress={() => task(join)}>Join room</Button>
        <Button quiet disabled={!origin || code.length !== 4} onPress={() => task(async () => { const address = serverOrigin(origin.trim(), __DEV__); await Linking.openURL(`${address}/join?code=${encodeURIComponent(code)}`); })}>Continue in browser</Button>
      </View>
      {savedSession ? <Button quiet onPress={() => task(async () => { setOrigin(savedSession.origin); await (await makeSession(savedSession.origin)).restore(savedSession); })}>Reconnect to room {savedSession.code}</Button> : null}
      <Button quiet disabled={!origin} onPress={() => task(openProfile)}>Optional profile</Button>
    </> : <>
      <View style={styles.card}><Text style={styles.eyebrow}>ROOM {seat.code} · PLAYER {seat.slot + 1}</Text>
        <Text style={styles.heading}>{title(seat.sport)}</Text><Text style={styles.copy}>{player?.name || name} · {seat.phase === 'game' ? seat.paused ? 'Paused' : 'Playing' : 'Get ready'}</Text>
        <View style={styles.row}><Button quiet onPress={() => task(useTouch)}>Touch controls</Button><Button quiet onPress={() => task(calibrate)}>Calibrate motion</Button></View>
        {mode === 'motion' ? <>
          <Text style={styles.copy}>Hold the phone screen up with its top toward the TV. Keep a clear grip and room to move.</Text>
          <Text style={styles.meter}>{motionStatus.state === 'collecting' ? `Hold still · ${Math.round((motionStatus.progress || 0) * 100)}%` : motionStatus.state === 'moving' ? 'Hold still for calibration' : motionStatus.message || motionStatus.state}</Text>
          {['done', 'ready'].includes(motionStatus.state) && !setup ? <><Text style={styles.copy}>Tilt gently and check the direction. Recalibrate whenever your grip changes.</Text><Button onPress={() => task(() => setController('motion'))}>Confirm grip</Button></> : null}
          {motionStatus.achievedHz ? <Text style={styles.small}>{Math.round(motionStatus.achievedHz)} samples/s · largest gap {Math.round(motionStatus.largestGapMs)} ms</Text> : null}
        </> : <Text style={styles.copy}>Touch controls work without motion permission.</Text>}
        {['ready', 'countdown'].includes(seat.phase) ? <Button disabled={!setup || busy || status !== 'online'} onPress={() => task(async () => { result(await sessionRef.current.request(EVENTS.PLAYER_READY, { ready: !player?.ready })); buzz('ready'); })}>{player?.ready ? 'Not ready' : 'Ready'}</Button> : null}
        {seat.phase === 'countdown' ? <Text style={styles.meter}>Starting in {Math.ceil((seat.countdown?.msLeft || 0) / 1000)}</Text> : null}
        {seat.phase === 'vote' ? <Button onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.TUTORIAL_VOTE, { watch: false })))}>Skip tutorial and play</Button> : null}
      </View>
      {seat.sport === 'bowling' ? <View style={styles.card}>
        <Text style={styles.subheading}>{seat.gameState?.phase === 'complete' ? 'Match complete' : `Frame ${seat.gameState?.frame || 1} of 10`}</Text>
        {rollState ? <Button quiet onPress={() => task(checkRoll)}>Check previous roll outcome</Button> : null}
        {mode === 'touch' ? <><Stepper label="Aim" value={aim} change={value => { setAim(value); sessionRef.current.latest('aim', { aim: value, locked: false }); }}/><Stepper label="Power" value={power} change={setPower} min={.2}/><Stepper label="Curve" value={spin} change={setSpin}/>
          <Button disabled={!canRoll || busy} onPress={() => task(() => release())}>Roll</Button></> : <>
          <Text style={styles.meter}>Aim {Math.round((motionStatus.aim || 0) * 100)}%</Text>
          <Button disabled={!canRoll || setup !== 'motion'} onPress={() => { if (motionRef.current?.arm()) { buzz('ready'); setNotice('Aim locked. Make one forward underhand delivery.'); } }}>Arm delivery</Button>
          <Button quiet onPress={() => { motionRef.current?.recenter(); setNotice('Delivery cancelled'); }}>Cancel / recenter</Button>
        </>}
        {seat.slot === 0 && seat.gameState?.phase === 'complete' ? <Button onPress={() => task(() => command('new-match'))}>Play another match</Button> : null}
      </View> : seat.sport === 'table-tennis' ? <View style={styles.card}>
        <Text style={styles.subheading}>Compact strokes. Real contact.</Text>
        {mode === 'touch' ? <View accessibilityLabel="Touch paddle. Drag to position and move the paddle." style={styles.touchPad}
          onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={event => touchPose(event, true)} onResponderMove={event => touchPose(event)}
          onResponderRelease={() => { if (touch.current) sessionRef.current.latest('pose', { orientation: [0, 0, 0, 1], angularVelocity: { x: 0, y: 0, z: 0 }, reach: touch.current.reach, calibrationRevision: 0 }); touch.current = null; }}>
          <Text style={styles.touchText}>Drag to move your paddle</Text>
        </View> : <Text style={styles.copy}>Keep strokes compact. Recenter between points.</Text>}
        <View style={styles.row}><Button disabled={!playable} onPress={() => task(() => command('feed'))}>Feed / serve</Button><Button quiet disabled={!playable} onPress={() => task(async () => { motionRef.current?.recenter(); await command('recenter'); })}>Recenter</Button></View>
        {seat.slot === 0 ? <><Button quiet disabled={!playable} onPress={() => task(() => command('practice-start'))}>Practice feeds</Button><Button quiet disabled={!playable} onPress={() => task(() => command('new-match'))}>Play the bot</Button></> : null}
      </View> : <View style={styles.card}><Text style={styles.copy}>Use touch controls for the existing tennis game.</Text>
        {['Forehand', 'Backhand'].map(label => <Button key={label} disabled={!playable} onPress={() => task(async () => result(await sessionRef.current.action(EVENTS.PLAYER_SWING, { type: 'swing', label, hand, power })))}>{label}</Button>)}
      </View>}
      {seat.slot === 0 ? <View style={styles.card}><Button quiet disabled={!seat.gameId} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_PAUSE, { gameId: seat.gameId, paused: !seat.paused })))}>{seat.paused ? 'Resume game' : 'Pause game'}</Button>
        <Button quiet disabled={!seat.gameId} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId: seat.gameId })))}>Return to lobby</Button>
        {seat.phase !== 'game' ? ['bowling', 'table-tennis', 'tennis'].filter(sport => sport !== seat.sport).map(sport => <Button quiet key={sport} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_SWITCH_SPORT, { sport, gameId: seat.gameId })))}>Switch to {title(sport)}</Button>) : null}
      </View> : null}
      <Button quiet onPress={() => task(openProfile)}>Profile & preferences</Button>
      <Button quiet onPress={() => task(async () => { motionRef.current?.stop(); await sessionRef.current.leave(); setSetup(null); })}>Leave room</Button>
    </>}
    <Text style={styles.footer}>The TV owns the game. Your phone brings the motion.</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101626' }, page: { padding: 22, paddingBottom: 44, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 24, fontWeight: '900', color: '#fff' }, brandAccent: { color: '#a6e8cf' },
  pill: { color: '#b9a9ff', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, status: { color: '#a6e8cf', fontSize: 13 },
  heading: { color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -.8 }, subheading: { color: '#f6f5ff', fontSize: 20, fontWeight: '700' },
  copy: { color: '#b6c0d6', fontSize: 15, lineHeight: 23 }, small: { color: '#95a4bd', fontSize: 12 },
  card: { backgroundColor: '#1b2337', borderRadius: 22, padding: 20, gap: 15, borderWidth: 1, borderColor: '#2b354e' },
  eyebrow: { color: '#a6e8cf', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 }, field: { gap: 7 }, label: { color: '#ced6e8', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#11182a', borderWidth: 1, borderColor: '#38445f', borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  button: { minHeight: 48, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#a6e8cf', alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  buttonText: { color: '#153328', fontWeight: '800', fontSize: 15, textAlign: 'center' }, quietButton: { backgroundColor: '#29334d', borderWidth: 1, borderColor: '#3a4666' }, quietText: { color: '#e0e5f4' }, disabled: { opacity: .4 }, pressed: { opacity: .7 },
  notice: { color: '#e7dcff', backgroundColor: '#302945', borderRadius: 12, padding: 14, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, stepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  meter: { color: '#a6e8cf', fontWeight: '700', fontSize: 18 }, cameraFrame: { gap: 12 }, camera: { height: 300, borderRadius: 20, overflow: 'hidden' },
  touchPad: { width: 300, maxWidth: '100%', height: 180, borderRadius: 20, borderWidth: 1, borderColor: '#89cbb8', backgroundColor: '#1a3e3a', alignItems: 'center', justifyContent: 'center' }, touchText: { color: '#a6e8cf', fontWeight: '600' },
  footer: { textAlign: 'center', color: '#7f8da7', fontSize: 12, marginTop: 10, lineHeight: 20 },
});
