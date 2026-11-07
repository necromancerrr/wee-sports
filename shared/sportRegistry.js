/** Data-only registry usable by browser, native controller and room server. */
export const SPORT_REGISTRY = Object.freeze({
  tennis: Object.freeze({id: 'tennis', name: 'Tennis', players: Object.freeze({min: 1, max: 2}),
    soloModes: Object.freeze(['practice', 'bot']), input: 'swing', rulesVersion: 1, checkpointVersion: null,
    controllerVersion: 1, controllerCapabilities: Object.freeze(['buttons']), entry: '/game.html'}),
  bowling: Object.freeze({id: 'bowling', name: 'Bowling', players: Object.freeze({min: 1, max: 4}),
    soloModes: Object.freeze(['practice', 'match']), input: 'roll', rulesVersion: 1, checkpointVersion: 1,
    controllerVersion: 1, controllerCapabilities: Object.freeze(['buttons']), entry: '/bowling.html'}),
  'table-tennis': Object.freeze({id: 'table-tennis', name: 'Table Tennis', players: Object.freeze({min: 1, max: 1}),
    soloModes: Object.freeze(['practice', 'bot']), input: 'pose', rulesVersion: 1, checkpointVersion: 1,
    controllerVersion: 1, controllerCapabilities: Object.freeze(['buttons']), entry: '/table-tennis.html'}),
});
export const getSport = id => Object.hasOwn(SPORT_REGISTRY, id) ? SPORT_REGISTRY[id] : null;
