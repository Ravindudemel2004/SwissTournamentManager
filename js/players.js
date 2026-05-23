/**
 * Player management page
 */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.renderLayout('Players');

  let state = App.getState();
  let sortField = 'name';
  let sortAsc = true;
  let searchQuery = '';
  let pendingExcelImport = null;

  const tbody = document.getElementById('playersTableBody');
  const searchInput = document.getElementById('playerSearch');
  const playerCount = document.getElementById('playerCount');

  init();

  function init() {
    bindEvents();
    render();
  }

  function bindEvents() {
    document.getElementById('btnAddPlayer')?.addEventListener('click', () => openPlayerModal());
    document.getElementById('btnSavePlayer')?.addEventListener('click', savePlayer);
    App.setupModalClose('playerModal');

    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      render();
    });

    document.querySelectorAll('[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) sortAsc = !sortAsc;
        else {
          sortField = field;
          sortAsc = true;
        }
        render();
      });
    });

    document.getElementById('importJsonInput')?.addEventListener('change', handleImport);
    document.getElementById('importExcelInput')?.addEventListener('change', handleExcelSelect);
    document.getElementById('btnExportJson')?.addEventListener('click', () => {
      ExportManager.exportJSON(state);
      App.toast('Tournament exported', 'success');
    });
    document.getElementById('btnImportJson')?.addEventListener('click', () => {
      document.getElementById('importJsonInput')?.click();
    });
    document.getElementById('btnImportExcel')?.addEventListener('click', () => {
      document.getElementById('importExcelInput')?.click();
    });
    document.getElementById('btnDownloadExcelTemplate')?.addEventListener('click', () => {
      try {
        ExcelImport.downloadTemplate();
        App.toast('Template downloaded', 'success');
      } catch (e) {
        App.toast(e.message, 'error');
      }
    });
    document.getElementById('btnConfirmExcelImport')?.addEventListener('click', confirmExcelImport);
    App.setupModalClose('excelImportModal');
  }

  function getFilteredPlayers() {
    let list = [...state.players];
    if (searchQuery) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery) ||
          (p.club && p.club.toLowerCase().includes(searchQuery))
      );
    }

    list.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (sortField === 'name') {
        va = (va || '').toLowerCase();
        vb = (vb || '').toLowerCase();
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }

  function render() {
    state = App.getState();
    Standings.calculateStandings(state);
    const list = getFilteredPlayers();

    if (playerCount) {
      playerCount.textContent = `${state.players.length} players (${Storage.getActivePlayers(state).length} active)`;
    }

    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">♟</div><h3>No players</h3><p>Add players to start your tournament (8–64 recommended)</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((p) => {
        const stats = Standings.getPlayerStats(p.id, state);
        return `
        <tr>
          <td><span class="player-name">${App.escapeHtml(p.name)}</span></td>
          <td>${p.rating || '—'}</td>
          <td class="hide-mobile">${App.escapeHtml(p.club || '—')}</td>
          <td><strong>${App.formatPoints(stats.points)}</strong></td>
          <td class="hide-mobile">${stats.buchholz.toFixed(1)}</td>
          <td>
            <span class="badge ${p.active ? 'badge-active' : 'badge-inactive'}">${p.active ? 'Active' : 'Inactive'}</span>
          </td>
          <td class="hide-mobile">${stats.colorBalance > 0 ? '+' + stats.colorBalance : stats.colorBalance}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-sm btn-secondary" data-edit="${p.id}" title="Edit">✏️</button>
              <button class="btn btn-sm btn-secondary" data-toggle="${p.id}" title="Toggle active">${p.active ? '⏸' : '▶'}</button>
              <button class="btn btn-sm btn-danger" data-delete="${p.id}" title="Delete">🗑</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => openPlayerModal(btn.dataset.edit));
    });
    tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleActive(btn.dataset.toggle));
    });
    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deletePlayer(btn.dataset.delete));
    });
  }

  function openPlayerModal(playerId = null) {
    const modal = document.getElementById('playerModal');
    const title = document.getElementById('playerModalTitle');
    const form = document.getElementById('playerForm');
    form.reset();
    document.getElementById('playerId').value = playerId || '';

    if (playerId) {
      const p = Storage.getPlayerById(state, playerId);
      if (p) {
        title.textContent = 'Edit Player';
        document.getElementById('playerName').value = p.name;
        document.getElementById('playerRating').value = p.rating || '';
        document.getElementById('playerClub').value = p.club || '';
        document.getElementById('playerActive').checked = p.active;
      }
    } else {
      title.textContent = 'Add Player';
      document.getElementById('playerActive').checked = true;
    }

    App.openModal('playerModal');
  }

  function savePlayer() {
    const id = document.getElementById('playerId').value;
    const name = document.getElementById('playerName').value.trim();
    const rating = parseInt(document.getElementById('playerRating').value, 10) || 0;
    const club = document.getElementById('playerClub').value.trim();
    const active = document.getElementById('playerActive').checked;

    if (!name) {
      App.toast('Player name is required', 'error');
      return;
    }

    if (state.players.length >= 64 && !id) {
      App.toast('Maximum 64 players allowed', 'error');
      return;
    }

    if (id) {
      const p = Storage.getPlayerById(state, id);
      if (p) {
        p.name = name;
        p.rating = rating;
        p.club = club;
        p.active = active;
      }
      App.toast('Player updated', 'success');
    } else {
      state.players.push({
        id: Storage.generateId(),
        name,
        rating,
        club,
        active,
        points: 0,
        buchholz: 0,
        sonneborn: 0,
        colorBalance: 0,
        opponents: [],
        byes: []
      });
      App.toast('Player added', 'success');
    }

    App.save();
    App.closeModal('playerModal');
    render();
  }

  async function toggleActive(id) {
    const p = Storage.getPlayerById(state, id);
    if (!p) return;
    p.active = !p.active;
    App.save();
    App.toast(p.active ? 'Player activated' : 'Player deactivated', 'info');
    render();
  }

  async function deletePlayer(id) {
    const p = Storage.getPlayerById(state, id);
    if (!p) return;

    const ok = await App.confirm(`Delete player "${p.name}"?`, 'Delete Player');
    if (!ok) return;

    state.players = state.players.filter((pl) => pl.id !== id);
    state.rounds.forEach((round) => {
      round.pairings = (round.pairings || []).filter(
        (pair) => pair.white !== id && pair.black !== id
      );
    });

    App.save();
    App.toast('Player deleted', 'success');
    render();
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      App.showLoading('Importing tournament...');
      const data = await ExportManager.importJSON(file);
      App.setState(data);
      Storage.saveTournamentToLibrary(data);
      state = App.getState();
      App.hideLoading();
      App.toast('Tournament imported successfully', 'success');
      render();
    } catch (err) {
      App.hideLoading();
      App.toast(err.message, 'error');
    }
    e.target.value = '';
  }

  async function handleExcelSelect(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    try {
      App.showLoading('Reading Excel file...');
      const result = await ExcelImport.importPlayers(file);
      App.hideLoading();
      pendingExcelImport = result;
      showExcelPreview(result);
    } catch (err) {
      App.hideLoading();
      App.toast(err.message, 'error');
    }
  }

  function showExcelPreview(result) {
    const preview = document.getElementById('excelImportPreview');
    const warnings = document.getElementById('excelImportWarnings');
    if (!preview) return;

    preview.innerHTML = `
      <p><strong>${result.players.length}</strong> players found in file.</p>
      <div class="table-wrapper" style="max-height:200px;margin-top:0.75rem">
        <table>
          <thead><tr><th>Name</th><th>Rating</th><th>Club</th><th>Active</th></tr></thead>
          <tbody>
            ${result.players
              .slice(0, 10)
              .map(
                (p) =>
                  `<tr><td>${App.escapeHtml(p.name)}</td><td>${p.rating}</td><td>${App.escapeHtml(p.club)}</td><td>${p.active ? 'Yes' : 'No'}</td></tr>`
              )
              .join('')}
            ${result.players.length > 10 ? `<tr><td colspan="4">…and ${result.players.length - 10} more</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `;

    if (warnings) {
      warnings.innerHTML =
        result.errors && result.errors.length
          ? `<div class="alert alert-warning">${result.errors.slice(0, 5).join('<br>')}</div>`
          : '';
    }

    App.openModal('excelImportModal');
  }

  async function confirmExcelImport() {
    if (!pendingExcelImport) return;

    const mode = document.querySelector('input[name="excelImportMode"]:checked')?.value || 'append';

    if (mode === 'replace') {
      const ok = await App.confirm(
        'Replace all current players with the Excel list?',
        'Replace Players'
      );
      if (!ok) return;
    }

    try {
      state = App.getState();
      ExcelImport.applyPlayersToState(state, pendingExcelImport.players, mode);
      App.save();
      pendingExcelImport = null;
      App.closeModal('excelImportModal');
      App.toast(`Imported players (${mode === 'replace' ? 'replaced' : 'added'})`, 'success');
      render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }
});
