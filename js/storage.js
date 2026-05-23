/**
 * LocalStorage persistence for Swiss Tournament Manager
 */
const STORAGE_KEY = 'swissTournamentManager';

const Storage = (function () {
  const defaultSettings = {
    name: 'Chess Tournament',
    totalRounds: 5,
    scoreWin: 1,
    scoreDraw: 0.5,
    scoreLoss: 0,
    maxRematches: 0,
    colorPriority: 'balance',
    tieBreakOrder: ['buchholz', 'sonneborn', 'rating']
  };

  function createDefaultState() {
    return {
      settings: { ...defaultSettings },
      players: [],
      rounds: [],
      currentRound: 0,
      darkMode: true,
      version: 1
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const data = JSON.parse(raw);
      return migrate(mergeDefaults(data));
    } catch (e) {
      console.error('Failed to load tournament data:', e);
      return createDefaultState();
    }
  }

  function mergeDefaults(data) {
    const defaults = createDefaultState();
    return {
      ...defaults,
      ...data,
      settings: { ...defaults.settings, ...(data.settings || {}) },
      players: Array.isArray(data.players) ? data.players : [],
      rounds: Array.isArray(data.rounds) ? data.rounds : []
    };
  }

  function migrate(data) {
    data.players.forEach((p) => {
      if (!p.id) p.id = generateId();
      if (p.points === undefined) p.points = 0;
      if (p.buchholz === undefined) p.buchholz = 0;
      if (p.sonneborn === undefined) p.sonneborn = 0;
      if (p.colorBalance === undefined) p.colorBalance = 0;
      if (!Array.isArray(p.opponents)) p.opponents = [];
      if (!Array.isArray(p.byes)) p.byes = [];
      if (p.active === undefined) p.active = true;
      if (p.rating === undefined) p.rating = 0;
      if (!p.club) p.club = '';
    });
    return data;
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Failed to save tournament data:', e);
      return false;
    }
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function generateId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getActivePlayers(state) {
    return state.players.filter((p) => p.active);
  }

  function getPlayerById(state, id) {
    return state.players.find((p) => p.id === id);
  }

  function getCurrentRoundData(state) {
    if (state.currentRound < 1) return null;
    return state.rounds.find((r) => r.number === state.currentRound) || null;
  }

  function getRoundByNumber(state, num) {
    return state.rounds.find((r) => r.number === num);
  }

  return {
    STORAGE_KEY,
    load,
    save,
    clear,
    generateId,
    getActivePlayers,
    getPlayerById,
    getCurrentRoundData,
    getRoundByNumber,
    createDefaultState,
    defaultSettings
  };
})();
