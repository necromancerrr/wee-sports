/** Human-facing scoring comes from the authoritative rules snapshot. */
export function tableTennisAnnouncement(state, event, playerName = 'You') {
  const name = player => player === 1 ? playerName : 'Bot';
  const score = state.score.join(' – ');
  if (event.type === 'let') return {title: 'Let · serve again', detail: 'The net was touched. The score stays the same.', tone: 'neutral'};
  if (event.type === 'point') {
    if (state.winner) return {title: state.winner === 1 ? `${playerName} win${playerName === 'You' ? '' : 's'}` : 'Bot wins', detail: `${score} · Well played`, tone: state.winner === 1 ? 'win' : 'neutral'};
    const next = state.deuce ? 'Deuce · win by two' : state.gamePoint ? `Game point · ${name(state.gamePoint)}` : `${name(state.server)} serve${state.server === 1 && playerName === 'You' ? '' : 's'} next`;
    return {title: `Point · ${name(event.winner)}`, detail: `${score} · ${next}`, tone: event.winner === 1 ? 'win' : 'neutral'};
  }
  if (event.type === 'serve') return {title: state.server === 1 ? `${playerName === 'You' ? 'Your' : `${playerName}’s`} serve` : 'Bot serves', detail: state.deuce ? 'Deuce · win by two' : state.gamePoint ? `Game point · ${name(state.gamePoint)}` : 'Ready for the return', tone: 'neutral'};
  return null;
}
