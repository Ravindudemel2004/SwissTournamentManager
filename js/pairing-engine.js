/**
 * Swiss-system pairing engine — optimized with cached history & bounded search
 */
const PairingEngine = (function () {
  const BACKTRACK_LIMIT = 5000; // prevent UI freeze on large groups

  function pairKey(idA, idB) {
    return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  }

  /** Precompute meeting counts, stats, and colors once per round generation */
  function buildContext(state) {
    const maxRematches = state.settings.maxRematches ?? 0;
    const meetingCount = new Map();

    for (const round of state.rounds) {
      for (const p of round.pairings || []) {
        if (!p.black || p.isBye) continue;
        const key = pairKey(p.white, p.black);
        meetingCount.set(key, (meetingCount.get(key) || 0) + 1);
      }
    }

    const statsCache = new Map();
    const lastColor = new Map();
    const active = Storage.getActivePlayers(state);

    for (const p of active) {
      statsCache.set(p.id, Standings.getPlayerStats(p.id, state));
      lastColor.set(p.id, computeLastColor(p.id, state));
    }

    return { state, maxRematches, meetingCount, statsCache, lastColor };
  }

  function computeLastColor(playerId, state) {
    for (let r = state.rounds.length - 1; r >= 0; r--) {
      for (const p of state.rounds[r].pairings || []) {
        if (p.isBye) continue;
        if (p.white === playerId) return 'white';
        if (p.black === playerId) return 'black';
      }
    }
    return null;
  }

  function hasPlayed(ctx, idA, idB) {
    const meetings = ctx.meetingCount.get(pairKey(idA, idB)) || 0;
    return meetings > ctx.maxRematches;
  }

  function enrichPlayer(player, ctx) {
    const stats = ctx.statsCache.get(player.id) || { points: 0, colorBalance: 0 };
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

  function assignBye(players) {
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) => {
      if (a.points !== b.points) return a.points - b.points;
      if (a.byeCount !== b.byeCount) return a.byeCount - b.byeCount;
      return (a.rating || 0) - (b.rating || 0);
    });
    return sorted[0].id;
  }

  function assignColors(playerA, playerB, ctx) {
    const priority = ctx.state.settings.colorPriority || 'balance';
    const statsA = ctx.statsCache.get(playerA.id) || { colorBalance: 0 };
    const statsB = ctx.statsCache.get(playerB.id) || { colorBalance: 0 };

    let whiteId, blackId;

    if (priority === 'white') {
      whiteId = (playerA.rating || 0) >= (playerB.rating || 0) ? playerA.id : playerB.id;
      blackId = whiteId === playerA.id ? playerB.id : playerA.id;
    } else if (priority === 'black') {
      blackId = (playerA.rating || 0) >= (playerB.rating || 0) ? playerA.id : playerB.id;
      whiteId = blackId === playerA.id ? playerB.id : playerA.id;
    } else if (statsA.colorBalance < statsB.colorBalance) {
      whiteId = playerA.id;
      blackId = playerB.id;
    } else if (statsB.colorBalance < statsA.colorBalance) {
      whiteId = playerB.id;
      blackId = playerA.id;
    } else if ((playerA.rating || 0) <= (playerB.rating || 0)) {
      whiteId = playerA.id;
      blackId = playerB.id;
    } else {
      whiteId = playerB.id;
      blackId = playerA.id;
    }

    const lastA = ctx.lastColor.get(playerA.id);
    const lastB = ctx.lastColor.get(playerB.id);

    if (lastA === 'white' && lastB !== 'white' && statsA.colorBalance >= statsB.colorBalance) {
      whiteId = playerB.id;
      blackId = playerA.id;
    } else if (lastA === 'black' && lastB !== 'black' && statsA.colorBalance <= statsB.colorBalance) {
      whiteId = playerA.id;
      blackId = playerB.id;
    }

    return { white: whiteId, black: blackId };
  }

  /**
   * Fast top-vs-bottom pairing with bounded backtracking
   */
  function pairGroup(group, ctx, boardOffset) {
    if (group.length === 0) return { pairings: [], remainder: [] };
    if (group.length === 1) return { pairings: [], remainder: group };

    const sorted = [...group].sort(compareForPairing);
    const half = Math.floor(sorted.length / 2);
    const top = sorted.slice(0, half);
    const bottom = sorted.slice(half);

    let steps = 0;
    const result = matchTopBottom(top, bottom, ctx, boardOffset, [], () => ++steps > BACKTRACK_LIMIT);

    if (result.success) {
      return { pairings: result.pairings, remainder: [] };
    }

    return { pairings: pairGreedy(sorted, ctx, boardOffset), remainder: [] };
  }

  function matchTopBottom(top, bottom, ctx, boardOffset, accumulated, shouldAbort) {
    if (shouldAbort()) return { success: false, pairings: accumulated };
    if (top.length === 0) return { success: true, pairings: accumulated };

    const topPlayer = top[0];

    // Prefer natural Swiss opponent (1st vs last in bottom half)
    const tryOrder = [...bottom];
    if (tryOrder.length > 1) {
      const natural = tryOrder.pop();
      tryOrder.unshift(natural);
    }

    for (let i = 0; i < tryOrder.length; i++) {
      const bottomPlayer = tryOrder[i];
      if (hasPlayed(ctx, topPlayer.id, bottomPlayer.id)) continue;

      const colors = assignColors(topPlayer, bottomPlayer, ctx);
      const pairing = {
        white: colors.white,
        black: colors.black,
        result: null,
        board: boardOffset + accumulated.length + 1
      };

      const result = matchTopBottom(
        top.slice(1),
        tryOrder.filter((_, idx) => idx !== i),
        ctx,
        boardOffset,
        [...accumulated, pairing],
        shouldAbort
      );
      if (result.success) return result;
    }

    return { success: false, pairings: accumulated };
  }

  /** Greedy fallback — fast for large score groups */
  function pairGreedy(players, ctx, boardOffset) {
    const sorted = [...players].sort(compareForPairing);
    const pairings = [];
    const used = new Set();

    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      let matched = false;

      for (let j = sorted.length - 1; j > i; j--) {
        if (used.has(sorted[j].id)) continue;
        if (hasPlayed(ctx, sorted[i].id, sorted[j].id)) continue;

        const colors = assignColors(sorted[i], sorted[j], ctx);
        pairings.push({
          white: colors.white,
          black: colors.black,
          result: null,
          board: boardOffset + pairings.length + 1
        });
        used.add(sorted[i].id);
        used.add(sorted[j].id);
        matched = true;
        break;
      }

      if (!matched) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(sorted[j].id)) continue;
          if (hasPlayed(ctx, sorted[i].id, sorted[j].id)) continue;
          const colors = assignColors(sorted[i], sorted[j], ctx);
          pairings.push({
            white: colors.white,
            black: colors.black,
            result: null,
            board: boardOffset + pairings.length + 1
          });
          used.add(sorted[i].id);
          used.add(sorted[j].id);
          break;
        }
      }
    }

    return pairings;
  }

  /**
   * Build round pairings for a new round
   */
  function buildRoundPairings(state) {
    const active = Storage.getActivePlayers(state);
    if (active.length < 2) {
      throw new Error('Need at least 2 active players to generate pairings');
    }

    const ctx = buildContext(state);
    const enriched = active.map((p) => enrichPlayer(p, ctx)).sort(compareForPairing);
    const scoreGroups = groupByScore(enriched);
    const allPairings = [];
    let byePlayerId = null;
    const floatedDown = [];

    for (let g = 0; g < scoreGroups.length; g++) {
      let group = [...floatedDown, ...scoreGroups[g]];
      floatedDown.length = 0;

      if (group.length % 2 === 1) {
        byePlayerId = assignBye(group);
        group = group.filter((p) => p.id !== byePlayerId);
        allPairings.push({
          white: byePlayerId,
          black: null,
          result: 'bye',
          board: allPairings.length + 1,
          isBye: true
        });
      }

      const paired = pairGroup(group, ctx, allPairings.length);

      if (paired.remainder.length > 0 && g < scoreGroups.length - 1) {
        floatedDown.push(...paired.remainder);
      } else if (paired.remainder.length > 0) {
        const extra = pairGroup(paired.remainder, ctx, allPairings.length);
        allPairings.push(...extra.pairings);
      }
      allPairings.push(...paired.pairings);
    }

    allPairings.forEach((p, i) => {
      p.board = i + 1;
    });

    return { pairings: allPairings, byePlayerId };
  }

  // Legacy API compatibility
  function alreadyPlayed(idA, idB, state) {
    const ctx = buildContext(state);
    return hasPlayed(ctx, idA, idB);
  }

  function generatePairings(state) {
    return buildRoundPairings(state);
  }

  function assignByeForState(players, state) {
    const ctx = buildContext(state);
    return assignBye(players.map((p) => enrichPlayer(p, ctx)));
  }

  return {
    generatePairings,
    buildRoundPairings,
    alreadyPlayed,
    assignBye: assignByeForState,
    assignColors: (a, b, state) => assignColors(a, b, buildContext(state)),
    repairPairings: () => null
  };
})();
