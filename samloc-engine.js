// ===== Sâm miền Bắc — engine theo "LUẬT CHƠI SÂM MIỀN BẮC v3" (file luật của user) =====
// Pure logic, không đụng DOM/network — test bằng node thuần.

const RANK_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2']; // B2: 3=1..2=13 (ở đây 0-based)
const TWO = RANK_ORDER.indexOf('2'); // 12
// B2: dãy vị trí sảnh A=1,2=2,...,K=13,A=14 (ở đây 0-based: A=0,2=1,...,K=12,A=13)
const STRAIGHT_LINE = ['A','2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function rankIdx(r) { return RANK_ORDER.indexOf(r); }

function createDeck() {
  const deck = [];
  const suits = ['S', 'C', 'D', 'H'];
  for (const s of suits) {
    for (const r of RANK_ORDER) {
      deck.push({ rank: r, suit: s, ri: rankIdx(r), code: r + s });
    }
  }
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 1. Chuẩn bị: N người (2-5), mỗi người 10 lá, lá dư úp bỏ.
function deal(shuffledDeck, numPlayers, perPlayer = 10) {
  const hands = Array.from({ length: numPlayers }, () => []);
  for (let i = 0; i < numPlayers * perPlayer; i++) hands[i % numPlayers].push(shuffledDeck[i]);
  hands.forEach(h => h.sort(cardCompare));
  return hands;
}

function cardCompare(a, b) { return a.ri - b.ri || a.suit.localeCompare(b.suit); }

// người đi đầu ván: ván đầu ngẫu nhiên, ván sau = người thắng ván trước (server truyền vào lastWinnerSeat)
function pickLeaderSeat(numPlayers, lastWinnerSeat, rng = Math.random) {
  if (lastWinnerSeat !== null && lastWinnerSeat !== undefined && lastWinnerSeat >= 0 && lastWinnerSeat < numPlayers) {
    return lastWinnerSeat;
  }
  return Math.floor(rng() * numPlayers);
}

// ---- các cửa sổ sảnh hợp lệ (3-9 lá cho đánh thường; 10 lá riêng cho sảnh rồng) ----
const STRAIGHT_WINDOWS = {};
for (let L = 3; L <= 10; L++) {
  const wins = [];
  for (let s = 0; s <= STRAIGHT_LINE.length - L; s++) {
    wins.push({ len: L, s, ranks: STRAIGHT_LINE.slice(s, s + L) });
  }
  STRAIGHT_WINDOWS[L] = wins;
}

function findStraightWindow(ranksArr) {
  const n = ranksArr.length;
  const set = new Set(ranksArr);
  if (set.size !== n) return null;
  return (STRAIGHT_WINDOWS[n] || []).find(w => {
    const wset = new Set(w.ranks);
    return wset.size === w.ranks.length && ranksArr.every(r => wset.has(r));
  }) || null;
}

// ---- phân loại 1 nước đánh (bộ bài người chơi chọn) ----
// trả về { type, len, rank, cards } | null. type: single|pair|triple|quad|straight|doublequad
// sảnh thường giới hạn 3-9 lá (sảnh rồng 10 lá chỉ tồn tại ở pha báo sâm, không đánh giữa ván).
function classifyCombo(cards) {
  if (!cards || cards.length === 0) return null;
  const cs = cards.slice().sort(cardCompare);
  const n = cs.length;

  if (n === 1) return { type: 'single', len: 1, rank: cs[0].ri, cards: cs };

  const sameRank = cs.every(c => c.ri === cs[0].ri);
  if (sameRank) {
    if (n === 2) return { type: 'pair', len: 2, rank: cs[0].ri, cards: cs };
    if (n === 3) return { type: 'triple', len: 3, rank: cs[0].ri, cards: cs };
    if (n === 4) return { type: 'quad', len: 4, rank: cs[0].ri, cards: cs };
    return null;
  }

  if (n >= 3 && n <= 9) {
    const win = findStraightWindow(cs.map(c => c.rank));
    if (win) return { type: 'straight', len: n, rank: win.s, cards: cs };
  }

  // "hai tứ quý" (B6, đề xuất): 8 lá = đúng 2 hạng khác nhau, mỗi hạng đủ 4 lá.
  if (n === 8) {
    const byRank = {};
    cs.forEach(c => { (byRank[c.rank] = byRank[c.rank] || []).push(c); });
    const ranks = Object.keys(byRank);
    if (ranks.length === 2 && ranks.every(r => byRank[r].length === 4)) {
      const topRank = Math.max(...ranks.map(r => rankIdx(r)));
      return { type: 'doublequad', len: 8, rank: topRank, cards: cs };
    }
  }

  return null;
}

// nước đi có phải "nhóm 2" (toàn bộ là lá hạng 2 — đơn/đôi/ba/tứ quý 2) không?
function isTwoGroup(combo) {
  return combo.rank === TWO && ['single', 'pair', 'triple', 'quad'].includes(combo.type);
}

// atk có đè hợp lệ lên def (bộ đang trên bàn) không? def=null nghĩa là đang đi đầu (đánh gì cũng được).
// trả về { ok, chop } — chop mô tả sự kiện "chặt" cần tính tiền ngay nếu có (xem section 5/7 & B4).
function beats(atk, def) {
  if (!def) return { ok: true, chop: null };

  // đè bình thường: cùng loại, cùng số lá, hạng cao hơn.
  // (ba 2 / tứ quý 2 không lá nào đè được vì 2 đã là hạng cao nhất — tự thoả mãn, không cần case riêng)
  if (atk.type === def.type && atk.len === def.len) {
    if (atk.rank > def.rank) {
      const chop = (atk.type === 'quad') ? { kind: 'quad_vs_quad' } : null; // 40B: tứ quý bị tứ quý lớn hơn chặn
      return { ok: true, chop };
    }
    return { ok: false, chop: null };
  }

  // chặt 2 lẻ: chỉ tứ quý mới chặt được.
  if (def.type === 'single' && def.rank === TWO && atk.type === 'quad') {
    return { ok: true, chop: { kind: 'quad_vs_two' } }; // 20B
  }
  // chặt đôi 2: chỉ "hai tứ quý" (8 lá) mới chặt được (B6, đề xuất).
  if (def.type === 'pair' && def.rank === TWO && atk.type === 'doublequad') {
    return { ok: true, chop: { kind: 'doublequad_vs_pair2' } }; // 20B (đề xuất)
  }

  return { ok: false, chop: null };
}

// nước đi có bị cấm làm lá cuối để "về" không? (mục 5: không đánh cuối bằng 2 lẻ/đôi 2/ba 2/tứ quý 2;
// sảnh có 2, ví dụ 2-3-4-5, vẫn được đánh cuối bình thường)
function isBarredFinish(combo) {
  return isTwoGroup(combo);
}

// tay bài chỉ toàn lá hạng 2 (1-4 lá) — nếu đang phải đi đầu mà rơi vào tình huống này thì bị "kẹt"
// (không được đánh vì luật cấm về bằng 2), phải nhường quyền đi đầu.
function isStuckAllTwos(hand) {
  return hand.length >= 1 && hand.length <= 4 && hand.every(c => c.rank === '2');
}

function isDragonHand(cards) {
  if (cards.length !== 10) return false;
  const win = findStraightWindow(cards.map(c => c.rank));
  return !!(win && win.len === 10);
}

// ---- báo sâm: 1 tay 10 lá có xếp hết thành bộ hợp lệ (đôi/ba/tứ quý/sảnh 3-9) không? ----
// (dùng cho check "đủ điều kiện báo sâm"; sảnh rồng được kiểm riêng bằng isDragonHand trước)
function findFullMeld(cards) {
  const byRank = {};
  RANK_ORDER.forEach(r => (byRank[r] = []));
  cards.forEach(c => byRank[c.rank].push(c));
  const counts = {};
  RANK_ORDER.forEach(r => (counts[r] = byRank[r].length));

  function totalLeft(cnt) { return Object.values(cnt).reduce((a, b) => a + b, 0); }

  function solve(cnt) {
    const total = totalLeft(cnt);
    if (total === 0) return [];
    const r = RANK_ORDER.find(rr => cnt[rr] > 0);

    for (const take of [4, 3, 2]) {
      if (cnt[r] >= take) {
        const next = { ...cnt, [r]: cnt[r] - take };
        const rest = solve(next);
        if (rest !== null) return [{ type: take === 2 ? 'pair' : take === 3 ? 'triple' : 'quad', ranks: [r] }, ...rest];
      }
    }

    for (let L = Math.min(9, total); L >= 3; L--) {
      for (const win of STRAIGHT_WINDOWS[L]) {
        if (!win.ranks.includes(r)) continue;
        if (win.ranks.every(rr => cnt[rr] > 0)) {
          const next = { ...cnt };
          win.ranks.forEach(rr => { next[rr] -= 1; });
          const rest = solve(next);
          if (rest !== null) return [{ type: 'straight', ranks: win.ranks.slice(), s: win.s }, ...rest];
        }
      }
    }
    return null;
  }

  const groups = solve(counts);
  if (!groups) return null;

  const used = {};
  RANK_ORDER.forEach(r => (used[r] = 0));
  const result = groups.map(g => {
    const cs = g.ranks.map(r => { const c = byRank[r][used[r]]; used[r] += 1; return c; });
    const type = g.type;
    const rank = type === 'straight' ? g.s : rankIdx(g.ranks[0]);
    return { type, cards: cs, rank, len: cs.length };
  });
  return result;
}

function canBaoSam(cards) { return findFullMeld(cards) !== null; }

// sắp thứ tự các nhóm người báo sâm sẽ đánh ra: nếu có đúng 1 lá 2 lẻ (nhóm single rank 2) -> đánh trước
// tiên; có từ 2 lá 2 trở lên (đã gộp thành đôi/ba/tứ quý) thì không bị ép, giữ nguyên thứ tự tìm được.
function orderSamGroups(groups) {
  const idx = groups.findIndex(g => g.type === 'single' && g.rank === TWO);
  if (idx <= 0) return groups;
  const g = groups[idx];
  const rest = groups.slice(0, idx).concat(groups.slice(idx + 1));
  return [g, ...rest];
}

// đối thủ (không phải seat `declarer`) có bộ nào đè được nhóm `group` không?
// trả về seat đối thủ đầu tiên (thứ tự chiều kim đồng hồ từ declarer) đè được, hoặc -1.
function findBlocker(hands, declarer, group) {
  const n = hands.length;
  for (let step = 1; step < n; step++) {
    const seat = (declarer + step) % n;
    if (canOpponentBeat(hands[seat], group)) return seat;
  }
  return -1;
}

function canOpponentBeat(hand, group) {
  const byRank = {};
  hand.forEach(c => { byRank[c.rank] = (byRank[c.rank] || 0) + 1; });

  if (group.type === 'single' && group.rank === TWO) {
    // chỉ tứ quý mới chặt được 2 lẻ (bất kỳ hạng nào)
    return Object.values(byRank).some(cnt => cnt >= 4);
  }
  if (group.type === 'single') {
    return hand.some(c => c.ri > group.rank);
  }
  if (group.type === 'pair' && group.rank === TWO) {
    // chỉ "hai tứ quý" (2 hạng khác nhau, mỗi hạng đủ 4 lá) mới chặt được đôi 2
    const quadRanks = Object.keys(byRank).filter(r => byRank[r] >= 4);
    return quadRanks.length >= 2;
  }
  if (group.type === 'pair') {
    return Object.keys(byRank).some(r => byRank[r] >= 2 && rankIdx(r) > group.rank);
  }
  if (group.type === 'triple') {
    // ba 2 không lá nào đè được (đã tự thoả mãn vì rank cao nhất); ba thường bị ba lớn hơn đè
    return Object.keys(byRank).some(r => byRank[r] >= 3 && rankIdx(r) > group.rank);
  }
  if (group.type === 'quad') {
    // tứ quý 2 không lá nào đè được; tứ quý thường bị tứ quý lớn hơn đè
    return Object.keys(byRank).some(r => byRank[r] >= 4 && rankIdx(r) > group.rank);
  }
  if (group.type === 'straight') {
    // cần 1 sảnh cùng độ dài, vị trí (rank = s) lớn hơn
    const ranksInHand = new Set(hand.map(c => c.rank));
    const L = group.len;
    return (STRAIGHT_WINDOWS[L] || []).some(w => w.s > group.rank && w.ranks.every(r => ranksInHand.has(r)));
  }
  return false;
}

// ---- Pha báo sâm (mục 6 + B4) ----
// hands: mảng bài từng seat (chưa bị đụng); leaderSeat: người đi đầu ván này.
// Trả về null nếu không ai báo sâm, hoặc:
// { declarer, isDragon, blockedBy: seat|-1, blockedAtGroup, winnerSeat }
function resolveBaoSam(hands, leaderSeat) {
  const n = hands.length;

  // sảnh rồng được ưu tiên báo trước, theo chiều kim đồng hồ từ người đi đầu, luôn thắng không bị chặn
  for (let step = 0; step < n; step++) {
    const seat = (leaderSeat + step) % n;
    if (isDragonHand(hands[seat])) {
      return { declarer: seat, isDragon: true, blockedBy: -1, winnerSeat: seat };
    }
  }

  // không ai có sảnh rồng: hỏi lần lượt theo chiều kim đồng hồ từ người đi đầu, ai đủ điều kiện trước thì báo
  let declarer = -1;
  for (let step = 0; step < n; step++) {
    const seat = (leaderSeat + step) % n;
    if (canBaoSam(hands[seat])) { declarer = seat; break; }
  }
  if (declarer === -1) return null;

  const groups = orderSamGroups(findFullMeld(hands[declarer]));
  for (const g of groups) {
    const blocker = findBlocker(hands, declarer, g);
    if (blocker !== -1) {
      return { declarer, isDragon: false, blockedBy: blocker, blockedGroup: g, winnerSeat: blocker };
    }
  }
  return { declarer, isDragon: false, blockedBy: -1, winnerSeat: declarer };
}

// ---- tiền báo sâm (mục 7 + bảng hệ số) ----
function settleBaoSam(numPlayers, sam, tier) {
  if (sam.blockedBy === -1) {
    const mult = sam.isDragon ? 40 : 20;
    const per = tier * mult;
    const payments = [];
    for (let i = 0; i < numPlayers; i++) if (i !== sam.declarer) payments.push({ seat: i, amount: per });
    return { payments, total: per * (numPlayers - 1), winnerSeat: sam.declarer };
  }
  // bị chặn: người báo sâm đền trọn gói 20×B×N cho người chặn, không ai khác trả gì.
  const amount = 20 * tier * numPlayers;
  return { payments: [{ seat: sam.declarer, amount }], total: amount, winnerSeat: sam.blockedBy };
}

// ---- tiền ván thường (mục 8 ví dụ) ----
function settleNormalRound(remainingCounts, tier) {
  return remainingCounts.map(k => {
    if (k === 0) return 0;
    if (k === 10) return tier * 15; // móm
    return tier * k;
  });
}

// tiền chặt tức thời trong ván thường (mục 5/7 + bảng hệ số): trả về số tiền theo `kind`.
function chopAmount(kind, tier) {
  if (kind === 'quad_vs_two') return 20 * tier;
  if (kind === 'quad_vs_quad') return 40 * tier;
  if (kind === 'doublequad_vs_pair2') return 20 * tier; // B6: đề xuất, chưa chốt
  return 0;
}

// ---- round/turn engine (giai đoạn đánh bài bình thường, sau khi không ai báo sâm) ----
class SamLocRound {
  constructor(numPlayers, hands, leaderSeat) {
    this.n = numPlayers;
    this.hands = hands.map(h => h.slice());
    this.passed = new Array(numPlayers).fill(false);
    this.finished = new Array(numPlayers).fill(false);
    this.table = null;
    this.tableOwner = null;
    this.turn = leaderSeat;
    this.winnerSeat = null;
    this.over = false;
    this.log = [];
  }

  activePlayers() {
    const out = [];
    for (let i = 0; i < this.n; i++) if (!this.finished[i]) out.push(i);
    return out;
  }

  nextActive(from) {
    let i = from;
    for (let k = 0; k < this.n; k++) {
      i = (i + 1) % this.n;
      if (!this.finished[i]) return i;
    }
    return from;
  }

  // trả { ok, error? } khi thất bại, hoặc { ok:true, roundOver?, winner?, chop? } khi thành công.
  // `chop` (nếu có) mô tả sự kiện chặt cần tính tiền ngay: { kind, from, to }.
  play(playerIndex, cardCodes) {
    if (this.over) return { ok: false, error: 'round_over' };
    if (playerIndex !== this.turn) return { ok: false, error: 'not_your_turn' };

    const hand = this.hands[playerIndex];
    const chosen = [];
    const handCopy = hand.slice();
    for (const code of cardCodes) {
      const idx = handCopy.findIndex(c => c.code === code);
      if (idx === -1) return { ok: false, error: 'card_not_in_hand' };
      chosen.push(handCopy[idx]);
      handCopy.splice(idx, 1);
    }

    const combo = classifyCombo(chosen);
    if (!combo) return { ok: false, error: 'invalid_combo' };
    if (combo.type === 'doublequad' && !(this.table && this.table.type === 'pair' && this.table.rank === TWO)) {
      return { ok: false, error: 'doublequad_only_vs_pair2' };
    }

    const isLeading = this.table === null;
    let chop = null;
    if (!isLeading) {
      const res = beats(combo, this.table);
      if (!res.ok) return { ok: false, error: 'does_not_beat_table' };
      chop = res.chop;
    }

    if (handCopy.length === 0 && isBarredFinish(combo)) {
      return { ok: false, error: 'cannot_finish_on_two' };
    }

    const prevOwner = this.tableOwner;
    this.hands[playerIndex] = handCopy;
    this.table = combo;
    this.tableOwner = playerIndex;
    this.passed = this.passed.map(() => false);
    this.log.push({ type: 'play', player: playerIndex, cards: cardCodes, combo: combo.type });

    const chopEvent = chop ? { kind: chop.kind, from: prevOwner, to: playerIndex } : null;

    if (handCopy.length === 0) {
      this.finished[playerIndex] = true;
      this.winnerSeat = playerIndex;
      this.over = true;
      return { ok: true, roundOver: true, winner: playerIndex, chop: chopEvent };
    }

    this.turn = this.nextActive(playerIndex);
    return { ok: true, chop: chopEvent };
  }

  pass(playerIndex) {
    if (this.over) return { ok: false, error: 'round_over' };
    if (playerIndex !== this.turn) return { ok: false, error: 'not_your_turn' };

    if (this.table === null) {
      // ngoại lệ: cả tay chỉ còn lá hạng 2 (1-4 lá) -> luật cấm về bằng 2 nên bắt buộc phải
      // được nhường quyền đi đầu, tránh bế tắc.
      if (!isStuckAllTwos(this.hands[playerIndex])) return { ok: false, error: 'cannot_pass_when_leading' };
      this.log.push({ type: 'forced_pass_stuck_twos', player: playerIndex });
      this.turn = this.nextActive(playerIndex);
      return { ok: true, stuckWithTwos: true };
    }

    this.passed[playerIndex] = true;
    this.log.push({ type: 'pass', player: playerIndex });

    const stillIn = this.activePlayers().filter(p => p !== this.tableOwner);
    const allPassed = stillIn.every(p => this.passed[p]);

    if (allPassed) {
      const newLeader = this.tableOwner;
      this.table = null;
      this.tableOwner = null;
      this.passed = this.passed.map(() => false);
      this.turn = newLeader;
      return { ok: true, trickWon: newLeader };
    }

    this.turn = this.nextActive(playerIndex);
    return { ok: true };
  }
}

module.exports = {
  RANK_ORDER, STRAIGHT_LINE, STRAIGHT_WINDOWS, TWO,
  createDeck, shuffle, deal, cardCompare, pickLeaderSeat,
  classifyCombo, beats, isTwoGroup, isBarredFinish, isStuckAllTwos,
  findFullMeld, canBaoSam, isDragonHand, resolveBaoSam, settleBaoSam,
  settleNormalRound, chopAmount,
  SamLocRound,
};
