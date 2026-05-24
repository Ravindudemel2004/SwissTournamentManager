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

    const tieOrder = s.tieBreakOrder || ['direct_encounter', 'buchholz_cut1', 'buchholz', 'sonneborn', 'wins'];
    document.querySelectorAll('[name="tieBreak"]').forEach((cb) => {
      cb.checked = tieOrder.includes(cb.value);
    });

    const list = document.getElementById('tieBreakList');
    if (list) {
       tieOrder.forEach(val => {
          const item = list.querySelector(`[data-value="${val}"]`);
          if (item) list.appendChild(item);
       });
    }
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

    const dragList = document.getElementById('tieBreakList');
    if (dragList) {
       let draggedItem = null;
       dragList.addEventListener('dragstart', e => {
           draggedItem = e.target.closest('.drag-item');
           if (draggedItem) {
               setTimeout(() => draggedItem.style.opacity = '0.5', 0);
           }
       });
       dragList.addEventListener('dragend', e => {
           if (draggedItem) {
               draggedItem.style.opacity = '1';
               draggedItem = null;
               autoSave();
           }
       });
       dragList.addEventListener('dragover', e => {
           e.preventDefault();
           if (!draggedItem) return;
           const afterElement = getDragAfterElement(dragList, e.clientY);
           if (afterElement == null) {
               dragList.appendChild(draggedItem);
           } else {
               dragList.insertBefore(draggedItem, afterElement);
           }
       });
    }
  }

  function getDragAfterElement(container, y) {
       const draggableElements = [...container.querySelectorAll('.drag-item:not([style*="opacity: 0.5"])')];
       return draggableElements.reduce((closest, child) => {
           const box = child.getBoundingClientRect();
           const offset = y - box.top - box.height / 2;
           if (offset < 0 && offset > closest.offset) {
               return { offset: offset, element: child };
           } else {
               return closest;
           }
       }, { offset: Number.NEGATIVE_INFINITY }).element;
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
    s.maxRematches = 0;
    s.colorPriority = 'fide';

    const tieBreaks = [];
    document.querySelectorAll('#tieBreakList .drag-item').forEach((item) => {
      const cb = item.querySelector('input[name="tieBreak"]');
      if (cb && cb.checked) {
        tieBreaks.push(cb.value);
      }
    });
    s.tieBreakOrder = tieBreaks.length ? tieBreaks : ['direct_encounter', 'buchholz_cut1', 'buchholz', 'sonneborn', 'wins'];

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
