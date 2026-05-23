/**
 * Core application utilities, navigation, UI components, dashboard
 */
const App = (function () {
  let state = null;

  function init() {
    state = Storage.load();
    applyTheme();
    initNavigation();
    initThemeToggle();
    initSidebar();
    return state;
  }

  function getState() {
    if (!state) state = Storage.load();
    return state;
  }

  function setState(newState) {
    state = newState;
    Storage.save(state);
  }

  function save() {
    Storage.save(state);
  }

  function reload() {
    state = Storage.load();
    return state;
  }

  /* Theme */
  function applyTheme() {
    const dark = state.darkMode !== false;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const toggle = document.getElementById('themeToggle');
    if (toggle) toggle.textContent = dark ? '☀️' : '🌙';
  }

  function initThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.darkMode = !state.darkMode;
      applyTheme();
      save();
    });
  }

  /* Navigation */
  function initNavigation() {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach((link) => {
      const href = link.getAttribute('href');
      if (href === path || (path === '' && href === 'index.html')) {
        link.classList.add('active');
      }
    });
  }

  function initSidebar() {
    const toggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');

    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('active');
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('open');
        backdrop.classList.remove('active');
      });
    }
  }

  /* Toast notifications */
  function toast(message, type = 'info', duration = 3500) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  /* Confirmation dialog */
  function confirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header"><h2>${title}</h2></div>
          <div class="modal-body"><p>${message}</p></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-action="cancel">Cancel</button>
            <button class="btn btn-danger" data-action="ok">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('[data-action="cancel"]').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('[data-action="ok"]').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  }

  /* Loading overlay */
  function showLoading(text = 'Loading...') {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = `<div class="spinner"></div><p class="loading-text">${text}</p>`;
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.loading-text').textContent = text;
    requestAnimationFrame(() => overlay.classList.add('active'));
  }

  function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  /* Modal helpers */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  function setupModalClose(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(modalId));
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modalId);
    });
  }

  /* Player name helper */
  function playerName(id) {
    const p = Storage.getPlayerById(state, id);
    return p ? p.name : 'Unknown';
  }

  function formatPoints(pts) {
    return Number.isInteger(pts) ? pts : pts.toFixed(1);
  }

  /* Generate next round */
  async function generateNextRound() {
    const active = Storage.getActivePlayers(state);
    if (active.length < 2) {
      toast('Need at least 2 active players', 'error');
      return false;
    }
    if (active.length > 64) {
      toast('Maximum 64 players supported', 'error');
      return false;
    }

    if (state.currentRound > 0) {
      const current = Storage.getCurrentRoundData(state);
      if (current && !Standings.isRoundComplete(current)) {
        toast('Complete all games in the current round first', 'warning');
        return false;
      }
      if (current) current.locked = true;
    }

    if (state.currentRound >= state.settings.totalRounds) {
      toast('All rounds have been played', 'warning');
      return false;
    }

    showLoading('Generating pairings...');

    try {
      Standings.calculateStandings(state);
      const { pairings, byePlayerId } = PairingEngine.buildRoundPairings(state);

      if (byePlayerId) {
        const byePlayer = Storage.getPlayerById(state, byePlayerId);
        if (byePlayer) {
          if (!byePlayer.byes) byePlayer.byes = [];
          byePlayer.byes.push(state.currentRound + 1);
        }
      }

      // Track opponents for pairing history
      pairings.forEach((p) => {
        if (p.isBye || !p.black) return;
        const whiteP = Storage.getPlayerById(state, p.white);
        const blackP = Storage.getPlayerById(state, p.black);
        if (whiteP) {
          if (!whiteP.opponents) whiteP.opponents = [];
          if (!whiteP.opponents.includes(p.black)) whiteP.opponents.push(p.black);
        }
        if (blackP) {
          if (!blackP.opponents) blackP.opponents = [];
          if (!blackP.opponents.includes(p.white)) blackP.opponents.push(p.white);
        }
      });

      const newRound = {
        number: state.currentRound + 1,
        pairings,
        locked: false,
        createdAt: new Date().toISOString()
      };

      state.rounds.push(newRound);
      state.currentRound = newRound.number;
      save();
      hideLoading();
      toast(`Round ${newRound.number} pairings generated`, 'success');
      return true;
    } catch (err) {
      hideLoading();
      toast(err.message || 'Failed to generate pairings', 'error');
      return false;
    }
  }

  /* Dashboard */
  function renderDashboard() {
    state = getState();
    Standings.calculateStandings(state);

    const tournamentName = document.getElementById('tournamentName');
    if (tournamentName) tournamentName.textContent = state.settings.name || 'Chess Tournament';

    const activePlayers = Storage.getActivePlayers(state);
    const totalPlayers = state.players.length;

    setText('statTotalPlayers', totalPlayers);
    setText('statActivePlayers', activePlayers.length);
    setText('statCurrentRound', state.currentRound || '—');
    setText('statTotalRounds', state.settings.totalRounds);

    const currentRound = Storage.getCurrentRoundData(state);
    const progress = currentRound
      ? Standings.getRoundProgress(currentRound)
      : { completed: 0, total: 0, percent: 0 };

    setText('statRoundProgress', currentRound ? `${progress.completed}/${progress.total}` : '—');
    const progressBar = document.getElementById('roundProgressBar');
    if (progressBar) progressBar.style.width = `${progress.percent}%`;

    const standings = Standings.calculateStandings(state);
    const preview = document.getElementById('standingsPreview');
    if (preview) {
      if (standings.length === 0) {
        preview.innerHTML = `<tr><td colspan="5" class="empty-state">No players yet. <a href="players.html">Add players</a></td></tr>`;
      } else {
        preview.innerHTML = standings.slice(0, 5).map((p, i) => `
          <tr class="rank-${i + 1}">
            <td>${p.rank}</td>
            <td><span class="player-name">${escapeHtml(p.name)}</span></td>
            <td>${p.rating || '—'}</td>
            <td><strong>${formatPoints(p.points)}</strong></td>
            <td class="hide-mobile">${p.buchholz.toFixed(1)}</td>
          </tr>
        `).join('');
      }
    }

    const roundStatus = document.getElementById('roundStatus');
    if (roundStatus) {
      if (state.currentRound === 0) {
        roundStatus.innerHTML = '<div class="alert alert-info">Tournament not started. Add players and generate Round 1.</div>';
      } else if (currentRound && !Standings.isRoundComplete(currentRound)) {
        roundStatus.innerHTML = `<div class="alert alert-warning">Round ${state.currentRound} in progress — ${progress.completed} of ${progress.total} results entered.</div>`;
      } else if (state.currentRound >= state.settings.totalRounds) {
        roundStatus.innerHTML = '<div class="alert alert-success">Tournament complete! View final standings.</div>';
      } else {
        roundStatus.innerHTML = `<div class="alert alert-success">Round ${state.currentRound} complete. Ready for next round.</div>`;
      }
    }

    const btnGen = document.getElementById('btnGenerateRound');
    if (btnGen) {
      btnGen.disabled =
        activePlayers.length < 2 ||
        (currentRound && !Standings.isRoundComplete(currentRound)) ||
        state.currentRound >= state.settings.totalRounds;
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderLayout(pageTitle) {
    const titleEl = document.getElementById('pageTitle');
    if (titleEl && pageTitle) titleEl.textContent = pageTitle;
  }

  /* Standings page */
  function renderStandings() {
    state = getState();
    const standings = Standings.calculateStandings(state);
    const tbody = document.getElementById('standingsTableBody');

    if (!tbody) return;

    if (standings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🏆</div><h3>No standings yet</h3><p>Add players and play rounds to see standings</p></div></td></tr>`;
      return;
    }

    tbody.innerHTML = standings
      .map(
        (p) => `
      <tr class="rank-${p.rank <= 3 ? p.rank : ''}">
        <td>${p.rank}</td>
        <td><span class="player-name">${escapeHtml(p.name)}</span><br><span class="player-club hide-mobile">${escapeHtml(p.club || '')}</span></td>
        <td>${p.rating || '—'}</td>
        <td><strong>${formatPoints(p.points)}</strong></td>
        <td>${p.buchholz.toFixed(1)}</td>
        <td class="hide-mobile">${p.sonneborn.toFixed(1)}</td>
        <td class="hide-mobile">${p.gamesPlayed}</td>
        <td class="hide-mobile">${p.colorBalance > 0 ? '+' + p.colorBalance : p.colorBalance}</td>
        <td class="hide-mobile">${(p.opponents || []).length}</td>
      </tr>
    `
      )
      .join('');
  }

  return {
    init,
    getState,
    setState,
    save,
    reload,
    toast,
    confirm,
    showLoading,
    hideLoading,
    openModal,
    closeModal,
    setupModalClose,
    playerName,
    formatPoints,
    generateNextRound,
    renderDashboard,
    renderStandings,
    renderLayout,
    escapeHtml
  };
})();

/* Auto-init on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
