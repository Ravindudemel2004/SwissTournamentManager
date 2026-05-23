/**
 * Swiss-system pairing engine with score grouping, conflict repair, and backtracking
 */
const PairingEngine = (function () {
  /**
   * Generate pairings for the next round
   * @param {Object} state - Full tournament state
   * @returns {{ pairings: Array, byePlayerId: string|null }}
   */
  function generatePairings(state) {
    const active = Storage.getActivePlayers(state)
      .map((p) => enrichPlayer(p, state))
      .sort(compareForPairing);

    if (active.length < 2) {
      return { pairings: [], byePlayerId: active.length === 1 ? active[0].id : null };
    }

    const scoreGroups = groupByScore(active);
    const floated = [];
    let byePlayerId = null;

    for (let gi = 0; gi < scoreGroups.length; gi++) {
      let group = scoreGroups[gi];
      if (floated.length) {
        group = floated.concat(group);
        floated.length = 0;
      }

      const result = pairScoreGroup(group, state, gi === scoreGroups.length - 1);
      floated.push(...result.remainder);
      if (result.byeId) byePlayerId = result.byeId;
    }

    if (floated.length === 1 && !byePlayerId) {
      byePlayerId = assignBye(floated, state);
      floated.length = 0;
    } else if (floated.length > 1) {
      const extra = pairRemaining(floated, state);
      if (extra.byeId) byePlayerId = extra.byeId;
    }

    const allPairings = collectPairingsFromRounds(state);
    return { pairings: allPairings, byePlayerId };
  }

  function enrichPlayer(player, state) {
    const stats = Standings.getPlayerStats(player.id, state);
    return {
      ...player,
      points: stats.points,
      colorBalance: stats.colorBalance,
      byeCount: (player.byes || []).length
    };
  }

  function compareForPairing(a, b) {
    if (b.points !== a.points) return b.points - a.points;
    return (b.rating || 0) - (a.rating || 0);
  }

  function groupByScore(players) {
    const map = new Map();
    players.forEach((p) => {
      const key = p.points.toFixed(2);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return Array.from(map.values()).sort((a, b) => b[0].points - a[0].points);
  }

  /**
   * Pair a score group using top-half vs bottom-half with repair/backtrack
   */
  function pairScoreGroup(group, state, isLastGroup) {
    const pairings = [];
    let players = [...group];

    if (players.length % 2 === 1) {
      const byeId = assignBye(players, state);
      players = players.filter((p) => p.id !== byeId);
      if (players.length === 0) {
        return { pairings: [], remainder: [], byeId };
      }
    }

    const attempt = tryPairGroup(players, state, []);
    if (attempt.success) {
      return { pairings: attempt.pairings, remainder: [], byeId: null };
    }

    // Float lowest player to next group if not last
    if (!isLastGroup && players.length > 0) {
      const sorted = [...players].sort(compareForPairing);
      const floated = sorted.pop();
      const retry = tryPairGroup(sorted, state, []);
      return {
        pairings: retry.pairings || [],
        remainder: retry.success ? [floated] : players,
        byeId: null
      };
    }

    const fallback = pairGreedyWithRepair(players, state);
    return { pairings: fallback, remainder: [], byeId: null };
  }

  /**
   * Top-half vs bottom-half pairing with backtracking on conflicts
   */
  function tryPairGroup(players, state, accumulated) {
    if (players.length === 0) {
      return { success: true, pairings: accumulated };
    }

    if (players.length === 1) {
      return { success: false, pairings: accumulated };
    }

    const sorted = [...players].sort(compareForPairing);
    const half = Math.ceil(sorted.length / 2);
    const top = sorted.slice(0, half);
    const bottom = sorted.slice(half).reverse();

    const result = pairHalves(top, bottom, state, accumulated, 0);
    return result;
  }

  function pairHalves(top, bottom, state, accumulated, topIndex) {
    if (topIndex >= top.length) {
      return { success: true, pairings: accumulated };
    }

    const topPlayer = top[topIndex];
    const candidates = bottom.filter((b) => !accumulated.some((p) => p.white === b.id || p.black === b.id));

    // Try natural opponent first (same index from bottom)
    const naturalIdx = top.length - 1 - topIndex;
    const tryOrder = [];

    if (naturalIdx >= 0 && naturalIdx < bottom.length) {
      tryOrder.push(bottom[naturalIdx]);
    }
    candidates.forEach((c) => {
      if (!tryOrder.find((t) => t.id === c.id)) tryOrder.push(c);
    });

    for (const bottomPlayer of tryOrder) {
      if (!bottomPlayer || accumulated.some((p) => p.white === bottomPlayer.id || p.black === bottomPlayer.id)) {
        continue;
      }

      if (alreadyPlayed(topPlayer.id, bottomPlayer.id, state)) {
        // Conflict repair: try swapping with another bottom player
        const repaired = repairPairings(top, bottom, topIndex, state, accumulated);
        if (repaired) return repaired;
        continue;
      }

      const colors = assignColors(topPlayer, bottomPlayer, state);
      const pairing = {
        white: colors.white,
        black: colors.black,
        result: null,
        board: accumulated.length + 1
      };

      const newTop = top.filter((_, i) => i !== topIndex);
      const newBottom = bottom.filter((b) => b.id !== bottomPlayer.id);
      const newAccum = [...accumulated, pairing];

      const rest = pairHalves(newTop, newBottom, state, newAccum, 0);
      if (rest.success) return rest;

      // Backtrack: try next candidate
    }

    // Backtrack: swap within bottom half
    const repaired = repairPairings(top, bottom, topIndex, state, accumulated);
    if (repaired) return repaired;

    return { success: false, pairings: accumulated };
  }

  /**
   * Attempt to repair conflicts by swapping bottom-half players
   */
  function repairPairings(top, bottom, topIndex, state, accumulated) {
    const topPlayer = top[topIndex];
    const availableBottom = bottom.filter(
      (b) => !accumulated.some((p) => p.white === b.id || p.black === b.id)
    );

    for (let i = 0; i < availableBottom.length; i++) {
      for (let j = i + 1; j < availableBottom.length; j++) {
        const swapped = [...bottom];
        const idxI = swapped.findIndex((b) => b.id === availableBottom[i].id);
        const idxJ = swapped.findIndex((b) => b.id === availableBottom[j].id);
        if (idxI < 0 || idxJ < 0) continue;

        [swapped[idxI], swapped[idxJ]] = [swapped[idxJ], swapped[idxI]];

        const result = pairHalves(top, swapped, state, accumulated, topIndex);
        if (result.success) return result;
      }
    }

    // Try pairing top player with any available bottom (full search)
    for (const bottomPlayer of availableBottom) {
      if (alreadyPlayed(topPlayer.id, bottomPlayer.id, state)) continue;

      const colors = assignColors(topPlayer, bottomPlayer, state);
      const pairing = {
        white: colors.white,
        black: colors.black,
        result: null,
        board: accumulated.length + 1
      };

      const newTop = top.filter((_, idx) => idx !== topIndex);
      const newBottom = bottom.filter((b) => b.id !== bottomPlayer.id);
      const rest = pairHalves(newTop, newBottom, state, [...accumulated, pairing], 0);
      if (rest.success) return rest;
    }

    return null;
  }

  function pairGreedyWithRepair(players, state) {
    const sorted = [...players].sort(compareForPairing);
    const pairings = [];
    const used = new Set();

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      let paired = false;

      for (let j = sorted.length - 1; j > i; j--) {
        if (used.has(sorted[j].id)) continue;
        if (alreadyPlayed(sorted[i].id, sorted[j].id, state)) continue;

        const colors = assignColors(sorted[i], sorted[j], state);
        pairings.push({
          white: colors.white,
          black: colors.black,
          result: null,
          board: pairings.length + 1
        });
        used.add(sorted[i].id);
        used.add(sorted[j].id);
        paired = true;
        break;
      }

      if (!paired && !used.has(sorted[i].id)) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j].id)) continue;
          const colors = assignColors(sorted[i], sorted[j], state);
          pairings.push({
            white: colors.white,
            black: colors.black,
            result: null,
            board: pairings.length + 1
          });
          used.add(sorted[i].id);
          used.add(sorted[j].id);
          break;
        }
      }
    }

    return pairings;
  }

  function pairRemaining(players, state) {
    const result = tryPairGroup(players, state, []);
    if (result.success) {
      return { pairings: result.pairings, byeId: null };
    }
    const byeId = players.length % 2 === 1 ? assignBye(players, state) : null;
    const filtered = byeId ? players.filter((p) => p.id !== byeId) : players;
    return { pairings: pairGreedyWithRepair(filtered, state), byeId };
  }

  /**
   * Assign bye to player with lowest score/rating who has fewest byes
   */
  function assignBye(players, state) {
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) => {
      if (a.points !== b.points) return a.points - b.points;
      if (a.byeCount !== b.byeCount) return a.byeCount - b.byeCount;
      return (a.rating || 0) - (b.rating || 0);
    });
    return sorted[0].id;
  }

  /**
   * Assign colors based on balance and settings
   */
  function assignColors(playerA, playerB, state) {
    const priority = state.settings.colorPriority || 'balance';
    const statsA = Standings.getPlayerStats(playerA.id, state);
    const statsB = Standings.getPlayerStats(playerB.id, state);

    let whiteId, blackId;

    if (priority === 'white') {
      whiteId = (playerA.rating || 0) >= (playerB.rating || 0) ? playerA.id : playerB.id;
      blackId = whiteId === playerA.id ? playerB.id : playerA.id;
    } else if (priority === 'black') {
      blackId = (playerA.rating || 0) >= (playerB.rating || 0) ? playerA.id : playerB.id;
      whiteId = blackId === playerA.id ? playerB.id : playerA.id;
    } else {
      // Balance: give white to player who needs white (lower color balance)
      if (statsA.colorBalance < statsB.colorBalance) {
        whiteId = playerA.id;
        blackId = playerB.id;
      } else if (statsB.colorBalance < statsA.colorBalance) {
        whiteId = playerB.id;
        blackId = playerA.id;
      } else {
        // Alternate by rating — lower rated gets white in equal balance
        if ((playerA.rating || 0) <= (playerB.rating || 0)) {
          whiteId = playerA.id;
          blackId = playerB.id;
        } else {
          whiteId = playerB.id;
          blackId = playerA.id;
        }
      }
    }

    // Prevent repeated color if possible
    const lastA = getLastColor(playerA.id, state);
    const lastB = getLastColor(playerB.id, state);

    if (lastA === 'white' && lastB !== 'white' && statsA.colorBalance >= statsB.colorBalance) {
      whiteId = playerB.id;
      blackId = playerA.id;
    } else if (lastA === 'black' && lastB !== 'black' && statsA.colorBalance <= statsB.colorBalance) {
      whiteId = playerA.id;
      blackId = playerB.id;
    }

    return { white: whiteId, black: blackId };
  }

  function getLastColor(playerId, state) {
    for (let r = state.rounds.length - 1; r >= 0; r--) {
      const round = state.rounds[r];
      for (const p of round.pairings || []) {
        if (p.isBye) continue;
        if (p.white === playerId) return 'white';
        if (p.black === playerId) return 'black';
      }
    }
    return null;
  }

  /**
   * Check if two players have already met
   */
  function alreadyPlayed(idA, idB, state) {
    const maxRematches = state.settings.maxRematches ?? 0;

    let meetings = 0;
    for (const round of state.rounds) {
      for (const p of round.pairings || []) {
        if (
          (p.white === idA && p.black === idB) ||
          (p.white === idB && p.black === idA)
        ) {
          meetings++;
        }
      }
    }
    return meetings > maxRematches;
  }

  function collectPairingsFromRounds(state) {
    return [];
  }

  /**
   * Build round pairings for a new round
   */
  function buildRoundPairings(state) {
    const active = Storage.getActivePlayers(state);
    if (active.length < 2) {
      throw new Error('Need at least 2 active players to generate pairings');
    }

    const enriched = active.map((p) => enrichPlayer(p, state)).sort(compareForPairing);
    const scoreGroups = groupByScore(enriched);
    const allPairings = [];
    let byePlayerId = null;
    const floatedDown = [];

    for (let g = 0; g < scoreGroups.length; g++) {
      let group = [...floatedDown, ...scoreGroups[g]];
      floatedDown.length = 0;

      if (group.length % 2 === 1) {
        byePlayerId = assignBye(group, state);
        const byePlayer = group.find((p) => p.id === byePlayerId);
        group = group.filter((p) => p.id !== byePlayerId);

        if (byePlayer) {
          allPairings.push({
            white: byePlayerId,
            black: null,
            result: 'bye',
            board: allPairings.length + 1,
            isBye: true
          });
        }
      }

      const paired = pairGroupIntoMatches(group, state, allPairings.length);
      if (paired.remainder.length > 0 && g < scoreGroups.length - 1) {
        floatedDown.push(...paired.remainder);
      } else if (paired.remainder.length > 0) {
        const extra = pairGroupIntoMatches(paired.remainder, state, allPairings.length);
        allPairings.push(...extra.pairings);
      }
      allPairings.push(...paired.pairings);
    }

    // Re-number boards
    allPairings.forEach((p, i) => {
      p.board = i + 1;
    });

    return { pairings: allPairings, byePlayerId };
  }

  function pairGroupIntoMatches(group, state, boardOffset) {
    if (group.length === 0) return { pairings: [], remainder: [] };
    if (group.length === 1) return { pairings: [], remainder: group };

    const sorted = [...group].sort(compareForPairing);
    const half = Math.floor(sorted.length / 2);
    const top = sorted.slice(0, half);
    const bottom = sorted.slice(half);

    const attempt = matchTopBottom(top, bottom, state, boardOffset, []);
    if (attempt.success) {
      return { pairings: attempt.pairings, remainder: [] };
    }

    const repaired = repairPairings(top, bottom, 0, state, []);
    if (repaired && repaired.success) {
      repaired.pairings.forEach((p, i) => {
        p.board = boardOffset + i + 1;
      });
      return { pairings: repaired.pairings, remainder: [] };
    }

    const greedy = pairGreedyWithRepair(sorted, state);
    greedy.forEach((p, i) => {
      p.board = boardOffset + i + 1;
    });
    const pairedIds = new Set();
    greedy.forEach((p) => {
      pairedIds.add(p.white);
      pairedIds.add(p.black);
    });
    const remainder = sorted.filter((p) => !pairedIds.has(p.id));

    return { pairings: greedy, remainder };
  }

  function matchTopBottom(top, bottom, state, boardOffset, accumulated) {
    if (top.length === 0) {
      return { success: true, pairings: accumulated };
    }

    const topPlayer = top[0];
    const remainingBottom = [...bottom];

    for (let i = 0; i < remainingBottom.length; i++) {
      const bottomPlayer = remainingBottom[i];

      if (alreadyPlayed(topPlayer.id, bottomPlayer.id, state)) {
        continue;
      }

      const colors = assignColors(topPlayer, bottomPlayer, state);
      const pairing = {
        white: colors.white,
        black: colors.black,
        result: null,
        board: boardOffset + accumulated.length + 1
      };

      const newTop = top.slice(1);
      const newBottom = remainingBottom.filter((_, idx) => idx !== i);

      const result = matchTopBottom(newTop, newBottom, state, boardOffset, [...accumulated, pairing]);
      if (result.success) return result;
    }

    return { success: false, pairings: accumulated };
  }

  return {
    generatePairings,
    buildRoundPairings,
    alreadyPlayed,
    assignBye,
    assignColors,
    repairPairings
  };
})();
