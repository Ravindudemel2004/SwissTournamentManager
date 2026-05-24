/**
 * Standings calculation with tie-breaks (FIDE compliant)
 */
const Standings = (function () {
  function getScoreValues(state) {
    return {
      win: state.settings.scoreWin ?? 1,
      draw: state.settings.scoreDraw ?? 0.5,
      loss: state.settings.scoreLoss ?? 0
    };
  }

  // FIDE Unplayed Rounds Management (Article 16.4)
  // Dummy opponent score = MIN(player's own score, max_draw_points)
  function getDummyOpponentScore(playerId, state) {
    const scores = getScoreValues(state);
    const ownScore = computePointsOnly(playerId, state);
    const maxDraws = (state.settings.totalRounds || 0) * scores.draw;
    return Math.min(ownScore, maxDraws);
  }

  // Points only — safe to call while computing Buchholz
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
    let wins = 0;
    let blackGames = 0;
    
    // For tie-breaks
    const gameResults = [];
    let ratedOpponentsSum = 0;
    let ratedOpponentsCount = 0;

    for (const round of state.rounds) {
      for (const pairing of round.pairings || []) {
        const isWhite = pairing.white === playerId;
        const isBlack = pairing.black === playerId;
        const isBye = pairing.isBye && pairing.white === playerId;

        if (!isWhite && !isBlack && !isBye) continue;

        if (isBye || (pairing.isBye && pairing.white === playerId)) {
          if (pairing.result === 'bye' || pairing.result === '1-0') {
            points += scores.win;
            wins++; // Art 7.1: With or without playing
            // FIDE Article 16 Dummy opponent for byes
            gameResults.push({ isDummy: true, score: scores.win });
          }
          continue;
        }

        if (pairing.result === null || pairing.result === 'pending') continue;

        gamesPlayed++;
        if (isWhite) colorBalance++;
        if (isBlack) {
          colorBalance--;
          blackGames++;
        }

        const oppId = isWhite ? pairing.black : pairing.white;
        
        // Grab opponent rating for ARO
        const oppPlayer = state.players.find(p => p.id === oppId);
        if (oppPlayer && oppPlayer.rating) {
            ratedOpponentsSum += oppPlayer.rating;
            ratedOpponentsCount++;
        }

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
          if (playerScore === scores.win) wins++;
          gameResults.push({ isDummy: false, opponentId: oppId, score: playerScore });
        }
      }
    }

    // Calculate Opponent-based tiebreaks
    const dummyScore = getDummyOpponentScore(playerId, state);
    const opponentScores = [];
    let sonneborn = 0;
    const opponents = [];

    gameResults.forEach((g) => {
      let oppPts = 0;
      if (g.isDummy) {
        oppPts = dummyScore;
      } else {
        oppPts = computePointsOnly(g.opponentId, state);
        if (!opponents.includes(g.opponentId)) opponents.push(g.opponentId);
      }
      
      opponentScores.push(oppPts);

      if (g.score >= scores.win) {
        sonneborn += oppPts;
      } else if (g.score >= scores.draw) {
        sonneborn += oppPts * 0.5;
      }
    });

    const buchholz = opponentScores.reduce((sum, pts) => sum + pts, 0);
    
    // Buchholz Cut-1 (exclude lowest opponent score)
    let buchholz_cut1 = buchholz;
    if (opponentScores.length > 0) {
       const minScore = Math.min(...opponentScores);
       buchholz_cut1 -= minScore;
    }

    const aro = ratedOpponentsCount > 0 ? Math.round(ratedOpponentsSum / ratedOpponentsCount) : 0;

    return {
      points,
      gamesPlayed,
      colorBalance,
      buchholz,
      buchholz_cut1,
      sonneborn,
      wins,
      blackGames,
      aro,
      opponents,
      gameResults
    };
  }

  function getPointsForPlayer(playerId, state) {
    return computePointsOnly(playerId, state);
  }

  function calculateStandings(state) {
    const players = state.players.filter((p) => p.active);
    
    // FIDE defaults
    const defaultTieBreak = ['direct_encounter', 'buchholz_cut1', 'buchholz', 'sonneborn', 'wins'];
    const tieOrder = state.settings.tieBreakOrder || defaultTieBreak;

    const standings = players.map((player) => {
      const stats = getPlayerStats(player.id, state);
      return {
        ...player,
        points: stats.points,
        buchholz: stats.buchholz,
        buchholz_cut1: stats.buchholz_cut1,
        sonneborn: stats.sonneborn,
        wins: stats.wins,
        blackGames: stats.blackGames,
        aro: stats.aro,
        gamesPlayed: stats.gamesPlayed,
        colorBalance: stats.colorBalance,
        opponents: stats.opponents,
        gameResults: stats.gameResults
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
        p.buchholz_cut1 = s.buchholz_cut1;
        p.sonneborn = s.sonneborn;
        p.wins = s.wins;
        p.blackGames = s.blackGames;
        p.aro = s.aro;
        p.colorBalance = s.colorBalance;
        p.opponents = s.opponents;
      }
    });

    return standings;
  }

  function comparePlayers(a, b, tieOrder) {
    if (b.points !== a.points) return b.points - a.points;

    for (const tie of tieOrder) {
      if (tie === 'buchholz_cut1' && b.buchholz_cut1 !== a.buchholz_cut1) return b.buchholz_cut1 - a.buchholz_cut1;
      if (tie === 'buchholz' && b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      if (tie === 'sonneborn' && b.sonneborn !== a.sonneborn) return b.sonneborn - a.sonneborn;
      if (tie === 'wins' && b.wins !== a.wins) return b.wins - a.wins;
      if (tie === 'black_games' && b.blackGames !== a.blackGames) return b.blackGames - a.blackGames;
      if (tie === 'aro' && b.aro !== a.aro) return b.aro - a.aro;
      if (tie === 'rating' && (b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      
      // Direct Encounter
      if (tie === 'direct_encounter') {
         // Check if A played B
         let scoreA = 0;
         let scoreB = 0;
         let played = false;
         
         a.gameResults.forEach(g => {
            if (!g.isDummy && g.opponentId === b.id) {
               scoreA += g.score;
               played = true;
            }
         });
         
         b.gameResults.forEach(g => {
            if (!g.isDummy && g.opponentId === a.id) {
               scoreB += g.score;
               played = true;
            }
         });
         
         if (played && scoreB !== scoreA) {
            return scoreB - scoreA;
         }
      }
    }

    // Final fallback: Initial seeding order (TPN) or name
    if (a.tpn && b.tpn && a.tpn !== b.tpn) return a.tpn - b.tpn;
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
