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
        p.result || 'pending'
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

  return {
    exportJSON,
    importJSON,
    exportStandingsCSV,
    exportPairingsCSV
  };
})();
