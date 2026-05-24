/**
 * LocalStorage persistence + saved tournament library
 */
const STORAGE_KEY = 'swissTournamentManager';
const LIBRARY_KEY = 'swissTournamentManager_library';

const Storage = (function () {
  const defaultSettings = {
    name: 'Chess Tournament',
    totalRounds: 5,
    scoreWin: 1,
    scoreDraw: 0.5,
    scoreLoss: 0,
    maxRematches: 0,
    colorPriority: 'fide',
    tieBreakOrder: ['buchholz', 'sonneborn', 'rating'],
    initialColor: null // 'white' or 'black'
  };

  function createDefaultState(name) {
    return {
      tournamentId: generateTournamentId(),
      settings: { ...defaultSettings, name: name || defaultSettings.name },
      players: [],
      rounds: [],
      currentRound: 0,
      darkMode: true,
      version: 2
    };
  }

  function generateTournamentId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function generateId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- Library ---------- */

  function loadLibrary() {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (!raw) return { version: 2, tournaments: [] };
      const data = JSON.parse(raw);
      return {
        version: 2,
        tournaments: Array.isArray(data.tournaments) ? data.tournaments : []
      };
    } catch (e) {
      return { version: 2, tournaments: [] };
    }
  }

  function saveLibrary(library) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
      return true;
    } catch (e) {
      console.error('Failed to save tournament library:', e);
      return false;
    }
  }

  function migrateOldStorageToLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const library = loadLibrary();
      const tid = data.tournamentId || generateTournamentId();
      data.tournamentId = tid;
      const exists = library.tournaments.some((t) => t.id === tid);
      if (!exists) {
        library.tournaments.push({
          id: tid,
          name: (data.settings && data.settings.name) || 'Chess Tournament',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: migrate(mergeDefaults(data))
        });
        saveLibrary(library);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrate(mergeDefaults(data))));
    } catch (e) {
      console.error('Migration error:', e);
    }
  }

  function listSavedTournaments() {
    const library = loadLibrary();
    return library.tournaments
      .map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        playerCount: (t.state && t.state.players && t.state.players.length) || 0,
        currentRound: (t.state && t.state.currentRound) || 0
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function getSavedTournament(id) {
    const library = loadLibrary();
    return library.tournaments.find((t) => t.id === id) || null;
  }

  function syncToLibrary(state) {
    if (!state || !state.tournamentId) return false;
    const library = loadLibrary();
    const now = new Date().toISOString();
    const name = (state.settings && state.settings.name) || 'Chess Tournament';
    const idx = library.tournaments.findIndex((t) => t.id === state.tournamentId);

    const entry = {
      id: state.tournamentId,
      name,
      createdAt: idx >= 0 ? library.tournaments[idx].createdAt : now,
      updatedAt: now,
      state: JSON.parse(JSON.stringify(state))
    };

    if (idx >= 0) library.tournaments[idx] = entry;
    else library.tournaments.push(entry);

    return saveLibrary(library);
  }

  function saveTournamentToLibrary(state, displayName) {
    if (!state.tournamentId) state.tournamentId = generateTournamentId();
    if (displayName) state.settings.name = displayName.trim() || state.settings.name;
    save(state);
    return syncToLibrary(state);
  }

  function loadTournamentFromLibrary(id) {
    const saved = getSavedTournament(id);
    if (!saved || !saved.state) return null;
    const state = migrate(mergeDefaults(saved.state));
    state.tournamentId = saved.id;
    save(state);
    return state;
  }

  function deleteTournamentFromLibrary(id) {
    const library = loadLibrary();
    library.tournaments = library.tournaments.filter((t) => t.id !== id);
    saveLibrary(library);
    const current = load();
    if (current.tournamentId === id) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function createNewTournament(name) {
    const state = createDefaultState(name);
    save(state);
    syncToLibrary(state);
    return state;
  }

  /* ---------- Active tournament ---------- */

  function load() {
    migrateOldStorageToLibrary();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const state = createDefaultState();
        save(state);
        syncToLibrary(state);
        return state;
      }
      const data = JSON.parse(raw);
      const state = migrate(mergeDefaults(data));
      if (!state.tournamentId) {
        state.tournamentId = generateTournamentId();
        save(state);
      }
      syncToLibrary(state);
      return state;
    } catch (e) {
      console.error('Failed to load tournament data:', e);
      const state = createDefaultState();
      save(state);
      return state;
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
    if (!data.tournamentId) data.tournamentId = generateTournamentId();
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
      if (p.tpn === undefined) p.tpn = 0;
    });
    return data;
  }

  function save(state) {
    try {
      if (!state.tournamentId) state.tournamentId = generateTournamentId();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncToLibrary(state);
      return true;
    } catch (e) {
      console.error('Failed to save tournament data:', e);
      return false;
    }
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
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

  function createPlayerFromRow(row) {
    return {
      id: generateId(),
      name: row.name,
      rating: row.rating || 0,
      club: row.club || '',
      active: row.active !== false,
      points: 0,
      buchholz: 0,
      sonneborn: 0,
      colorBalance: 0,
      opponents: [],
      byes: [],
      tpn: 0
    };
  }

  function assignTPNs(state) {
    const players = state.players.slice().sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return a.name.localeCompare(b.name);
    });
    players.forEach((p, idx) => {
      const sp = state.players.find(sp => sp.id === p.id);
      if (sp) sp.tpn = idx + 1;
    });
  }

  return {
    STORAGE_KEY,
    LIBRARY_KEY,
    load,
    save,
    clear,
    generateId,
    generateTournamentId,
    createDefaultState,
    createNewTournament,
    defaultSettings,
    getActivePlayers,
    getPlayerById,
    getCurrentRoundData,
    getRoundByNumber,
    createPlayerFromRow,
    listSavedTournaments,
    getSavedTournament,
    saveTournamentToLibrary,
    loadTournamentFromLibrary,
    deleteTournamentFromLibrary,
    syncToLibrary,
    assignTPNs
  };
})();
