/**
 * Saved tournaments management (Settings page)
 */
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('savedTournamentsList')) return;

  App.init();
  let state = App.getState();

  init();

  function init() {
    bindEvents();
    renderSavedList();
    updateCurrentLabel();
  }

  function bindEvents() {
    document.getElementById('btnSaveTournament')?.addEventListener('click', saveCurrentTournament);
    document.getElementById('btnNewTournament')?.addEventListener('click', createNewTournament);
    document.getElementById('btnDuplicateTournament')?.addEventListener('click', duplicateTournament);
  }

  function updateCurrentLabel() {
    state = App.getState();
    const el = document.getElementById('currentTournamentLabel');
    if (el) {
      const name = state.settings.name || 'Chess Tournament';
      const saved = Storage.listSavedTournaments().find((t) => t.id === state.tournamentId);
      const updated = saved ? new Date(saved.updatedAt).toLocaleString() : 'Just now';
      el.textContent = `${name} · Last saved ${updated}`;
    }
  }

  function renderSavedList() {
    const list = document.getElementById('savedTournamentsList');
    if (!list) return;

    state = App.getState();
    const tournaments = Storage.listSavedTournaments();

    if (tournaments.length === 0) {
      list.innerHTML =
        '<p class="form-hint">No saved tournaments yet. Click "Save Current Tournament" to store this event.</p>';
      return;
    }

    list.innerHTML = tournaments
      .map((t) => {
        const isActive = t.id === state.tournamentId;
        const date = new Date(t.updatedAt).toLocaleString();
        return `
        <div class="saved-tournament-item ${isActive ? 'active' : ''}" data-id="${t.id}">
          <div class="saved-tournament-info">
            <strong>${App.escapeHtml(t.name)}</strong>
            ${isActive ? '<span class="badge badge-active">Current</span>' : ''}
            <div class="form-hint">${t.playerCount} players · Round ${t.currentRound || 0} · ${date}</div>
          </div>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" data-load="${t.id}" ${isActive ? 'disabled' : ''}>Load</button>
            <button class="btn btn-sm btn-secondary" data-rename="${t.id}">Rename</button>
            <button class="btn btn-sm btn-danger" data-delete="${t.id}">Delete</button>
          </div>
        </div>
      `;
      })
      .join('');

    list.querySelectorAll('[data-load]').forEach((btn) => {
      btn.addEventListener('click', () => loadTournament(btn.dataset.load));
    });
    list.querySelectorAll('[data-rename]').forEach((btn) => {
      btn.addEventListener('click', () => renameTournament(btn.dataset.rename));
    });
    list.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteTournament(btn.dataset.delete));
    });
  }

  function saveCurrentTournament() {
    state = App.getState();
    const name =
      prompt('Tournament name to save:', state.settings.name || 'Chess Tournament') ||
      state.settings.name;
    if (name === null) return;

    Storage.saveTournamentToLibrary(state, name);
    App.reload();
    document.dispatchEvent(new CustomEvent('tournament-changed'));
    renderSavedList();
    updateCurrentLabel();
    App.toast('Tournament saved', 'success');
  }

  async function createNewTournament() {
    const ok = await App.confirm(
      'Create a new tournament? Unsaved changes to the current event are already auto-saved in your library.',
      'New Tournament'
    );
    if (!ok) return;

    const name = prompt('New tournament name:', 'Chess Tournament') || 'Chess Tournament';
    const newState = Storage.createNewTournament(name);
    App.setState(newState);
    state = App.getState();

    document.dispatchEvent(new CustomEvent('tournament-changed'));
    renderSavedList();
    updateCurrentLabel();
    App.toast('New tournament created', 'success');
  }

  async function duplicateTournament() {
    state = App.getState();
    const copy = JSON.parse(JSON.stringify(state));
    copy.tournamentId = Storage.generateTournamentId();
    copy.settings.name = (copy.settings.name || 'Tournament') + ' (Copy)';
    copy.currentRound = 0;
    copy.rounds = [];
    copy.players.forEach((p) => {
      p.points = 0;
      p.buchholz = 0;
      p.sonneborn = 0;
      p.colorBalance = 0;
      p.opponents = [];
      p.byes = [];
    });

    App.setState(copy);
    Storage.saveTournamentToLibrary(copy, copy.settings.name);
    state = App.getState();
    document.dispatchEvent(new CustomEvent('tournament-changed'));
    renderSavedList();
    updateCurrentLabel();
    App.toast('Tournament duplicated as new event', 'success');
  }

  async function loadTournament(id) {
    const saved = Storage.getSavedTournament(id);
    if (!saved) return;

    const ok = await App.confirm(
      `Load "${saved.name}"? This will replace the current tournament on screen.`,
      'Load Tournament'
    );
    if (!ok) return;

    const loaded = Storage.loadTournamentFromLibrary(id);
    if (!loaded) {
      App.toast('Could not load tournament', 'error');
      return;
    }

    App.setState(loaded);
    state = App.getState();
    document.dispatchEvent(new CustomEvent('tournament-changed'));
    renderSavedList();
    updateCurrentLabel();
    App.toast(`Loaded "${saved.name}"`, 'success');
  }

  async function renameTournament(id) {
    const saved = Storage.getSavedTournament(id);
    if (!saved) return;

    const name = prompt('Rename tournament:', saved.name);
    if (!name || !name.trim()) return;

    saved.state.settings.name = name.trim();
    saved.name = name.trim();
    saved.updatedAt = new Date().toISOString();
    Storage.saveTournamentToLibrary(saved.state, saved.name);

    state = App.getState();
    if (state.tournamentId === id) {
      state.settings.name = name.trim();
      App.save();
      document.dispatchEvent(new CustomEvent('tournament-changed'));
    }

    renderSavedList();
    updateCurrentLabel();
    App.toast('Tournament renamed', 'success');
  }

  async function deleteTournament(id) {
    const saved = Storage.getSavedTournament(id);
    if (!saved) return;

    const ok = await App.confirm(
      `Delete saved tournament "${saved.name}"? This cannot be undone.`,
      'Delete Saved Tournament'
    );
    if (!ok) return;

    Storage.deleteTournamentFromLibrary(id);

    state = App.getState();
    if (state.tournamentId === id) {
      const remaining = Storage.listSavedTournaments();
      if (remaining.length > 0) {
        const loaded = Storage.loadTournamentFromLibrary(remaining[0].id);
        if (loaded) App.setState(loaded);
      } else {
        App.setState(Storage.createNewTournament('Chess Tournament'));
      }
      document.dispatchEvent(new CustomEvent('tournament-changed'));
    }

    state = App.reload();
    renderSavedList();
    updateCurrentLabel();
    App.toast('Tournament deleted', 'success');
  }
});
