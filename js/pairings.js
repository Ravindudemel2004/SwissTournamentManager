/**
 * Pairings and round management page
 */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.renderLayout('Pairings');

  let state = App.getState();
  let viewRound = state.currentRound || 1;

  init();

  function init() {
    bindEvents();
    if (state.currentRound > 0) viewRound = state.currentRound;
    render();
  }

  function bindEvents() {
    document.getElementById('btnGenerateRound')?.addEventListener('click', async () => {
      const ok = await App.generateNextRound();
      if (ok) {
        state = App.reload();
        viewRound = state.currentRound;
        render();
      }
    });

    document.getElementById('btnExportPairings')?.addEventListener('click', () => {
      try {
        ExportManager.exportPairingsCSV(state, viewRound);
        App.toast('Pairings exported', 'success');
      } catch (e) {
        App.toast(e.message, 'error');
      }
    });

    document.getElementById('btnLockRound')?.addEventListener('click', lockRound);
  }

  function bindRoundTabs() {
    document.querySelectorAll('.round-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        viewRound = parseInt(tab.dataset.round, 10);
        render();
      });
    });
  }

  function render() {
    state = App.getState();
    const tabsEl = document.getElementById('roundTabs');
    const contentEl = document.getElementById('pairingsContent');
    const roundInfo = document.getElementById('roundInfo');

    if (!state.rounds.length) {
      if (tabsEl) tabsEl.innerHTML = '';
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>No rounds yet</h3>
            <p>Add at least 2 active players, then generate Round 1 pairings.</p>
            <button class="btn btn-primary" id="btnGenFromEmpty" style="margin-top:1rem">Generate Round 1</button>
          </div>`;
        document.getElementById('btnGenFromEmpty')?.addEventListener('click', async () => {
          const ok = await App.generateNextRound();
          if (ok) {
            state = App.reload();
            viewRound = state.currentRound;
            render();
          }
        });
      }
      return;
    }

    if (viewRound < 1 || !Storage.getRoundByNumber(state, viewRound)) {
      viewRound = state.currentRound;
    }

    if (tabsEl) {
      tabsEl.innerHTML = state.rounds
        .map(
          (r) => `
        <button class="round-tab ${r.number === viewRound ? 'active' : ''} ${r.locked ? 'locked' : ''}" data-round="${r.number}">
          Round ${r.number}
        </button>
      `
        )
        .join('');
      bindRoundTabs();
    }

    const round = Storage.getRoundByNumber(state, viewRound);
    if (!round) return;

    const progress = Standings.getRoundProgress(round);
    const isCurrent = round.number === state.currentRound;
    const isLocked = round.locked;

    if (roundInfo) {
      roundInfo.innerHTML = `
        <div class="alert ${progress.percent === 100 ? 'alert-success' : 'alert-info'}">
          Round ${round.number} — ${progress.completed}/${progress.total} games completed
          ${isLocked ? ' (Locked)' : ''}
          ${isCurrent ? ' — Current round' : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
      `;
    }

    const btnLock = document.getElementById('btnLockRound');
    if (btnLock) {
      btnLock.disabled = isLocked || !Standings.isRoundComplete(round);
      btnLock.textContent = isLocked ? 'Round Locked' : 'Lock Round';
    }

    const btnGen = document.getElementById('btnGenerateRound');
    if (btnGen) {
      btnGen.disabled =
        !isCurrent ||
        !Standings.isRoundComplete(round) ||
        state.currentRound >= state.settings.totalRounds;
    }

    if (contentEl) {
      if (!round.pairings || round.pairings.length === 0) {
        contentEl.innerHTML = '<div class="empty-state"><p>No pairings in this round</p></div>';
        return;
      }

      const canEdit = isCurrent && !isLocked;

      contentEl.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Board</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              ${round.pairings
                .map((p) => renderPairingRow(p, canEdit, round.number))
                .join('')}
            </tbody>
          </table>
        </div>
      `;

      if (canEdit) {
        contentEl.querySelectorAll('.result-btn').forEach((btn) => {
          btn.addEventListener('click', () => setResult(round.number, parseInt(btn.dataset.board, 10), btn.dataset.result));
        });
      }
    }
  }

  function renderPairingRow(pairing, canEdit, roundNum) {
    const white = Storage.getPlayerById(state, pairing.white);
    const black = pairing.black ? Storage.getPlayerById(state, pairing.black) : null;
    const isBye = pairing.isBye || !pairing.black;

    if (isBye) {
      return `
        <tr>
          <td class="board-num">${pairing.board}</td>
          <td colspan="2"><span class="player-name">${white ? App.escapeHtml(white.name) : '—'}</span> <span class="badge badge-round">BYE</span></td>
          <td><span class="badge badge-active">1.0</span></td>
        </tr>
      `;
    }

    const results = ['1-0', '0.5-0.5', '0-1'];
    const resultBtns = canEdit
      ? `<div class="result-btns">
          ${results
            .map(
              (r) =>
                `<button class="result-btn ${pairing.result === r ? 'selected' : ''}" data-board="${pairing.board}" data-result="${r}">${r}</button>`
            )
            .join('')}
        </div>`
      : `<strong>${pairing.result || '—'}</strong>`;

    return `
      <tr>
        <td class="board-num">${pairing.board}</td>
        <td>
          <span class="color-white">♔</span>
          <span class="player-name">${white ? App.escapeHtml(white.name) : '—'}</span>
          <span class="player-club">${white && white.rating ? '(' + white.rating + ')' : ''}</span>
        </td>
        <td>
          <span class="color-black">♚</span>
          <span class="player-name">${black ? App.escapeHtml(black.name) : '—'}</span>
          <span class="player-club">${black && black.rating ? '(' + black.rating + ')' : ''}</span>
        </td>
        <td>${resultBtns}</td>
      </tr>
    `;
  }

  function setResult(roundNum, board, result) {
    const round = Storage.getRoundByNumber(state, roundNum);
    if (!round || round.locked) return;

    const pairing = round.pairings.find((p) => p.board === board);
    if (!pairing || pairing.isBye) return;

    pairing.result = pairing.result === result ? null : result;
    Standings.calculateStandings(state);
    App.save();
    render();
    App.toast('Result saved', 'success');
  }

  async function lockRound() {
    const round = Storage.getRoundByNumber(state, viewRound);
    if (!round) return;

    if (!Standings.isRoundComplete(round)) {
      App.toast('Complete all results before locking', 'warning');
      return;
    }

    const ok = await App.confirm(`Lock Round ${round.number}? Results cannot be changed.`, 'Lock Round');
    if (!ok) return;

    round.locked = true;
    App.save();
    App.toast(`Round ${round.number} locked`, 'success');
    render();
  }
});
