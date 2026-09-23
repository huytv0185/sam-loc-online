const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const E = require('./samloc-engine.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (I,O,0,1)
function genRoomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const rooms = new Map(); // code -> room

function newRoom(code, hostSocketId) {
  return {
    code,
    hostSocketId,
    players: [], // { socketId, name, seat, connected, ledger }
    betTier: 10000,
    phase: 'lobby', // lobby | baosam | playing | roundend
    hands: [], // server-only, indexed by seat (chỉ dùng ngay sau khi chia, trước khi round bắt đầu)
    round: null, // SamLocRound instance khi phase === 'playing'
    baoSamInfo: null,
    lastResult: null,
    roundNumber: 0,
    lastWinnerSeat: null, // seat thắng ván trước -> người đi đầu ván sau (null = ván đầu, chọn ngẫu nhiên)
  };
}

function publicPlayers(room) {
  return room.players.map(p => ({
    name: p.name,
    seat: p.seat,
    connected: p.connected,
    ledger: p.ledger,
    isHost: p.socketId === room.hostSocketId,
  }));
}

function broadcastRoom(room) {
  io.to(room.code).emit('room_update', {
    roomCode: room.code,
    players: publicPlayers(room),
    betTier: room.betTier,
    phase: room.phase,
    roundNumber: room.roundNumber,
  });
}

function cardsToWire(cards) {
  return cards.map(c => ({ code: c.code, rank: c.rank, suit: c.suit }));
}

function sendHands(room) {
  // Trong lúc ván đang chạy, bài thật (đã trừ những lá đã đánh) nằm ở room.round.hands,
  // không phải room.hands (chỉ là bài lúc mới chia, không tự cập nhật).
  const src = room.round ? room.round.hands : room.hands;
  room.players.forEach(p => {
    const hand = (src && src[p.seat]) || [];
    io.to(p.socketId).emit('your_hand', { cards: cardsToWire(hand) });
  });
}

function tableWire(room) {
  if (!room.round || !room.round.table) return null;
  const t = room.round.table;
  return { type: t.type, len: t.len, rank: t.rank, cards: cardsToWire(t.cards), owner: room.round.tableOwner };
}

function broadcastGameState(room) {
  if (!room.round) return;
  const r = room.round;
  io.to(room.code).emit('game_state', {
    turnSeat: r.turn,
    table: tableWire(room),
    cardCounts: room.players.map(p => (r.hands[p.seat] || []).length).reduce((acc, n, i) => { acc[i] = n; return acc; }, {}),
    over: r.over,
  });
}

function seatOf(room, socketId) {
  const p = room.players.find(pl => pl.socketId === socketId);
  return p ? p.seat : -1;
}

function startRound(room) {
  const n = room.players.length;
  const deck = E.shuffle(E.createDeck());
  const hands = E.deal(deck, n, 10);
  room.hands = hands;
  room.roundNumber += 1;
  room.baoSamInfo = null;
  room.lastResult = null;

  const leaderSeat = E.pickLeaderSeat(n, room.lastWinnerSeat);

  const sam = E.resolveBaoSam(hands, leaderSeat);
  if (sam) {
    room.phase = 'baosam';
    const settle = E.settleBaoSam(n, sam, room.betTier);
    settle.payments.forEach(p => {
      room.players[p.seat].ledger -= p.amount;
    });
    room.players[settle.winnerSeat].ledger += settle.total;
    room.baoSamInfo = {
      declarer: sam.declarer,
      isDragon: sam.isDragon,
      blockedBy: sam.blockedBy,
      winnerSeat: settle.winnerSeat,
      payments: settle.payments,
      total: settle.total,
    };
    room.round = null;
    room.lastWinnerSeat = settle.winnerSeat; // người chặn (nếu có) hoặc người báo sâm thành công đi đầu ván sau
    sendHands(room); // để mọi người thấy bài của mình (và có thể so sánh)
    broadcastRoom(room);
    io.to(room.code).emit('bao_sam_result', room.baoSamInfo);
    return;
  }

  room.round = new E.SamLocRound(n, hands, leaderSeat);
  room.phase = 'playing';
  sendHands(room);
  broadcastRoom(room);
  broadcastGameState(room);
}

function finishRoundIfOver(room) {
  const r = room.round;
  if (!r || !r.over) return;
  const counts = room.players.map(p => r.hands[p.seat].length);
  const amounts = E.settleNormalRound(counts, room.betTier);
  amounts.forEach((amt, seat) => { room.players[seat].ledger -= amt; });
  const total = amounts.reduce((a, b) => a + b, 0);
  room.players[r.winnerSeat].ledger += total;

  room.lastResult = {
    winnerSeat: r.winnerSeat,
    counts,
    amounts,
    total,
  };
  room.phase = 'roundend';
  room.hands = r.hands;
  room.lastWinnerSeat = r.winnerSeat;
  sendHands(room);
  broadcastRoom(room);
  io.to(room.code).emit('round_result', room.lastResult);
}

io.on('connection', socket => {
  socket.on('create_room', ({ name }, cb) => {
    const code = genRoomCode();
    const room = newRoom(code, socket.id);
    room.players.push({ socketId: socket.id, name: (name || 'Chủ phòng').slice(0, 20), seat: 0, connected: true, ledger: 0 });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    cb && cb({ ok: true, roomCode: code, seat: 0 });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ roomCode, name, fromLink }, cb) => {
    const code = (roomCode || '').toUpperCase().trim();
    const cleanName = (name || '').trim();
    let room = rooms.get(code);

    // Phòng chỉ nằm trong bộ nhớ server. Gói free của Render cho server "ngủ" khi không ai dùng
    // và khởi động lại là mất sạch phòng -> bạn bè bấm link cũ sẽ không vào được, mỗi người lại
    // đi tạo một phòng riêng nên không nhìn thấy nhau. Vì vậy: nếu vào bằng LINK mà phòng không
    // còn, dựng lại đúng phòng mã đó luôn -> cả nhóm cùng link vẫn gặp nhau trong một phòng.
    if (!room && fromLink && /^[A-Z0-9]{4,6}$/.test(code)) {
      room = newRoom(code, socket.id);
      rooms.set(code, room);
    }
    if (!room) return cb && cb({ ok: false, error: 'Không tìm thấy phòng — kiểm tra lại mã phòng nhé.' });

    const existingDisconnected = room.players.find(p => p.name === cleanName && !p.connected);
    if (existingDisconnected) {
      // nếu người vào lại đúng là chủ phòng (khớp socketId cũ), phải chuyển quyền chủ phòng sang
      // socket mới — không thì họ vào lại phòng nhưng mất hết quyền bấm bắt đầu ván/đổi mức cược.
      if (room.hostSocketId === existingDisconnected.socketId) room.hostSocketId = socket.id;
      existingDisconnected.socketId = socket.id;
      existingDisconnected.connected = true;
      socket.join(code);
      socket.data.roomCode = code;
      cb && cb({ ok: true, roomCode: code, seat: existingDisconnected.seat });
      broadcastRoom(room);
      if (room.phase === 'playing' || room.phase === 'baosam' || room.phase === 'roundend') {
        const src = room.round ? room.round.hands : room.hands;
        io.to(socket.id).emit('your_hand', { cards: cardsToWire((src && src[existingDisconnected.seat]) || []) });
        if (room.round) broadcastGameState(room);
      }
      if (room.phase === 'baosam' && room.baoSamInfo) io.to(socket.id).emit('bao_sam_result', room.baoSamInfo);
      if (room.phase === 'roundend' && room.lastResult) io.to(socket.id).emit('round_result', room.lastResult);
      return;
    }

    if (room.players.some(p => p.name === cleanName && p.connected)) {
      return cb && cb({ ok: false, error: 'Tên này đang được dùng trong phòng, chọn tên khác nhé.' });
    }
    if (room.phase !== 'lobby') {
      return cb && cb({ ok: false, error: 'Ván đang diễn ra, đợi ván sau nhé.' });
    }
    if (room.players.length >= 5) return cb && cb({ ok: false, error: 'Phòng đã đủ 5 người.' });

    const seat = room.players.length;
    room.players.push({ socketId: socket.id, name: (cleanName || `Người chơi ${seat + 1}`).slice(0, 20), seat, connected: true, ledger: 0 });
    socket.join(code);
    socket.data.roomCode = code;
    cb && cb({ ok: true, roomCode: code, seat });
    broadcastRoom(room);
  });

  socket.on('set_bet_tier', ({ tier }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    const t = Number(tier);
    if (!Number.isFinite(t) || t <= 0) return;
    room.betTier = Math.round(t);
    broadcastRoom(room);
  });

  socket.on('start_round', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return io.to(socket.id).emit('error_msg', { message: 'Mất kết nối phòng — tải lại trang và vào lại nhé.' });
    if (socket.id !== room.hostSocketId) return;
    if (room.players.length < 2 || room.players.length > 5) {
      return io.to(socket.id).emit('error_msg', { message: 'Cần 2-5 người chơi để bắt đầu.' });
    }
    if (room.phase !== 'lobby' && room.phase !== 'roundend' && room.phase !== 'baosam') return;
    startRound(room);
  });

  socket.on('play_cards', ({ cardCodes }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return io.to(socket.id).emit('error_msg', { message: 'Mất kết nối phòng — tải lại trang và vào lại nhé.' });
    if (room.phase !== 'playing' || !room.round) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return io.to(socket.id).emit('error_msg', { message: 'Không xác định được chỗ ngồi của bạn — tải lại trang và vào lại nhé.' });
    const res = room.round.play(seat, cardCodes || []);
    if (!res.ok) return io.to(socket.id).emit('error_msg', { message: errMsg(res.error) });
    sendHands(room);
    if (res.chop) {
      const amount = E.chopAmount(res.chop.kind, room.betTier);
      if (amount > 0 && res.chop.from !== null && res.chop.from !== undefined) {
        room.players[res.chop.from].ledger -= amount;
        room.players[res.chop.to].ledger += amount;
        io.to(room.code).emit('chop_event', {
          kind: res.chop.kind,
          from: res.chop.from,
          to: res.chop.to,
          amount,
        });
        broadcastRoom(room);
      }
    }
    if (res.roundOver) {
      finishRoundIfOver(room);
    } else {
      broadcastGameState(room);
    }
  });

  socket.on('pass_turn', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return io.to(socket.id).emit('error_msg', { message: 'Mất kết nối phòng — tải lại trang và vào lại nhé.' });
    if (room.phase !== 'playing' || !room.round) return;
    const seat = seatOf(room, socket.id);
    if (seat === -1) return io.to(socket.id).emit('error_msg', { message: 'Không xác định được chỗ ngồi của bạn — tải lại trang và vào lại nhé.' });
    const res = room.round.pass(seat);
    if (!res.ok) return io.to(socket.id).emit('error_msg', { message: errMsg(res.error) });
    broadcastGameState(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(pl => pl.socketId === socket.id);
    if (p) {
      p.connected = false;
      broadcastRoom(room);
      if (room.players.length && room.players.every(pl => !pl.connected)) {
        setTimeout(() => {
          if (room.players.every(pl => !pl.connected)) rooms.delete(room.code);
        }, 10 * 60 * 1000);
      }
    }
  });
});

function errMsg(code) {
  const map = {
    not_your_turn: 'Chưa đến lượt bạn.',
    invalid_combo: 'Bộ bài không hợp lệ.',
    does_not_beat_table: 'Bộ bài không lớn hơn/chặt được bộ đang ra.',
    doublequad_only_vs_pair2: 'Hai tứ quý chỉ được đánh để chặt đôi lá 2 trên bàn.',
    cannot_finish_on_two: 'Không được đánh lá/bộ hạng 2 làm nước cuối để về (theo luật).',
    cannot_pass_when_leading: 'Bạn đang được đi trước, phải đánh bài chứ không được bỏ lượt.',
    card_not_in_hand: 'Lá bài không có trong tay bạn.',
    round_over: 'Ván đã kết thúc.',
  };
  return map[code] || 'Không thực hiện được.';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sâm Lốc server chạy ở cổng ${PORT}`));
