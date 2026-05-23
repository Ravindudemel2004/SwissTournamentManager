/**
 * Standings calculation with tie-breaks
 */
const Standings = (function () {
  function getScoreValues(state) {
    return {
      win: state.settings.scoreWin ?? 1,
      draw: state.settings.scoreDraw ?? 0.5,
      loss: state.settings.scoreLoss ?? 0
    };
  }

  /** Points only — safe to call while computing Buchholz (no circular stats) */
  function computePointsOnly(playerId, state) {
    const scores = getScoreValues(state);
    let points = 0;

    for (const round of state.rounds) {
      for (const pairing of round.pairings || []) {
        const isWhite = pairing.white === playerId;
        const isBlack = pairing.black === playerId;
        const isBye = pairing.isBye && pairing.white === playerId;

        if (!isWhite && !isBlack && !isBye) continue;

        if (isBye || (pairing.isBye && pairing.white === playerId)) {
          if (pairing.result === 'bye' || pairing.result === '1-0') {
            points += scores.win;
          }
          continue;
        }

        if (pairing.result === null || pairing.result === 'pending') continue;

        if (pairing.result === '1-0') {
          points += isWhite ? scores.win : scores.loss;
        } else if (pairing.result === '0-1') {
          points += isBlack ? scores.win : scores.loss;
        } else if (pairing.result === '0.5-0.5' || pairing.result === '1/2-1/2') {
          points += scores.draw;
        }
      }
    }

    return points;
  }

  function getPlayerStats(playerId, state) {
    const scores = getScoreValues(state);
    let points = 0;
    let gamesPlayed = 0;
    let colorBalance = 0;
    const opponentIds = [];
    const gameResults = [];

    for (const round of state.rounds) {
      for (const pairing of round.pairings || []) {
        const isWhite = pairing.white === playerId;
        const isBlack = pairing.black === playerId;
        const isBye = pairing.isBye && pairing.white === playerId;

        if (!isWhite && !isBlack && !isBye) continue;

        if (isBye || (pairing.isBye && pairing.white === playerId)) {
          if (pairing.result === 'bye' || pairing.result === '1-0') {
            points += scores.win;
            gamesPlayed++;
          }
          continue;
        }

        if (pairing.result === null || pairing.result === 'pending') continue;

        gamesPlayed++;
        if (isWhite) colorBalance++;
        if (isBlack) colorBalance--;

        const oppId = isWhite ? pairing.black : pairing.white;
        if (oppId) opponentIds.push(oppId);

        let playerScore = null;
        if (pairing.result === '1-0') {
          playerScore = isWhite ? scores.win : scores.loss;
        } else if (pairing.result === '0-1') {
          playerScore = isBlack ? scores.win : scores.loss;
        } else if (pairing.result === '0.5-0.5' || pairing.result === '1/2-1/2') {
          playerScore = scores.draw;
        }

        if (playerScore !== null) {
          points += playerScore;
          gameResults.push({ opponentId: oppId, score: playerScore });
        }
      }
    }

    // Use points-only for opponents — avoids infinite recursion in Buchholz / S-B
    const uniqueOpponents = [...new Set(opponentIds)];
    const buchholz = uniqueOpponents.reduce(
      (sum, oid) => sum + computePointsOnly(oid, state),
      0
    );

    let sonneborn = 0;
    gameResults.forEach((g) => {
      const oppPts = computePointsOnly(g.opponentId, state);
      if (g.score >= scores.win) {
        sonneborn += oppPts;
      } else if (g.score >= scores.draw) {
        sonneborn += oppPts * 0.5;
      }
    });

    return {
      points,
      gamesPlayed,
      colorBalance,
      buchholz,
      sonneborn,
      opponents: uniqueOpponents
    };
  }

  function getPointsForPlayer(playerId, state) {
    return computePointsOnly(playerId, state);
  }

  function calculateStandings(state) {
    const players = state.players.filter((p) => p.active);
    const tieOrder = state.settings.tieBreakOrder || ['buchholz', 'sonneborn', 'rating'];

    const standings = players.map((player) => {
      const stats = getPlayerStats(player.id, state);
      return {
        ...player,
        points: stats.points,
        buchholz: stats.buchholz,
        sonneborn: stats.sonneborn,
        gamesPlayed: stats.gamesPlayed,
        colorBalance: stats.colorBalance,
        opponents: stats.opponents
      };
    });

    standings.sort((a, b) => comparePlayers(a, b, tieOrder));

    standings.forEach((p, index) => {
      p.rank = index + 1;
    });

    standings.forEach((s) => {
      const p = state.players.find((pl) => pl.id === s.id);
      if (p) {
        p.points = s.points;
        p.buchholz = s.buchholz;
        p.sonneborn = s.sonneborn;
        p.colorBalance = s.colorBalance;
        p.opponents = s.opponents;
      }
    });

    return standings;
  }

  function comparePlayers(a, b, tieOrder) {
    if (b.points !== a.points) return b.points - a.points;

    for (const tie of tieOrder) {
      if (tie === 'buchholz' && b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      if (tie === 'sonneborn' && b.sonneborn !== a.sonneborn) return b.sonneborn - a.sonneborn;
      if (tie === 'rating' && (b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
    }

    return a.name.localeCompare(b.name);
  }

  function isRoundComplete(round) {
    if (!round || !round.pairings) return false;
    return round.pairings.every((p) => {
      if (p.isBye) return p.result === 'bye' || p.result === '1-0';
      return p.result !== null && p.result !== 'pending';
    });
  }

  function getRoundProgress(round) {
    if (!round || !round.pairings || round.pairings.length === 0) {
      return { completed: 0, total: 0, percent: 0 };
    }
    const total = round.pairings.length;
    const completed = round.pairings.filter((p) => {
      if (p.isBye) return true;
      return p.result !== null && p.result !== 'pending';
    }).length;
    return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
  }

  function canAdvanceRound(state) {
    const current = Storage.getCurrentRoundData(state);
    if (!current) return state.currentRound === 0;
    return isRoundComplete(current);
  }

  return {
    getPlayerStats,
    calculateStandings,
    comparePlayers,
    isRoundComplete,
    getRoundProgress,
    canAdvanceRound,
    getPointsForPlayer,
    computePointsOnly
  };
})();
