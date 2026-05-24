/**
 * Import/Export tournament data (JSON and CSV)
 */
const ExportManager = (function () {
  function exportJSON(state) {
    const data = JSON.stringify(state, null, 2);
    downloadFile(data, getFileName(state, 'json'), 'application/json');
  }

  function importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.players || !data.settings) {
            reject(new Error('Invalid tournament file format'));
            return;
          }
          if (!data.tournamentId) {
            data.tournamentId = Storage.generateTournamentId();
          }
          resolve(data);
        } catch (err) {
          reject(new Error('Could not parse JSON file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  function exportStandingsCSV(state) {
    const standings = Standings.calculateStandings(state);
    const headers = ['Rank', 'Name', 'Rating', 'Club', 'Points', 'Buchholz', 'Sonneborn-Berger', 'Games', 'Color Balance'];
    const rows = standings.map((p) => [
      p.rank,
      escapeCSV(p.name),
      p.rating || 0,
      escapeCSV(p.club || ''),
      p.points,
      p.buchholz.toFixed(1),
      p.sonneborn.toFixed(1),
      p.gamesPlayed,
      p.colorBalance
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(csv, getFileName(state, 'standings.csv'), 'text/csv');
  }

  function safeExcelString(str) {
    if (!str || str === 'pending') return 'pending';
    if (str === '1-0' || str === '0-1' || str === '0.5-0.5' || str === '1/2-1/2') {
      return `="${str}"`;
    }
    return str;
  }

  function exportPairingsCSV(state, roundNumber) {
    const round = Storage.getRoundByNumber(state, roundNumber || state.currentRound);
    if (!round) {
      throw new Error('No round to export');
    }

    const headers = ['Board', 'White', 'Black', 'Result'];
    const rows = (round.pairings || []).map((p) => {
      const white = Storage.getPlayerById(state, p.white);
      const black = p.black ? Storage.getPlayerById(state, p.black) : null;
      return [
        p.board,
        escapeCSV(white ? white.name : 'BYE'),
        escapeCSV(black ? black.name : 'BYE'),
        escapeCSV(safeExcelString(p.result))
      ];
    });

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const name = getFileName(state, `round${round.number}_pairings.csv`);
    downloadFile(csv, name, 'text/csv');
  }

  function escapeCSV(str) {
    if (str == null) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function getFileName(state, ext) {
    const name = (state.settings.name || 'tournament').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    return `${name}_${date}.${ext}`;
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportResultsCSV(state, roundNumber) {
    const round = Storage.getRoundByNumber(state, roundNumber || state.currentRound);
    if (!round) throw new Error('No round to export');

    const headers = ['Round', 'Board', 'White', 'Black', 'Result', 'White Pts', 'Black Pts'];
    const rows = (round.pairings || []).map((p) => {
      const white = Storage.getPlayerById(state, p.white);
      const black = p.black ? Storage.getPlayerById(state, p.black) : null;
      const wPts = getResultPoints(state, p.white, p);
      const bPts = p.black ? getResultPoints(state, p.black, p) : '';
      return [
        round.number,
        p.board,
        escapeCSV(white ? white.name : ''),
        escapeCSV(black ? black.name : 'BYE'),
        escapeCSV(safeExcelString(p.isBye ? 'bye' : p.result)),
        wPts !== null ? wPts : '',
        bPts !== null && bPts !== '' ? bPts : ''
      ];
    });

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(csv, getFileName(state, `round${round.number}_results.csv`), 'text/csv');
  }

  function exportAllResultsCSV(state) {
    if (!state.rounds.length) throw new Error('No results to export');

    const roundNums = state.rounds.map((r) => r.number);
    const headers = ['Player', 'Rating', ...roundNums.map((n) => `R${n}`), 'Total Points'];
    const players = state.players.filter((p) => p.active);

    const rows = players.map((player) => {
      const stats = Standings.getPlayerStats(player.id, state);
      const roundCells = state.rounds.map((round) => {
        const cell = getMatrixCell(state, player.id, round);
        return escapeCSV(cell);
      });
      return [
        escapeCSV(player.name),
        player.rating || 0,
        ...roundCells,
        stats.points
      ];
    });

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(csv, getFileName(state, 'all_results.csv'), 'text/csv');
  }

  function getResultPoints(state, playerId, pairing) {
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
    if (r === '0.5-0.5') return scores.draw;
    return null;
  }

  function getMatrixCell(state, playerId, round) {
    for (const p of round.pairings || []) {
      if (p.isBye && p.white === playerId) return 'BYE';
      if (p.white !== playerId && p.black !== playerId) continue;
      if (!p.result || p.result === 'pending') return '';
      const isWhite = p.white === playerId;
      if (p.result === '0.5-0.5') return 'D';
      if (p.result === '1-0') return isWhite ? 'W' : 'L';
      if (p.result === '0-1') return isWhite ? 'L' : 'W';
    }
    return '';
  }

  return {
    exportJSON,
    importJSON,
    exportStandingsCSV,
    exportPairingsCSV,
    exportResultsCSV,
    exportAllResultsCSV
  };
})();
