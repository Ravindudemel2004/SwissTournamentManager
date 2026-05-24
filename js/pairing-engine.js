/**
 * Swiss-system pairing engine — FIDE Dutch System (C.04.3) implementation
 */
const PairingEngine = (function () {
  function pairKey(idA, idB) {
    return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  }

  function buildContext(state) {
    const meetingCount = new Set();
    
    // C1: No rematches
    for (const round of state.rounds) {
      for (const p of round.pairings || []) {
        if (!p.black || p.isBye) continue;
        meetingCount.add(pairKey(p.white, p.black));
      }
    }

    const active = Storage.getActivePlayers(state);
    const playerStats = new Map();

    for (const p of active) {
      const stats = Standings.getPlayerStats(p.id, state);
      
      // Determine color history to calculate preferences
      let whiteCount = 0;
      let blackCount = 0;
      let lastColor = null;
      let secondLastColor = null;
      let hasPlayed = false;

      for (const round of state.rounds) {
        for (const pairing of round.pairings || []) {
          if (pairing.isBye) continue;
          if (pairing.white === p.id) {
            whiteCount++;
            secondLastColor = lastColor;
            lastColor = 'white';
            hasPlayed = true;
          } else if (pairing.black === p.id) {
            blackCount++;
            secondLastColor = lastColor;
            lastColor = 'black';
            hasPlayed = true;
          }
        }
      }

      const colorDiff = whiteCount - blackCount;
      let preference = 0; // > 0 means prefers White, < 0 means prefers Black, 0 means no preference
      let prefType = 'none'; // 'absolute', 'strong', 'mild', 'none'
      
      if (!hasPlayed) {
         prefType = 'none';
      } else if (colorDiff > 1 || (lastColor === 'white' && secondLastColor === 'white')) {
         preference = -1;
         prefType = 'absolute'; // Prefers Black
      } else if (colorDiff < -1 || (lastColor === 'black' && secondLastColor === 'black')) {
         preference = 1;
         prefType = 'absolute'; // Prefers White
      } else if (colorDiff === 1) {
         preference = -1;
         prefType = 'strong';
      } else if (colorDiff === -1) {
         preference = 1;
         prefType = 'strong';
      } else {
         preference = lastColor === 'white' ? -1 : 1;
         prefType = 'mild';
      }

      playerStats.set(p.id, {
        points: stats.points,
        tpn: p.tpn || 0,
        colorDiff,
        lastColor,
        secondLastColor,
        preference,
        prefType,
        hasPlayed,
        byeCount: (p.byes || []).length
      });
    }

    return { state, meetingCount, playerStats };
  }

  function hasPlayed(ctx, idA, idB) {
    return ctx.meetingCount.has(pairKey(idA, idB));
  }

  function assignColors(ctx, idA, idB) {
    const pA = ctx.playerStats.get(idA);
    const pB = ctx.playerStats.get(idB);
    
    // 5.2.1 Grant both color preferences
    if (pA.preference > 0 && pB.preference < 0) return { white: idA, black: idB };
    if (pA.preference < 0 && pB.preference > 0) return { white: idB, black: idA };
    
    // 5.2.2 Grant stronger color preference
    const prefLevels = { 'absolute': 3, 'strong': 2, 'mild': 1, 'none': 0 };
    const levelA = prefLevels[pA.prefType];
    const levelB = prefLevels[pB.prefType];
    
    if (levelA > levelB) {
      if (pA.preference > 0) return { white: idA, black: idB };
      if (pA.preference < 0) return { white: idB, black: idA };
    }
    if (levelB > levelA) {
      if (pB.preference > 0) return { white: idB, black: idA };
      if (pB.preference < 0) return { white: idA, black: idB };
    }
    
    // Both absolute (topscorers) -> wider color difference
    if (levelA === 3 && levelB === 3) {
       if (Math.abs(pA.colorDiff) > Math.abs(pB.colorDiff)) {
          if (pA.preference > 0) return { white: idA, black: idB };
          if (pA.preference < 0) return { white: idB, black: idA };
       } else if (Math.abs(pB.colorDiff) > Math.abs(pA.colorDiff)) {
          if (pB.preference > 0) return { white: idB, black: idA };
          if (pB.preference < 0) return { white: idA, black: idB };
       }
    }
    
    // 5.2.4 Grant preference of higher ranked player (TPN)
    const higherRankedId = (pA.tpn < pB.tpn) ? idA : idB;
    const lowerRankedId = (pA.tpn < pB.tpn) ? idB : idA;
    const prefHigher = (pA.tpn < pB.tpn) ? pA.preference : pB.preference;
    
    if (prefHigher > 0) return { white: higherRankedId, black: lowerRankedId };
    if (prefHigher < 0) return { white: lowerRankedId, black: higherRankedId };
    
    // 5.2.5 If higher ranked player has odd TPN -> initial color, else opposite
    const initialColor = ctx.state.settings.initialColor || 'white';
    const higherRankedTPN = (pA.tpn < pB.tpn) ? pA.tpn : pB.tpn;
    
    if (higherRankedTPN % 2 !== 0) {
       return initialColor === 'white' ? { white: higherRankedId, black: lowerRankedId } : { white: lowerRankedId, black: higherRankedId };
    } else {
       return initialColor === 'white' ? { white: lowerRankedId, black: higherRankedId } : { white: higherRankedId, black: lowerRankedId };
    }
  }

  function canPair(ctx, idA, idB, isTopscorerGroup) {
     if (hasPlayed(ctx, idA, idB)) return false; // C1
     
     const pA = ctx.playerStats.get(idA);
     const pB = ctx.playerStats.get(idB);
     
     // C3: Non-topscorers with same absolute preference shall not meet
     if (!isTopscorerGroup) {
        if (pA.prefType === 'absolute' && pB.prefType === 'absolute' && pA.preference === pB.preference) {
           return false;
        }
     }
     
     return true;
  }

  function findPairing(players, ctx, isTopscorerGroup) {
    if (players.length === 0) return { pairings: [], floaters: [] };
    if (players.length === 1) return { pairings: [], floaters: players };
    
    let bestPairing = null;
    let minFloaters = players.length + 1;
    
    function search(index, currentPairings, currentFloaters, used) {
      if (currentFloaters.length >= minFloaters) return; // Pruning
      if (index === players.length) {
        if (currentFloaters.length < minFloaters) {
          minFloaters = currentFloaters.length;
          bestPairing = {
             pairings: [...currentPairings],
             floaters: [...currentFloaters]
          };
        }
        return;
      }
      
      if (used[index]) {
         search(index + 1, currentPairings, currentFloaters, used);
         return;
      }
      
      const p1 = players[index];
      used[index] = true;
      let paired = false;
      
      // Try to pair with remaining players
      for (let j = index + 1; j < players.length; j++) {
         if (!used[j] && canPair(ctx, p1.id, players[j].id, isTopscorerGroup)) {
            used[j] = true;
            const colors = assignColors(ctx, p1.id, players[j].id);
            currentPairings.push({
               white: colors.white,
               black: colors.black
            });
            paired = true;
            search(index + 1, currentPairings, currentFloaters, used);
            currentPairings.pop();
            used[j] = false;
            if (minFloaters === 0 || minFloaters === players.length % 2) break; // Found optimal
         }
      }
      
      // Try floating
      if (!paired || currentFloaters.length + 1 < minFloaters) {
         currentFloaters.push(p1);
         search(index + 1, currentPairings, currentFloaters, used);
         currentFloaters.pop();
      }
      
      used[index] = false;
    }
    
    // Sort players so that we try pairing S1 (top half) with S2 (bottom half)
    const sortedPlayers = [...players].sort((a, b) => {
        const tpnA = ctx.playerStats.get(a.id).tpn;
        const tpnB = ctx.playerStats.get(b.id).tpn;
        return tpnA - tpnB;
    });
    
    // Optimization for larger fields: start with the S1 vs S2 heuristic order
    const heuristicOrder = [];
    const half = Math.floor(sortedPlayers.length / 2);
    for (let i = 0; i < half; i++) {
        heuristicOrder.push(sortedPlayers[i]);
        if (i + half < sortedPlayers.length) {
            heuristicOrder.push(sortedPlayers[i + half]);
        }
    }
    if (sortedPlayers.length % 2 !== 0) {
        heuristicOrder.push(sortedPlayers[sortedPlayers.length - 1]);
    }
    
    search(0, [], [], new Array(heuristicOrder.length).fill(false));
    
    return bestPairing;
  }

  function assignBye(players, ctx) {
     if (!players.length) return null;
     
     const eligible = players.filter(p => {
        const stats = ctx.playerStats.get(p.id);
        return stats && stats.byeCount === 0;
     });
     
     if (eligible.length === 0) return null;
     
     eligible.sort((a, b) => {
        const statsA = ctx.playerStats.get(a.id);
        const statsB = ctx.playerStats.get(b.id);
        if (statsA.points !== statsB.points) return statsA.points - statsB.points;
        return statsB.tpn - statsA.tpn; 
     });
     
     return eligible[0].id;
  }

  function buildRoundPairings(state) {
    const active = Storage.getActivePlayers(state);
    if (active.length < 2) {
      throw new Error('Need at least 2 active players to generate pairings');
    }

    if (!state.settings.initialColor) {
       state.settings.initialColor = Math.random() < 0.5 ? 'white' : 'black';
    }

    Storage.assignTPNs(state); 

    const ctx = buildContext(state);
    
    const maxPossiblePoints = state.settings.scoreWin * (state.settings.totalRounds - 1);
    const topscorerThreshold = maxPossiblePoints / 2;
    const isFinalRound = state.currentRound + 1 === state.settings.totalRounds;

    const playersByScore = new Map();
    active.forEach(p => {
       const stats = ctx.playerStats.get(p.id);
       const score = stats.points;
       if (!playersByScore.has(score)) playersByScore.set(score, []);
       playersByScore.get(score).push(p);
    });

    const scores = Array.from(playersByScore.keys()).sort((a, b) => b - a);
    const allPairings = [];
    let byePlayerId = null;
    let floaters = [];
    
    if (active.length % 2 !== 0) {
       byePlayerId = assignBye(active, ctx);
       if (byePlayerId) {
          allPairings.push({
             white: byePlayerId,
             black: null,
             result: 'bye',
             isBye: true
          });
       }
    }

    for (let i = 0; i < scores.length; i++) {
       const score = scores[i];
       const isTopscorerGroup = isFinalRound && score > topscorerThreshold;
       
       let groupPlayers = [...floaters, ...playersByScore.get(score)];
       groupPlayers = groupPlayers.filter(p => p.id !== byePlayerId);
       
       floaters = []; 

       if (groupPlayers.length === 0) continue;

       const result = findPairing(groupPlayers, ctx, isTopscorerGroup);
       
       if (result && result.pairings.length > 0) {
          // Reconstruct original IDs from heuristicOrder used in findPairing
          const groupMap = new Map(groupPlayers.map(p => [p.id, p]));
          const mappedFloaters = result.floaters.map(fp => groupMap.get(fp.id) || fp);
          
          allPairings.push(...result.pairings);
          floaters = mappedFloaters;
       } else {
          floaters = groupPlayers; 
       }
    }
    
    if (floaters.length >= 2) {
       for (let i = 0; i < floaters.length; i+=2) {
          if (i + 1 < floaters.length) {
             const colors = assignColors(ctx, floaters[i].id, floaters[i+1].id);
             allPairings.push({
                white: colors.white,
                black: colors.black
             });
          }
       }
    }

    allPairings.forEach((p, i) => {
       p.board = i + 1;
    });

    return { pairings: allPairings, byePlayerId };
  }

  return {
    generatePairings: buildRoundPairings,
    buildRoundPairings,
    alreadyPlayed: (idA, idB, state) => hasPlayed(buildContext(state), idA, idB),
    assignBye: (players, state) => assignBye(players, buildContext(state)),
    assignColors: (a, b, state) => assignColors(buildContext(state), a.id, b.id),
    buildContext
  };
})();
