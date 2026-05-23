/**
 * Import players from Excel (.xlsx, .xls) and CSV using SheetJS
 */
const ExcelImport = (function () {
  const COLUMN_ALIASES = {
    name: ['name', 'player', 'player name', 'fullname', 'full name', 'competitor'],
    rating: ['rating', 'elo', 'fide', 'uscf', 'rtg', 'rank rating'],
    club: ['club', 'team', 'school', 'organization', 'organisation', 'affiliation'],
    active: ['active', 'status', 'playing', 'entered']
  };

  function normalizeHeader(str) {
    return String(str || '')
      .trim()
      .toLowerCase()
      .replace(/[_\-]+/g, ' ');
  }

  function detectColumnMap(headerRow) {
    const map = {};
    headerRow.forEach((cell, index) => {
      const h = normalizeHeader(cell);
      if (!h) return;
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.some((a) => h === a || h.includes(a))) {
          if (map[field] === undefined) map[field] = index;
        }
      }
    });
    return map;
  }

  function parseActive(val) {
    const s = String(val || '').trim().toLowerCase();
    if (!s) return true;
    if (['no', 'n', '0', 'false', 'inactive', 'out', 'withdrawn'].includes(s)) return false;
    return true;
  }

  function parseRating(val) {
    const n = parseInt(String(val).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : Math.min(3000, Math.max(0, n));
  }

  function parseRows(rows) {
    if (!rows || rows.length === 0) {
      throw new Error('Excel file is empty');
    }

    let headerIndex = -1;
    let colMap = null;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const map = detectColumnMap(row);
      if (map.name !== undefined) {
        headerIndex = i;
        colMap = map;
        break;
      }
    }

    if (!colMap || colMap.name === undefined) {
      throw new Error(
        'Could not find a "Name" column. Use headers: Name, Rating, Club, Active'
      );
    }

    const players = [];
    const errors = [];

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      const name = String(row[colMap.name] || '').trim();
      if (!name) continue;

      const rating = colMap.rating !== undefined ? parseRating(row[colMap.rating]) : 0;
      const club = colMap.club !== undefined ? String(row[colMap.club] || '').trim() : '';
      const active =
        colMap.active !== undefined ? parseActive(row[colMap.active]) : true;

      if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        errors.push(`Duplicate skipped: ${name}`);
        continue;
      }

      players.push({ name, rating, club, active });
    }

    if (players.length === 0) {
      throw new Error('No valid players found in the file');
    }

    return { players, errors };
  }

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('Excel library not loaded. Check your internet connection.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', raw: false });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            reject(new Error('No sheets found in workbook'));
            return;
          }
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          resolve(parseRows(rows));
        } catch (err) {
          reject(new Error(err.message || 'Could not parse Excel file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function importPlayers(file) {
    return readWorkbook(file);
  }

  function applyPlayersToState(state, parsedPlayers, mode) {
    const newPlayers = parsedPlayers.map((row) => Storage.createPlayerFromRow(row));

    if (mode === 'replace') {
      state.players = newPlayers;
    } else {
      const existingNames = new Set(state.players.map((p) => p.name.toLowerCase()));
      newPlayers.forEach((p) => {
        if (!existingNames.has(p.name.toLowerCase())) {
          state.players.push(p);
          existingNames.add(p.name.toLowerCase());
        }
      });
    }

    if (state.players.length > 64) {
      throw new Error(`Too many players (${state.players.length}). Maximum is 64.`);
    }

    return state;
  }

  function downloadTemplate() {
    if (typeof XLSX === 'undefined') {
      throw new Error('Excel library not loaded');
    }

    const rows = [
      ['Name', 'Rating', 'Club', 'Active'],
      ['Alice Perera', 1650, 'Colombo Chess Club', 'Yes'],
      ['Bob Silva', 1520, 'Kandy Chess Club', 'Yes'],
      ['Carla Fernando', 1400, 'Galle Chess Club', 'Yes']
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 24 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Players');
    XLSX.writeFile(wb, 'player_import_template.xlsx');
  }

  return {
    importPlayers,
    applyPlayersToState,
    downloadTemplate,
    parseRows
  };
})();
