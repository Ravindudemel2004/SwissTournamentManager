/**
 * Tournament settings page
 */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.renderLayout('Settings');

  let state = App.getState();
  let saveTimeout = null;

  init();

  function init() {
    loadForm();
    bindEvents();
    document.addEventListener('tournament-changed', () => {
      state = App.getState();
      loadForm();
    });
  }

  function loadForm() {
    state = App.getState();
    const s = state.settings;

    setVal('settingName', s.name);
    setVal('settingTotalRounds', s.totalRounds);
    setVal('settingScoreWin', s.scoreWin);
    setVal('settingScoreDraw', s.scoreDraw);
    setVal('settingScoreLoss', s.scoreLoss);
    setVal('settingMaxRematches', s.maxRematches);
    setVal('settingColorPriority', s.colorPriority);

    const tieOrder = s.tieBreakOrder || ['buchholz', 'sonneborn', 'rating'];
    document.querySelectorAll('[name="tieBreak"]').forEach((cb) => {
      cb.checked = tieOrder.includes(cb.value);
    });
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function bindEvents() {
    const form = document.getElementById('settingsForm');
    if (!form) return;

    form.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('change', autoSave);
      el.addEventListener('input', autoSave);
    });

    document.getElementById('btnResetTournament')?.addEventListener('click', resetTournament);
    document.getElementById('btnExportJson')?.addEventListener('click', () => {
      ExportManager.exportJSON(state);
      App.toast('Tournament exported', 'success');
    });
    document.getElementById('btnImportJson')?.addEventListener('click', () => {
      document.getElementById('importJsonInput')?.click();
    });
    document.getElementById('importJsonInput')?.addEventListener('change', handleImport);
    document.getElementById('btnExportStandings')?.addEventListener('click', () => {
      try {
        ExportManager.exportStandingsCSV(state);
        App.toast('Standings CSV exported', 'success');
      } catch (e) {
        App.toast(e.message, 'error');
      }
    });
    document.getElementById('btnExportAllResults')?.addEventListener('click', () => {
      try {
        state = App.getState();
        ExportManager.exportAllResultsCSV(state);
        App.toast('All results exported', 'success');
      } catch (e) {
        App.toast(e.message, 'error');
      }
    });
  }

  function autoSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 400);
  }

  function saveSettings() {
    state = App.getState();
    const s = state.settings;

    s.name = document.getElementById('settingName').value.trim() || 'Chess Tournament';
    s.totalRounds = clamp(parseInt(document.getElementById('settingTotalRounds').value, 10) || 5, 1, 20);
    s.scoreWin = parseFloat(document.getElementById('settingScoreWin').value) || 1;
    s.scoreDraw = parseFloat(document.getElementById('settingScoreDraw').value) || 0.5;
    s.scoreLoss = parseFloat(document.getElementById('settingScoreLoss').value) || 0;
    s.maxRematches = clamp(parseInt(document.getElementById('settingMaxRematches').value, 10) || 0, 0, 5);
    s.colorPriority = document.getElementById('settingColorPriority').value;

    const tieBreaks = [];
    document.querySelectorAll('[name="tieBreak"]:checked').forEach((cb) => {
      tieBreaks.push(cb.value);
    });
    s.tieBreakOrder = tieBreaks.length ? tieBreaks : ['buchholz', 'sonneborn', 'rating'];

    App.save();
    Storage.saveTournamentToLibrary(state);
    showSaveIndicator();
  }

  function showSaveIndicator() {
    const el = document.getElementById('saveIndicator');
    if (el) {
      el.textContent = 'Saved ✓';
      el.style.opacity = '1';
      setTimeout(() => {
        el.style.opacity = '0.5';
      }, 1500);
    }
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  async function resetTournament() {
    const ok = await App.confirm(
      'This will delete all players, rounds, and results. Are you sure?',
      'Reset Tournament'
    );
    if (!ok) return;

    const darkMode = state.darkMode;
    const settings = { ...state.settings };
    const fresh = Storage.createNewTournament(settings.name);
    fresh.settings = settings;
    fresh.darkMode = darkMode;
    App.setState(fresh);
    state = App.getState();
    loadForm();
    document.dispatchEvent(new CustomEvent('tournament-changed'));
    App.toast('Tournament reset', 'success');
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      App.showLoading('Importing...');
      const data = await ExportManager.importJSON(file);
      App.setState(data);
      Storage.saveTournamentToLibrary(data);
      state = App.getState();
      loadForm();
      document.dispatchEvent(new CustomEvent('tournament-changed'));
      App.hideLoading();
      App.toast('Tournament imported', 'success');
    } catch (err) {
      App.hideLoading();
      App.toast(err.message, 'error');
    }
    e.target.value = '';
  }
});
