import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Gyroscope } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import { EVENTS, isGameOptions, normalizeCode } from '../../shared/protocol.js';
import { createControllerCapabilities } from '../../shared/controllerCapabilities.js';
import { ControllerSession, parseRoomLink, serverOrigin } from './src/session.js';
import { NativeMotionController } from './src/motion.js';
import { profileRequest, readPrivate, writePrivate } from './src/storage.js';
import { createGuestClaimVault } from './src/guestClaims.js';
import { AutomaticControllerSetup } from './src/automaticSetup.js';
import { TouchPaddleStream } from './src/touchPaddle.js';
import { NativeBowlingActions } from './src/bowlingActions.js';
import {CONTROLLER_SPORTS, matchSummary, sportChoice, sportTitle as title} from './src/controllerPresentation.js';

const sportArtwork = {tennis:require('./assets/sports/tennis.png'),'table-tennis':require('./assets/sports/table-tennis.png'),
  bowling:require('./assets/sports/bowling.png'),golf:require('./assets/sports/golf.png')};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const guestClaims = createGuestClaimVault({read: () => readPrivate('guestClaims'), write: values => writePrivate('guestClaims', values)});
function Button({ children, onPress, disabled, quiet = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:Boolean(disabled)}} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, quiet && styles.quietButton, disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, quiet && styles.quietText]}>{children}</Text>
  </Pressable>;
}
function SportMark({sport,size=56}) {return <Image accessible={false} source={sportArtwork[sport] || sportArtwork.tennis} style={{width:size,height:size}} resizeMode="contain"/>;}
function SportTile({sport,seat,disabled,onPress}) {
  const choice=sportChoice(sport,seat),selected=seat?.sport===sport;
  const locked=disabled || !choice.available || !choice.fits || selected;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${choice.title}, ${choice.caption}`} accessibilityState={{disabled:Boolean(locked),selected}}
    disabled={locked} onPress={onPress} style={({pressed})=>[styles.sportTile,selected && styles.sportSelected,!choice.available && styles.comingSoon,pressed && styles.pressed]}>
    <SportMark sport={sport} size={42}/><Text style={styles.tileTitle}>{choice.title}{selected ? ' ✓' : ''}</Text><Text style={styles.small}>{choice.caption}</Text>
  </Pressable>;
}
function MatchSummary({summary}) {
  if(!summary)return null;
  return <View style={styles.scoreCard} accessibilityLiveRegion="polite">
    <Text style={styles.eyebrow}>{summary.result || summary.label}</Text>
    {summary.score ? <View style={styles.scoreRow}>{summary.score.map((points,index)=><View key={index} style={styles.scoreSide}><Text style={styles.scoreValue}>{points}</Text><Text numberOfLines={1} style={styles.small}>{summary.names[index]}</Text></View>)}</View> : null}
    {summary.tally ? <Text style={styles.scoreDetail}>{summary.tally}</Text> : null}<Text style={styles.small}>{summary.detail}</Text>
  </View>;
}
function Field({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#8792aa" style={styles.input} {...props}/></View>;
}
function Stepper({ label, value, change, min = -1, max = 1, step = .1 }) {
  return <View style={styles.stepper}><Text style={styles.label}>{label} {Math.round(value * 100)}%</Text>
    <View style={styles.row}><Button quiet onPress={() => change(clamp(value - step, min, max))}>−</Button><Button quiet onPress={() => change(clamp(value + step, min, max))}>+</Button></View></View>;
}
function KeepControllerAwake() { useKeepAwake('wee-controller', {suppressDeactivateWarnings:true}); return null; }

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
  const [playIntent, setPlayIntent] = useState(true);
  const [mode, setMode] = useState('motion');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [motionStatus, setMotionStatus] = useState({ state: 'off' });
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(.55);
  const [spin, setSpin] = useState(0);
  const [rollState, setRollState] = useState(null);
  const [hand, setHand] = useState('Right');
  const [haptics, setHaptics] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [strokeMode, setStrokeMode] = useState('auto');
  const [padDragging, setPadDragging] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef(null);
  const sessionRef = useRef(null), motionRef = useRef(null), hapticsRef = useRef(true), flowRef = useRef(null);
  const scanLock = useRef(false), preferencesRef = useRef({hand,sensitivity,strokeMode});
  const padSize = useRef({width:300,height:180});
  preferencesRef.current = {hand,sensitivity,strokeMode};
  const boundaryRef = useRef(null);
  const rollActions = useRef(null), touchStream = useRef(null);
  if (!rollActions.current) rollActions.current = new NativeBowlingActions({
    session:() => sessionRef.current, changed:setRollState, notice:setNotice,
    retry:session => {if (sessionRef.current === session) motionRef.current?.allowNewDelivery();},
  });
  if (!touchStream.current) touchStream.current = new TouchPaddleStream({
    send: pose => sessionRef.current?.latest('pose', pose),
    playing: () => sessionRef.current?.playing() && sessionRef.current.inputSetup === 'buttons' && sessionRef.current.seat?.sport === 'table-tennis' && sessionRef.current.seat?.gameState?.phase!=='complete',
  });
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
    readPrivate('controllerPreferences').then(value => {
      if (['Right','Left'].includes(value?.hand)) setHand(value.hand);
      if (Number.isFinite(value?.sensitivity) && value.sensitivity>=.5 && value.sensitivity<=2) setSensitivity(value.sensitivity);
      if (typeof value?.haptics==='boolean') setHaptics(value.haptics);
      if (typeof value?.name==='string' && value.name.trim()) setName(value.name.slice(0,12));
    }).catch(() => {}).finally(() => setPreferencesLoaded(true));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        flowRef.current?.stop(); setSetup(null); setMotionStatus({ state: 'off' }); setScanner(false);
        endTouch();
        touchStream.current.stop();
        sessionRef.current?.background();
      } else if (state === 'inactive') {
        // Permission sheets are inactive too. Keep pending motion permission
        // and the room alive, but discard gestures while the sheet is open.
        endTouch(); motionRef.current?.resetInput(); sessionRef.current?.inactive();
      } else if (state === 'active') {
        motionRef.current?.resetInput(); sessionRef.current?.foreground();
      }
    });
    return () => { subscription.remove(); flowRef.current?.stop(); rollActions.current.reset(false); sessionRef.current?.dispose(); touchStream.current.stop(); };
  }, []);
  useEffect(() => {sessionRef.current?.configure({hand}); motionRef.current?.updatePreferences({hand,sensitivity,strokeMode});}, [hand,sensitivity,strokeMode]);
  useEffect(() => {if (preferencesLoaded) writePrivate('controllerPreferences',{hand,sensitivity,haptics,name}).catch(() => {});}, [preferencesLoaded,hand,sensitivity,haptics,name]);
  useEffect(() => {scrollRef.current?.scrollTo({y:0,animated:false});}, [optionsOpen,profileOpen,scanner]);
  useEffect(() => {
    const active=!optionsOpen && !profileOpen;
    sessionRef.current?.setControlsActive(active);
    endTouch();
    if(active) motionRef.current?.resetInput();
  }, [optionsOpen,profileOpen]);
  useEffect(() => {setConfirmReset(false);}, [seat?.gameId,seat?.sport]);

  useEffect(() => {
    if (!seat || seat.paused || !['game', 'ready', 'countdown'].includes(seat.phase)) motionRef.current?.resetInput();
  }, [seat?.gameState?.phase, seat?.phase, seat?.paused]);
  async function makeSession(address) {
    flowRef.current?.stop(); rollActions.current.reset(); sessionRef.current?.dispose(); touchStream.current.stop(); touchStream.current.reset(); setSetup(null);
    const savedProfile = await readPrivate('profile').catch(() => null);
    if (savedProfile?.origin === address && savedProfile.profile?.preferences) {
      const saved = savedProfile.profile.preferences;
      setHand(saved.hand); setSensitivity(saved.sensitivity); setHaptics(saved.haptics);
      preferencesRef.current = {...preferencesRef.current, hand:saved.hand, sensitivity:saved.sensitivity};
    }
    const session = new ControllerSession(address, {
      profileToken: savedProfile?.origin === address ? savedProfile.token : null,
      save: value => writePrivate('room', value).catch(() => setNotice('Secure storage is unavailable. Keep the app open to retain this room.')),
      saveClaim: (address, claim) => guestClaims.remember(address, claim),
      changed: (next, connection) => {
        rollActions.current.observe();
        const boundary = next ? `${next.gameId}:${next.inputGeneration}:${next.hostEpoch}` : null;
        if (boundary !== boundaryRef.current) { motionRef.current?.resetInput(); touchStream.current.reset(); }
        boundaryRef.current = boundary;
        const currentPlayer = next?.players?.find(value => value.slot === next.slot);
        if (currentPlayer?.setup === null) setSetup(null);
        setSeat(next); setStatus(connection);
        if (connection !== 'online') { setSetup(null); touchStream.current.stop(); }
        flowRef.current?.update(next, connection);
      },
      feedback: () => buzz('contact'),
    });
    sessionRef.current = session;
    session.configure({hand:preferencesRef.current.hand});
    session.setControlsActive(!optionsOpen && !profileOpen);
    flowRef.current = new AutomaticControllerSetup({session,notice:setNotice,
      changed: update => {
        setMode(update.mode); setSetup(update.setup);
        if (update.playIntent !== undefined) setPlayIntent(update.playIntent);
        setMotionStatus(previous => ({...previous,...update}));
        // Resume the touch heartbeat from accepted session state too. A quick
        // background/foreground cycle may batch React state to the same values.
        if (update.setup === 'buttons' && session.playing() && session.seat?.sport === 'table-tennis' && session.seat?.gameState?.phase!=='complete') touchStream.current.start();
        else touchStream.current.stop();
      },
      makeMotion: onStatus => {
        const motion = new NativeMotionController({session,...preferencesRef.current,onStatus,
          onRelease: roll => { buzz('recognized'); release(roll).catch(error => setNotice(error.message)); },
          onSwing: swing => {
            buzz('recognized');
            session.action(EVENTS.PLAYER_SWING, swing).then(response => {
              if (!response.ok && !['not-playing','not-your-turn'].includes(response.error)) setNotice('That swing could not reach the TV. Try your next swing when connected.');
            });
          },
        });
        motionRef.current = motion;
        return motion;
      },
    });
    if(savedProfile?.origin===address && savedProfile.profile?.preferences?.touchControls) flowRef.current.select('touch');
    return session;
  }

  async function join(room = {origin,code}) {
    const address = serverOrigin(room.origin.trim(), __DEV__);
    const session = await makeSession(address);
    const motionAvailable = await Gyroscope.isAvailableAsync().catch(() => false);
    result(await session.join(room.code, name.trim() || 'Player', createControllerCapabilities({
      sports: ['tennis', 'bowling', 'table-tennis'], motion: motionAvailable, orientation: motionAvailable, haptics, buttons: true })));
    setOrigin(address); setScanner(false); setOptionsOpen(false); setProfileOpen(false); setSavedSession(null); buzz('ready');
  }
  async function release(roll = { aim, power, spin }) {
    await rollActions.current.release(roll);
  }
  async function checkRoll() {
    await rollActions.current.check();
  }
  const command = async (action, extra = {}) => result(await sessionRef.current.action(EVENTS.PLAYER_GAME_COMMAND, { action, ...extra }));
  function touchPose(event, start = false) {
    const { locationX, locationY } = event.nativeEvent;
    const {width,height} = padSize.current;
    const reach = { x: clamp(locationX / width * 2 - 1, -1, 1), y: clamp(1 - locationY / height * 2, -1, 1) };
    touchStream.current.move(reach, start);
  }
  function endTouch() {
    setPadDragging(false);
    touchStream.current.release();
  }
  async function openProfile() {
    const saved = await readPrivate('profile');
    const address = origin || saved?.origin || savedSession?.origin;
    setProfileOpen(true);
    if (!address) {setAccount(null); return;}
    setOrigin(address);
    if (saved?.origin !== address) { setAccount(null); return; }
    const current = await profileRequest(address, '', { token: saved.token });
    await sessionRef.current?.captureGuestClaim();
    await guestClaims.claimFor(address, claim => profileRequest(address, '/claim', {method:'POST',token:saved.token,body:{claim}}));
    setAccount({ ...saved, profile: current.profile });
    setHistory((await profileRequest(address, '/history', { token: saved.token })).history || []);
  }
  async function scanTv() {
    const granted=permission?.granted || (await requestPermission()).granted;
    if(!granted) {setManualOpen(true);throw new Error('Camera permission is off. Enter the room code, or allow Camera in Settings.');}
    if(sessionRef.current?.seat) {await sessionRef.current.leave();flowRef.current?.stop();setSetup(null);}
    setOptionsOpen(false);setProfileOpen(false);setScanner(true);
  }
  function backToPlay() {setProfileOpen(false);setOptionsOpen(false);setConfirmReset(false);}
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
  const isLeader = seat?.slot === (seat?.leaderSlot ?? 0);
  const inLobby = ['lobby','vote','ready'].includes(seat?.phase);
  const playable = seat?.phase === 'game' && !seat.paused && status === 'online';
  const canRoll = playable && !optionsOpen && !profileOpen && seat?.gameState?.phase === 'ready' && seat?.gameState?.currentPlayer === seat.slot + 1;
  const summary = matchSummary(seat);
  const completed = seat?.gameState?.phase === 'complete';
  const gameOptions = seat?.gameOptions?.gameId === seat?.gameId && isGameOptions(seat?.gameOptions,seat?.sport) ? seat.gameOptions : null;
  const settings = gameOptions?.settings;
  const optionsLocked = !playable || !isLeader || !gameOptions || busy;
  const newMatch = () => command('new-match',seat?.sport === 'tennis' ? {format:'full'} : {});
  const configure = (key,value) => command('configure',{settings:{[key]:value}});
  useEffect(() => {
    if (playable && !completed && seat?.sport === 'table-tennis' && mode === 'touch' && setup === 'buttons') touchStream.current.start();
    else { touchStream.current.stop(); setPadDragging(false); }
    return () => touchStream.current.stop();
  }, [playable,completed,seat?.sport,mode,setup]);
  useEffect(() => {
    if (canRoll && mode === 'touch' && setup) sessionRef.current?.latest('aim', {aim,locked:false});
  }, [canRoll,mode,setup,aim]);
  return <SafeAreaView style={styles.safe}>{seat ? <KeepControllerAwake /> : null}<ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" scrollEnabled={!padDragging}>
    <View style={styles.header}><View><Text style={styles.brand}>wee<Text style={styles.brandAccent}> sports</Text></Text><Text style={styles.pill}>YOUR CONTROLLER</Text></View>
      {!optionsOpen && !profileOpen ? <Button quiet onPress={() => setOptionsOpen(true)}>Tools</Button> : null}</View>
    <Text accessibilityLiveRegion="polite" style={styles.status}>{status === 'online' ? '● Connected to your TV' : status === 'offline' ? 'Reconnecting to your TV…' : status === 'suspended' ? 'Return to the app to reconnect' : status}</Text>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {profileOpen ? <View style={styles.card}>
      <Text style={styles.heading}>Your profile</Text><Text style={styles.copy}>Your preferences and match history. Guest play is always available.</Text>
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
        {!origin ? <><Text style={styles.copy}>Connect to your TV once to use its profile and match history.</Text><Button onPress={() => task(scanTv)}>Scan TV code</Button></> : null}
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}/>
        <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}/>
        <Button disabled={busy || !origin} onPress={() => task(() => authenticate(false))}>Sign in</Button>
        <Button quiet disabled={busy || !origin} onPress={() => task(() => authenticate(true))}>Create optional account</Button>
      </>}
    </View> : optionsOpen ? <>
      <View style={styles.card}><Text style={styles.eyebrow}>{seat ? `${title(seat.sport)} · ROOM ${seat.code}` : 'YOUR PHONE'}</Text><Text style={styles.heading}>Tools</Text>
        <Text style={styles.copy}>A few adjustments, then back to play.</Text>
        {seat ? <View style={styles.row}><Button quiet disabled={mode==='motion' && Boolean(setup)} onPress={() => flowRef.current?.select('motion')}>Motion{mode==='motion' ? ' ✓' : ''}</Button><Button quiet disabled={mode==='touch' && Boolean(setup)} onPress={() => flowRef.current?.select('touch')}>Touch{mode==='touch' ? ' ✓' : ''}</Button></View> : <Field label="Your playing name" value={name} onChangeText={setName} maxLength={12}/>}
        <Button quiet onPress={() => setHand(hand==='Right' ? 'Left' : 'Right')}>{hand} handed</Button>
        <Stepper label="Sensitivity" value={sensitivity} change={setSensitivity} min={.5} max={2}/>
        <Button quiet onPress={() => setHaptics(!haptics)}>Haptics {haptics ? 'on' : 'off'}</Button>
        {seat && typeof seat.soundMuted==='boolean' ? <Button quiet disabled={status!=='online' || busy} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.SOUND_SET,{muted:!seat.soundMuted})))}>TV sound {seat.soundMuted ? 'off' : 'on'}</Button> : null}
        {seat && mode==='motion' ? <Button quiet onPress={() => motionRef.current?.recenter()}>Center motion</Button> : null}
        {seat?.sport==='tennis' && mode==='motion' ? <View style={styles.row}>{['auto','Forehand','Backhand'].map(value=><Button quiet key={value} onPress={() => setStrokeMode(value)}>{value==='auto' ? 'Automatic strokes' : `Simple ${value.toLowerCase()}`}{strokeMode===value ? ' ✓' : ''}</Button>)}</View> : null}
        {seat?.sport==='bowling' && mode==='touch' ? <><Stepper label="Power" value={power} change={setPower} min={.2}/><Stepper label="Curve" value={spin} change={setSpin}/></> : null}
      </View>
      {seat && isLeader && seat.phase==='game' ? <View style={styles.card}><Text style={styles.subheading}>Game options</Text>
        <Button quiet disabled={status!=='online' || (completed && !seat.manuallyPaused)} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_PAUSE,{gameId:seat.gameId,paused:!seat.manuallyPaused})))}>{seat.manuallyPaused ? 'Resume game' : 'Pause game'}</Button>
        {gameOptions ? <>
          {seat.sport==='tennis' ? <>
            <Button quiet disabled={optionsLocked} onPress={() => task(() => configure('assistance',settings.assistance==='beginner' ? 'standard' : 'beginner'))}>Timing: {settings.assistance==='beginner' ? 'Easier' : 'Standard'}</Button>
            {!gameOptions.humanOpponent ? <Button quiet disabled={optionsLocked} onPress={() => task(() => configure('botDifficulty',settings.botDifficulty==='beginner' ? 'standard' : 'beginner'))}>Bot: {settings.botDifficulty==='beginner' ? 'Easier' : 'Standard'}</Button> : null}
          </> : seat.sport==='table-tennis' ? <Button quiet disabled={optionsLocked} onPress={() => task(() => configure('assistance',settings.assistance==='friendly' ? 'standard' : 'friendly'))}>Assistance: {settings.assistance==='friendly' ? 'Friendly' : 'Standard'}</Button> : null}
          {seat.players.length===1 ? <Button quiet disabled={optionsLocked} onPress={() => task(() => command(gameOptions.practice?.active ? 'practice-stop' : 'practice-start',seat.sport==='tennis' && !gameOptions.practice?.active ? {stroke:'alternate',hand} : {}))}>{gameOptions.practice?.active ? seat.sport==='tennis' ? 'Return to match' : 'Start a scored game' : seat.sport==='tennis' ? 'Practice returns' : 'Practice · resets score'}</Button> : null}
          {confirmReset ? <><Text style={styles.copy}>Start again with a fresh score for everyone?</Text><Button disabled={optionsLocked} onPress={() => task(async () => {await newMatch();setConfirmReset(false);backToPlay();})}>Reset score and start</Button><Button quiet onPress={() => setConfirmReset(false)}>Keep this game</Button></> : <Button quiet disabled={optionsLocked} onPress={() => setConfirmReset(true)}>New match</Button>}
        </> : <Text style={styles.copy}>Waiting for the TV’s game options…</Text>}
      </View> : null}
      <View style={styles.card}><Text style={styles.subheading}>Your controller</Text>
        <Button quiet onPress={() => task(openProfile)}>Profile & history</Button>
        {isLeader && ['countdown','vote','tutorial','game'].includes(seat?.phase) ? <Button quiet disabled={status!=='online'} onPress={() => task(async () => {result(await sessionRef.current.request(EVENTS.PLAYER_RETURN_TO_LOBBY,{gameId:seat.gameId}));backToPlay();})}>Return to lobby</Button> : null}
        <Button quiet disabled={busy || Boolean(seat && status!=='online')} onPress={() => task(scanTv)}>{seat ? 'Leave & scan another TV' : 'Scan TV code'}</Button>
        {seat ? <Button quiet onPress={() => task(async () => {await sessionRef.current.leave();flowRef.current?.stop();setSetup(null);backToPlay();})}>Leave room</Button> : null}
      </View>
    </> : !seat ? <>
      <View style={styles.homeLead}><View style={styles.sportPreview}>{CONTROLLER_SPORTS.map(sport=><View key={sport} style={styles.previewIcon}><SportMark sport={sport} size={44}/><Text style={styles.previewLabel}>{title(sport)}</Text></View>)}</View>
      <Text style={styles.heading}>Ready to play?</Text><Text style={styles.copy}>Connect to your TV. Your phone does the rest.</Text></View>
      {scanner && permission?.granted ? <View style={styles.cameraFrame}>
        <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
          if (scanLock.current) return;
          try {
            const scanned = parseRoomLink(data); scanLock.current = true;
            setOrigin(scanned.origin); setCode(scanned.code); setScanner(false);
            task(() => join(scanned)).finally(() => {scanLock.current = false;});
          } catch (error) { setNotice(error.message); }
        }}/><Button quiet onPress={() => setScanner(false)}>Cancel scan</Button>
      </View> : <Button disabled={busy} onPress={() => task(scanTv)}>Scan TV code</Button>}
      <Button quiet onPress={() => setManualOpen(!manualOpen)}>{manualOpen ? 'Close' : 'Enter room code'}</Button>
      {manualOpen ? <View style={styles.card}>
        <Field label="HTTPS game server" placeholder="https://your-game.example" value={origin} onChangeText={setOrigin} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
        <Field label="Room code" placeholder="K7PM" value={code} onChangeText={value => setCode(normalizeCode(value))} autoCapitalize="characters" maxLength={4}/>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={12}/>
        <Button disabled={busy || !origin || code.length !== 4} onPress={() => task(() => join())}>Play</Button>
        <Button quiet disabled={!origin || code.length !== 4} onPress={() => task(async () => { const address = serverOrigin(origin.trim(), __DEV__); await Linking.openURL(`${address}/join?code=${encodeURIComponent(code)}`); })}>Continue in browser</Button>
      </View> : null}
      {savedSession ? <Button quiet onPress={() => task(async () => { setOrigin(savedSession.origin); await (await makeSession(savedSession.origin)).restore(savedSession); })}>Reconnect to room {savedSession.code}</Button> : null}
      <Button quiet onPress={() => task(openProfile)}>Profile & history</Button><Text style={styles.small}>No account needed to play. Golf is coming soon.</Text>
    </> : <>
      <View style={styles.card}><Text style={styles.eyebrow}>ROOM {seat.code} · PLAYER {seat.slot + 1}</Text>
        <View style={styles.sportHeading}><SportMark sport={seat.sport} size={54}/><Text style={[styles.heading,styles.sportHeadingText]}>{title(seat.sport)}</Text></View>
        {setup ? <Text style={styles.small}>{mode === 'motion' ? 'Motion controls are on' : 'Touch controls are on'}</Text> : null}
        <Text style={styles.copy}>{seat.paused ? 'Game paused' : !setup ? 'Getting ready…' : seat.phase === 'game' ? 'Watch the TV. You’re in.' : playIntent ? isLeader ? 'Start when everyone is in.' : 'Ready. Waiting for the group to start.' : 'Ready when you are.'}</Text>
        {mode === 'touch' && motionStatus.motionIssue ? <>
          <Text style={styles.small}>{motionStatus.motionIssue.message}</Text>
          <Button quiet onPress={() => {setNotice(''); flowRef.current?.select('motion');}}>Try motion again</Button>
          {motionStatus.motionIssue.code === 'permission-denied' ? <Button quiet onPress={() => task(() => Linking.openSettings())}>Open Settings</Button> : null}
        </> : null}
        {isLeader && inLobby ? <>
          <View style={styles.sportGrid}>{CONTROLLER_SPORTS.map(sport => <SportTile key={sport} sport={sport} seat={seat} disabled={busy || status !== 'online' || seat.phase === 'vote'}
            onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_SWITCH_SPORT,{sport,gameId:seat.gameId})))}/>)}</View>
          {seat.players.length > 2 ? <Text style={styles.small}>Tennis and table tennis support up to 2 players.</Text> : null}
          <Button disabled={busy || status !== 'online' || !seat.canStart || !setup} onPress={() => task(async () => result(await flowRef.current.startGame()))}>Start game</Button>
        </> : null}
        {seat.phase === 'countdown' ? <Text style={styles.meter}>Starting in {Math.ceil((seat.countdown?.msLeft || 0) / 1000)}</Text> : null}
        {inLobby ? <Text style={styles.small}>{seat.players?.map(joined=>`${joined.name}${joined.ready ? ' ✓' : ''}`).join(' · ')}</Text> : null}
      </View>
      <MatchSummary summary={summary}/>
      {!inLobby && !completed ? seat.sport === 'bowling' ? <View style={styles.card}>
        {rollState?.status === 'unknown' ? <Button quiet onPress={() => {setNotice(''); checkRoll().catch(error => setNotice(error.message));}}>Check previous roll outcome</Button> : null}
        {mode === 'touch' ? <><Stepper label="Aim" value={aim} change={setAim}/>
          <Button disabled={!canRoll || !setup || Boolean(rollState)} onPress={() => {setNotice(''); release().catch(error => setNotice(error.message));}}>{rollState ? 'Watch the TV' : 'Roll'}</Button></> : <View style={styles.playCue}>
          <SportMark sport="bowling" size={112}/>
          <Text style={styles.subheading}>{canRoll ? 'Swing to roll' : 'Watch the TV'}</Text>
          <Text style={styles.copy}>Screen up. Tilt to aim, then swing gently forward.</Text>
        </View>}
      </View> : seat.sport === 'table-tennis' ? <View style={styles.card}>
        <Text style={styles.subheading}>{mode === 'touch' ? 'Your paddle' : 'Swing to play'}</Text>
        {mode === 'touch' ? <View accessibilityLabel="Touch paddle. Drag to position and move the paddle." style={styles.touchPad}
          onLayout={({nativeEvent}) => {padSize.current = nativeEvent.layout;}}
          onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={event => {setPadDragging(true); touchPose(event, true);}} onResponderMove={event => touchPose(event)}
          onResponderRelease={endTouch} onResponderTerminate={endTouch}>
          <Text style={styles.touchText}>Drag to move your paddle</Text>
        </View> : <View style={styles.playCue}><SportMark sport="table-tennis" size={112}/><Text style={styles.copy}>Small swings. Keep your eyes on the TV.</Text></View>}
      </View> : <View style={styles.card}>
        {mode === 'motion' ? <View style={styles.playCue}><SportMark sport="tennis" size={112}/><Text style={styles.subheading}>Swing to play</Text><Text style={styles.copy}>{strokeMode === 'auto' ? 'Forehand or backhand. Watch the ball on your TV.' : `Small swings play a ${strokeMode.toLowerCase()}.`}</Text></View>
          : <>{['Forehand', 'Backhand'].map(label => <Button key={label} disabled={!playable || !setup} onPress={() => task(async () => result(await sessionRef.current.action(EVENTS.PLAYER_SWING, { type: 'swing', label, hand, power })))}>{label}</Button>)}</>}
      </View> : null}
      {isLeader && seat.manuallyPaused ? <Button disabled={status!=='online'} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_PAUSE,{gameId:seat.gameId,paused:false})))}>Resume game</Button> : null}
      {completed && isLeader ? <Button disabled={!playable || busy} onPress={() => task(newMatch)}>Play again</Button> : null}
      {isLeader && (completed || ['countdown','vote','tutorial'].includes(seat.phase)) ? <Button quiet disabled={status!=='online'} onPress={() => task(async () => result(await sessionRef.current.request(EVENTS.PLAYER_RETURN_TO_LOBBY,{gameId:seat.gameId})))}>Back to lobby</Button> : null}
    </>}
    <Text style={styles.footer}>Watch the TV. Play with your phone.</Text>
  </ScrollView>{optionsOpen || profileOpen ? <View style={styles.backDock}><Button onPress={backToPlay}>{seat ? inLobby ? 'Back to lobby' : 'Back to play' : 'Back to controller'}</Button></View> : null}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101626' }, page: { width:'100%',maxWidth:540,alignSelf:'center',padding: 20, paddingBottom: 28, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { fontSize: 24, fontWeight: '900', color: '#fff' }, brandAccent: { color: '#a6e8cf' },
  pill: { color: '#b9a9ff', fontSize: 10, fontWeight: '800', letterSpacing: 1.2,marginTop:4 }, status: { color: '#a6e8cf', fontSize: 13 },
  heading: { color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -.8 }, subheading: { color: '#f6f5ff', fontSize: 20, fontWeight: '700' },
  copy: { color: '#c2cbdd', fontSize: 15, lineHeight: 23 }, small: { color: '#aab7ce', fontSize: 12,lineHeight:19 },
  card: { backgroundColor: '#1b2337', borderRadius: 22, padding: 20, gap: 15, borderWidth: 1, borderColor: '#2b354e' },
  eyebrow: { color: '#a6e8cf', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 }, field: { gap: 7 }, label: { color: '#ced6e8', fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: '#11182a', borderWidth: 1, borderColor: '#38445f', borderRadius: 12, color: '#fff', paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  button: { minHeight: 54, paddingVertical: 15, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#a6e8cf', alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  buttonText: { color: '#153328', fontWeight: '800', fontSize: 15, textAlign: 'center' }, quietButton: { backgroundColor: '#29334d', borderWidth: 1, borderColor: '#3a4666' }, quietText: { color: '#e0e5f4' }, disabled: { opacity: .4 }, pressed: { opacity: .7 },
  notice: { color: '#e7dcff', backgroundColor: '#302945', borderRadius: 12, padding: 14, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, stepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  meter: { color: '#a6e8cf', fontWeight: '700', fontSize: 18 }, cameraFrame: { gap: 12 }, camera: { height: 300, borderRadius: 20, overflow: 'hidden' },
  touchPad: { width: '100%', height: 200, borderRadius: 20, borderWidth: 1, borderColor: '#89cbb8', backgroundColor: '#1a3e3a', alignItems: 'center', justifyContent: 'center' }, touchText: { color: '#a6e8cf', fontWeight: '600' },
  playCue: { minHeight:220,alignItems:'center',justifyContent:'center',gap:16 },
  backDock:{paddingHorizontal:20,paddingTop:12,paddingBottom:12,borderTopWidth:1,borderTopColor:'#33405a',backgroundColor:'#151e31',width:'100%',maxWidth:540,alignSelf:'center'},
  homeLead:{gap:16,alignItems:'center',paddingVertical:18},sportPreview:{flexDirection:'row',width:'100%',paddingBottom:16},previewIcon:{flex:1,alignItems:'center',gap:8},previewLabel:{fontSize:10,color:'#aab7ce',textAlign:'center'},
  sportGrid:{flexDirection:'row',flexWrap:'wrap',gap:12},sportTile:{flexBasis:'46%',flexGrow:1,alignItems:'center',justifyContent:'center',minHeight:124,padding:12,gap:6,borderWidth:1,borderColor:'#3a4666',borderRadius:18,backgroundColor:'#202c43'},
  sportSelected:{backgroundColor:'#1a3e3a',borderColor:'#a6e8cf'},comingSoon:{opacity:.55},tileTitle:{color:'#eff5ff',fontSize:14,fontWeight:'700',textAlign:'center'},
  sportHeading:{flexDirection:'row',alignItems:'center',gap:14},sportHeadingText:{flex:1,fontSize:28,lineHeight:34},
  scoreCard:{padding:16,gap:8,borderRadius:20,backgroundColor:'#172c32',alignItems:'center'},scoreRow:{flexDirection:'row',width:'100%',gap:12},scoreSide:{flex:1,alignItems:'center',gap:4},scoreValue:{fontSize:38,fontWeight:'800',color:'#ecfff7'},scoreDetail:{fontSize:14,fontWeight:'700',color:'#b9ebd7'},
  footer: { textAlign: 'center', color: '#7f8da7', fontSize: 12, marginTop: 10, lineHeight: 20 },
});
