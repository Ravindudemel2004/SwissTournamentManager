/**
 * Results page — view and edit round results, results grid across rounds
 */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.renderLayout('Results');

  let state = App.getState();
  let viewRound = state.currentRound || 1;
  let viewMode = 'round'; // 'round' | 'matrix'

  init();

  function init() {
    bindEvents();
    if (state.currentRound > 0) viewRound = state.currentRound;
    render();
  }

  function bindEvents() {
    document.getElementById('btnViewRound')?.addEventListener('click', () => {
      viewMode = 'round';
      updateViewButtons();
      render();
    });
    document.getElementById('btnViewMatrix')?.addEventListener('click', () => {
      viewMode = 'matrix';
      updateViewButtons();
      render();
    });
    document.getElementById('btnExportResults')?.addEventListener('click', () => {
      try {
        if (viewMode === 'matrix') {
          ExportManager.exportAllResultsCSV(state);
        } else {
          ExportManager.exportResultsCSV(state, viewRound);
        }
        App.toast('Results exported', 'success');
      } catch (e) {
        App.toast(e.message, 'error');
      }
    });
  }

  function updateViewButtons() {
    const roundBtn = document.getElementById('btnViewRound');
    const matrixBtn = document.getElementById('btnViewMatrix');
    if (roundBtn) roundBtn.classList.toggle('btn-primary', viewMode === 'round');
    if (roundBtn) roundBtn.classList.toggle('btn-secondary', viewMode !== 'round');
    if (matrixBtn) matrixBtn.classList.toggle('btn-primary', viewMode === 'matrix');
    if (matrixBtn) matrixBtn.classList.toggle('btn-secondary', viewMode !== 'matrix');
  }

  function bindRoundTabs() {
    document.querySelectorAll('.round-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const val = tab.dataset.round;
        if (val === 'all') {
          viewMode = 'matrix';
          updateViewButtons();
        } else {
          viewRound = parseInt(val, 10);
          viewMode = 'round';
          updateViewButtons();
        }
        render();
      });
    });
  }

  function render() {
    state = App.getState();
    updateViewButtons();

    const tabsEl = document.getElementById('roundTabs');
    const contentEl = document.getElementById('resultsContent');
    const roundInfo = document.getElementById('roundInfo');

    if (!state.rounds.length) {
      if (tabsEl) tabsEl.innerHTML = '';
      if (roundInfo) roundInfo.innerHTML = '';
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">✓</div>
            <h3>No results yet</h3>
            <p>Generate pairings and play Round 1 to see results here.</p>
            <a href="pairings.html" class="btn btn-primary" style="margin-top:1rem;display:inline-flex">Go to Pairings</a>
          </div>`;
      }
      return;
    }

    if (viewRound < 1 || !Storage.getRoundByNumber(state, viewRound)) {
      viewRound = state.currentRound || state.rounds[0].number;
    }

    if (tabsEl) {
      const matrixActive = viewMode === 'matrix';
      tabsEl.innerHTML =
        `<button class="round-tab ${matrixActive ? 'active' : ''}" data-round="all">All Rounds</button>` +
        state.rounds
          .map(
            (r) => `
        <button class="round-tab ${!matrixActive && r.number === viewRound ? 'active' : ''} ${r.locked ? 'locked' : ''}" data-round="${r.number}">
          R${r.number}
        </button>
      `
          )
          .join('');
      bindRoundTabs();
    }

    if (viewMode === 'matrix') {
      if (roundInfo) {
        roundInfo.innerHTML = `<div class="alert alert-info">Cross-table of every player’s result in each round.</div>`;
      }
      if (contentEl) contentEl.innerHTML = renderMatrixView();
      return;
    }

    const round = Storage.getRoundByNumber(state, viewRound);
    if (!round) return;

    const progress = Standings.getRoundProgress(round);
    const isCurrent = round.number === state.currentRound;
    const isLocked = round.locked;
    const canEdit = isCurrent && !isLocked;

    if (roundInfo) {
      roundInfo.innerHTML = `
        <div class="alert ${progress.percent === 100 ? 'alert-success' : 'alert-info'}">
          Round ${round.number} results — ${progress.completed}/${progress.total} games recorded
          ${isLocked ? ' · Locked' : ''}
          ${canEdit ? ' · Click a result to edit' : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
      `;
    }

    if (contentEl) {
      contentEl.innerHTML = renderRoundView(round, canEdit);
      if (canEdit) {
        contentEl.querySelectorAll('.result-btn').forEach((btn) => {
          btn.addEventListener('click', () =>
            setResult(round.number, parseInt(btn.dataset.board, 10), btn.dataset.result)
          );
        });
      }
    }
  }

  function formatResultBadge(result, isBye) {
    if (isBye) return '<span class="result-badge result-bye">BYE</span>';
    if (!result || result === 'pending') {
      return '<span class="result-badge result-pending">—</span>';
    }
    const cls =
      result === '1-0' ? 'result-win' : result === '0-1' ? 'result-loss' : 'result-draw';
    return `<span class="result-badge ${cls}">${result}</span>`;
  }

  function getPlayerRoundScore(playerId, pairing) {
    const scores = {
      win: state.settings.scoreWin ?? 1,
      draw: state.settings.scoreDraw ?? 0.5,
      loss: state.settings.scoreLoss ?? 0
    };
    if (pairing.isBye && pairing.white === playerId) return scores.win;

    const isWhite = pairing.white === playerId;
    const isBlack = pairing.black === playerId;
    if (!isWhite && !isBlack) return null;

    const r = pairing.result;
    if (!r || r === 'pending') return null;
    if (r === '1-0') return isWhite ? scores.win : scores.loss;
    if (r === '0-1') return isBlack ? scores.win : scores.loss;
    if (r === '0.5-0.5' || r === '1/2-1/2') return scores.draw;
    return null;
  }

  function renderRoundView(round, canEdit) {
    if (!round.pairings || round.pairings.length === 0) {
      return '<div class="empty-state"><p>No games in this round</p></div>';
    }

    const rows = round.pairings
      .map((p) => {
        const white = Storage.getPlayerById(state, p.white);
        const black = p.black ? Storage.getPlayerById(state, p.black) : null;
        const isBye = p.isBye || !p.black;

        if (isBye) {
          return `
          <tr>
            <td class="board-num">${p.board}</td>
            <td colspan="2"><span class="player-name">${white ? App.escapeHtml(white.name) : '—'}</span> <span class="badge badge-round">BYE</span></td>
            <td>${formatResultBadge('bye', true)}</td>
            <td class="hide-mobile"><strong>${state.settings.scoreWin ?? 1}</strong></td>
          </tr>`;
        }

        const whitePts = getPlayerRoundScore(p.white, p);
        const blackPts = p.black ? getPlayerRoundScore(p.black, p) : null;

        const resultCell = canEdit
          ? `<div class="result-btns">
              ${['1-0', '0.5-0.5', '0-1']
                .map(
                  (r) =>
                    `<button class="result-btn ${p.result === r ? 'selected' : ''}" data-board="${p.board}" data-result="${r}">${r}</button>`
                )
                .join('')}
            </div>`
          : formatResultBadge(p.result, false);

        return `
        <tr>
          <td class="board-num">${p.board}</td>
          <td>
            <span class="color-white">♔</span>
            <span class="player-name">${white ? App.escapeHtml(white.name) : '—'}</span>
            <span class="player-club hide-mobile">${white && white.rating ? '(' + white.rating + ')' : ''}</span>
          </td>
          <td>
            <span class="color-black">♚</span>
            <span class="player-name">${black ? App.escapeHtml(black.name) : '—'}</span>
            <span class="player-club hide-mobile">${black && black.rating ? '(' + black.rating + ')' : ''}</span>
          </td>
          <td>${resultCell}</td>
          <td class="hide-mobile result-points-cell">
            <span class="color-white">${whitePts !== null ? App.formatPoints(whitePts) : '—'}</span>
            :
            <span class="color-black">${blackPts !== null ? App.formatPoints(blackPts) : '—'}</span>
          </td>
        </tr>`;
      })
      .join('');

    return `
      <div class="table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th>Board</th>
              <th>White</th>
              <th>Black</th>
              <th>Result</th>
              <th class="hide-mobile">Pts (W:B)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function getPlayerResultInRound(playerId, round) {
    for (const p of round.pairings || []) {
      if (p.isBye && p.white === playerId) {
        return {
          text: 'Bye',
          short: 'BYE',
          class: 'result-bye',
          pts: state.settings.scoreWin ?? 1
        };
      }
      if (p.white !== playerId && p.black !== playerId) continue;

      const isWhite = p.white === playerId;
      const opp = isWhite
        ? Storage.getPlayerById(state, p.black)
        : Storage.getPlayerById(state, p.white);
      const oppName = opp ? opp.name.split(' ')[0] : '?';
      const pts = getPlayerRoundScore(playerId, p);

      if (!p.result || p.result === 'pending') {
        return { text: 'Pending', short: '—', class: 'result-pending', pts: null };
      }

      let short = 'D';
      let cls = 'result-draw';
      if (p.result === '1-0') {
        short = isWhite ? 'W' : 'L';
        cls = isWhite ? 'result-win' : 'result-loss';
      } else if (p.result === '0-1') {
        short = isWhite ? 'L' : 'W';
        cls = isWhite ? 'result-loss' : 'result-win';
      }

      return {
        text: `${short} vs ${oppName}`,
        short,
        class: cls,
        pts
      };
    }
    return { text: '—', short: '—', class: 'result-none', pts: null };
  }

  function renderMatrixView() {
    const players = state.players
      .filter((p) => p.active)
      .sort((a, b) => {
        const sa = Standings.getPlayerStats(a.id, state);
        const sb = Standings.getPlayerStats(b.id, state);
        if (sb.points !== sa.points) return sb.points - sa.points;
        return a.name.localeCompare(b.name);
      });

    if (players.length === 0) {
      return '<div class="empty-state"><p>No active players</p></div>';
    }

    const roundHeaders = state.rounds
      .map((r) => `<th>R${r.number}</th>`)
      .join('');

    const rows = players
      .map((player) => {
        const stats = Standings.getPlayerStats(player.id, state);
        const cells = state.rounds
          .map((round) => {
            const res = getPlayerResultInRound(player.id, round);
            const pts =
              res.pts !== null && res.pts !== undefined
                ? `<small>${App.formatPoints(res.pts)}</small>`
                : '';
            return `<td title="${App.escapeHtml(res.text)}"><span class="result-badge ${res.class}">${res.short || res.text}</span>${pts}</td>`;
          })
          .join('');

        return `
        <tr>
          <td><span class="player-name">${App.escapeHtml(player.name)}</span></td>
          ${cells}
          <td><strong>${App.formatPoints(stats.points)}</strong></td>
        </tr>`;
      })
      .join('');

    return `
      <div class="table-wrapper">
        <table class="results-matrix-table">
          <thead>
            <tr>
              <th>Player</th>
              ${roundHeaders}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="form-hint" style="margin-top:0.75rem">W = win, L = loss, D = draw, BYE = bye. Small numbers show points scored that round.</p>
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
    App.toast('Result updated', 'success');
  }
});
