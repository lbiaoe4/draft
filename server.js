const express = require("express");
const path = require("path");
let nanoid;
try {
  const n = require("nanoid");
  nanoid = n && n.nanoid ? n.nanoid : n;
} catch (e) {
  // fallback simple id generator (not cryptographically secure, but OK for dev)
  nanoid = (len = 6) => Math.random().toString(36).substr(2, len).toUpperCase();
}
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();


// ===== Discord Webhook (notificação + imagem do resumo) =====
// Configure no Render: DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/...."
// IMPORTANTE: não commite essa URL no GitHub.
async function sendDiscordSummaryImage({ roomId, bufferPng, series = null }) {
  const url = "https://discord.com/api/webhooks/1461155771516457118/wEhlvfPnD4QPhmhjHORpINF3HRc9GulPdbcYn4VVDUFb_8VJ6PjDNicN_F5HeaHGvmhG";
  if (!url) return; // sem webhook configurado, não faz nada

  // Node 18+ (Render) normalmente já tem fetch/FormData/Blob globais.
  // Se seu serviço estiver em Node < 18, defina a versão do Node no Render para 18+.
  if (typeof fetch !== "function" || typeof FormData === "undefined" || typeof Blob === "undefined") {
    console.warn("Discord webhook: ambiente sem fetch/FormData/Blob. Use Node 18+ no Render.");
    return;
  }

  const form = new FormData();

  const payload = {
    username: "LBI Draft Bot",
    content: `✅ Draft concluído — Sala/ID: ${roomId}`,
    embeds: [
      {
        title: "Draft concluído",
        description: `Sala/ID: **${roomId}**`,
        color: 0x22c55e,
        fields: series ? [{ name: "Série", value: String(series), inline: true }] : [],
        image: { url: "attachment://draft.png" },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  form.append("payload_json", JSON.stringify(payload));
  form.append("file", new Blob([bufferPng], { type: "image/png" }), "draft.png");

  try {
    const resp = await fetch(url, { method: "POST", body: form });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.warn("Discord webhook respondeu com erro:", resp.status, t.slice(0, 200));
    }
  } catch (err) {
    console.error("Discord webhook error:", err?.message || err);
  }
}

function dataUrlToPngBuffer(dataUrl) {
  // data:image/png;base64,....
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  return Buffer.from(m[2], "base64");
}


// ===== timer & confirmação =====
const TURN_SECONDS = 30;

function nowMs() { return Date.now(); }

function stepNeedsTimer(step) {
  if (!step) return false;
  return ["MAP_BAN", "MAP_PICK", "CIV_BAN", "CIV_PICK", "CIV_SNIPE", "ASSIGN"].includes(step.type);
}

function startTimer(room) {
  room.state.timer.endsAt = nowMs() + TURN_SECONDS * 1000;
}

function clearTimer(room) {
  room.state.timer.endsAt = null;
}

function beginConfirm(room) {
  clearTimer(room);
  room.state.confirm.needed = true;
  room.state.confirm.ok.P1 = false;
  room.state.confirm.ok.P2 = false;
}

// confirmação pode apontar para um índice específico (ex: transição MAP -> CIV)
function beginConfirmTo(room, nextIndex, reason = null) {
  clearTimer(room);
  room.state.confirm.needed = true;
  room.state.confirm.ok.P1 = false;
  room.state.confirm.ok.P2 = false;
  room.state.confirm.nextIndex = nextIndex;
  room.state.confirm.reason = reason;
}

function updateTimerForCurrentStep(room) {
  const step = currentStep(room);
  if (room.state.confirm && room.state.confirm.needed) { clearTimer(room); return; }
  if (step && stepNeedsTimer(step)) startTimer(room);
  else clearTimer(room);
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function isMapStepType(t) {
  return t === "MAP_BAN" || t === "MAP_PICK" || t === "MAP_RANDOM";
}

function isCivStepType(t) {
  return t === "CIV_BAN" || t === "CIV_PICK" || t === "CIV_SNIPE" || t === "CIV_REVEAL";
}


/***
Room:
{
  id,
  createdAt,
  config: { series, maps[], civs[], flow[] },
  seats: { P1: socketId|null, P2: socketId|null },
  state: {
    started: false,
    ready: { P1:false, P2:false },
    stepIndex: 0,
    stepProgress: { P1:0, P2:0 },
    maps: { picked: [], pickedBy: { P1: [], P2: [], RND: [] }, bannedBy: { P1: [], P2: [] } },
    civs: {
      revealed: false,
      pickedBy: { P1:[], P2:[] },
      bannedGlobal: [],
      bannedBy: { P1:[], P2:[] },
      snipedBy: { P1:[], P2:[] }
    },
    assign: { byMap: [] } // [{P1:null,P2:null}]
  }
}
*/

function newRoom(config) {
  const id = nanoid(6).toUpperCase();
  const room = {
    id,
    createdAt: Date.now(),
    config,
    seats: { P1: null, P2: null },
    state: {
      started: false,
      ready: { P1: false, P2: false },
      timer: { endsAt: null },
      confirm: { needed: false, ok: { P1: false, P2: false }, nextIndex: null, reason: null },
      stepIndex: 0,
      stepProgress: { P1: 0, P2: 0 },
      maps: { picked: [], pickedBy: { P1: [], P2: [], RND: [] }, bannedBy: { P1: [], P2: [] } },
      civs: {
        revealed: false,
        pickedBy: { P1: [], P2: [] },
        bannedGlobal: [],
        bannedBy: { P1: [], P2: [] },
        snipedBy: { P1: [], P2: [] },
        pendingSnipe: { P1: null, P2: null }
      },
      assign: { byMap: [] }
    }
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  return rooms.get(id);
}


function normalizeDraftFlow(series, flow) {
  if (!Array.isArray(flow)) return flow;
  const expMapPicks = ({ BO1: 0, BO2: 2, BO3: 2, BO5: 4, BO7: 6 })[series] ?? null;
  if (expMapPicks === null) return flow;

  // só ajusta a parte de MAP_PICK antes do MAP_RANDOM (não mexe em bans)
  const idxRandom = flow.findIndex(s => s.type === "MAP_RANDOM");
  if (idxRandom === -1) return flow;

  const before = flow.slice(0, idxRandom);
  const after = flow.slice(idxRandom); // inclui MAP_RANDOM e resto
  const mapPicks = before.filter(s => s.type === "MAP_PICK");
  if (mapPicks.length <= expMapPicks) return flow;

  // remove picks excedentes (mantendo ordem), do fim para o começo
  let toRemove = mapPicks.length - expMapPicks;
  const trimmed = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const s = before[i];
    if (toRemove > 0 && s.type === "MAP_PICK") {
      toRemove -= 1;
      continue;
    }
    trimmed.push(s);
  }
  trimmed.reverse();
  return [...trimmed, ...after];
}

app.post("/api/rooms", (req, res) => {
  const config = req.body;

  if (!config?.series || !Array.isArray(config.maps) || !Array.isArray(config.civs) || !Array.isArray(config.flow)) {
    return res.status(400).json({ ok: false, error: "INVALID_CONFIG" });
  }

  if (config.maps.length < 5 || config.civs.length < 8) {
    return res.status(400).json({ ok: false, error: "POOL_TOO_SMALL" });
  }

  config.flow = normalizeDraftFlow(config.series, config.flow);

  const room = newRoom(config);
  res.json({ ok: true, id: room.id });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });
  res.json({ ok: true, room });
});

// ===== Admin / Painel de Salas =====
function roomAdminSummary(room) {
  const step = currentStep(room);
  const timerLeft = room.state && room.state.timer && room.state.timer.endsAt ? Math.max(0, Math.ceil((room.state.timer.endsAt - Date.now()) / 1000)) : null;

  const totalSteps = room.config && room.config.flow ? room.config.flow.length : 0;

  return {
    id: room.id,
    createdAt: room.createdAt,
    series: room.config?.series || null,
    started: !!room.state.started,
    ready: room.state.ready || { P1: false, P2: false },
    seats: { P1: !!room.seats.P1, P2: !!room.seats.P2 },
    stepIndex: room.state.stepIndex,
    stepTotal: totalSteps,
    stepType: step?.type || null,
    stepMode: step?.mode || null,
    confirmNeeded: !!(room.state.confirm && room.state.confirm.needed),
    confirmOk: (room.state.confirm && room.state.confirm.ok) || { P1: false, P2: false },
    timerLeft,
    completed: (step?.type === "SUMMARY"),
    summaryAvailable: !!(room.state.summary && room.state.summary.dataUrl),
  };
}

app.get("/api/admin/rooms", (req, res) => {
  try {
    const list = Array.from(rooms.values())
      .map((r) => {
        try {
          return roomAdminSummary(r);
        } catch (e) {
          // nunca quebrar o painel por causa de uma sala corrompida
          return {
            id: r?.id || null,
            createdAt: r?.createdAt || null,
            series: r?.config?.series || null,
            started: !!r?.state?.started,
            ready: r?.state?.ready || { P1: false, P2: false },
            seats: { P1: !!r?.seats?.P1, P2: !!r?.seats?.P2 },
            stepIndex: r?.state?.stepIndex ?? 0,
            stepTotal: r?.config?.flow?.length || 0,
            stepType: null,
            stepMode: null,
            confirmNeeded: !!(r?.state?.confirm?.needed),
            confirmOk: r?.state?.confirm?.ok || { P1: false, P2: false },
            timerLeft: null,
            completed: false,
            summaryAvailable: !!(r?.state?.summary?.dataUrl),
            error: String(e?.message || e)
          };
        }
      })
      // ordenar por createdAt desc (numérico) com fallback
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

    res.json({ rooms: list });
  } catch (e) {
    res.status(500).json({ error: "ADMIN_ROOMS_FAILED", details: String(e?.message || e) });
  }
});

app.get("/api/admin/rooms/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "ROOM_NOT_FOUND" });
  res.json({ room: roomAdminSummary(room), full: safeRoomPayload(room, null) });
});

// recebe a imagem do resumo gerada no client
app.post("/api/rooms/:id/summary", async (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "ROOM_NOT_FOUND" });

  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "INVALID_DATAURL" });
  }

  room.state.summary = {
    dataUrl,
    savedAt: new Date().toISOString(),
  };

  // 🔔 Notifica no Discord com a imagem (fire-and-forget)
  try {
    const buf = dataUrlToPngBuffer(dataUrl);
    if (buf) {
      sendDiscordSummaryImage({
        roomId: room.id,
        bufferPng: buf,
        series: room.config?.series || null,
      });
    }
  } catch (e) {
    console.warn("Falha ao enviar resumo para o Discord:", String(e?.message || e));
  }

  res.json({ ok: true });
});

// rota amigável (sem .html)
app.get("/admin/rooms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-rooms.html"));
});


function currentStep(room) {
  return room.config && room.config.flow ? room.config.flow[room.state.stepIndex] || null : null;
}

function resetProgress(room) {
  room.state.stepProgress.P1 = 0;
  room.state.stepProgress.P2 = 0;

  // limpa snipe pendente quando muda de step
  if (room.state && room.state.civs && room.state.civs.pendingSnipe) {
    room.state.civs.pendingSnipe.P1 = null;
    room.state.civs.pendingSnipe.P2 = null;
  }
}


function isMapTaken(room, mapName) {
  const { picked, bannedBy } = room.state.maps;
  return picked.includes(mapName) || bannedBy.P1.includes(mapName) || bannedBy.P2.includes(mapName);
}

function isCivBanned(room, civName) {
  return room.state.civs.bannedGlobal.includes(civName);
}

function ensureAssignSlots(room) {
  const nMaps = room.state.maps.picked.length;
  while (room.state.assign.byMap.length < nMaps) {
    room.state.assign.byMap.push({ P1: null, P2: null });
  }
}

function applyMapBan(room, by, mapName) {
  room.state.maps.bannedBy[by].push(mapName);
}

function applyMapPick(room, by, mapName) {
  room.state.maps.picked.push(mapName);
  if (room.state.maps.pickedBy) room.state.maps.pickedBy[by].push(mapName);
}

function applyMapRandom(room) {
  const pool = room.config.maps;
  const remaining = pool.filter(m => !isMapTaken(room, m));
  if (remaining.length === 0) {
    // fallback: não deveria acontecer se pool suficiente
    return;
  }
  const rnd = remaining[Math.floor(Math.random() * remaining.length)];
  room.state.maps.picked.push(rnd);
  if (room.state.maps.pickedBy) room.state.maps.pickedBy.RND.push(rnd);
}

function applyCivBan(room, by, civName) {
  room.state.civs.bannedBy[by].push(civName);
  room.state.civs.bannedGlobal.push(civName);
}

function applyCivPick(room, by, civName) {
  room.state.civs.pickedBy[by].push(civName);
}

function setPendingSnipe(room, by, civName) {
  room.state.civs.pendingSnipe[by] = civName;
}

function commitSnipes(room) {
  const p1 = room.state.civs.pendingSnipe.P1;
  const p2 = room.state.civs.pendingSnipe.P2;

  // Aplica P1 removendo do P2
  if (p1) {
    room.state.civs.pickedBy.P2 = room.state.civs.pickedBy.P2.filter(c => c !== p1);
    room.state.civs.snipedBy.P1.push(p1);
  }

  // Aplica P2 removendo do P1
  if (p2) {
    room.state.civs.pickedBy.P1 = room.state.civs.pickedBy.P1.filter(c => c !== p2);
    room.state.civs.snipedBy.P2.push(p2);
  }

  // limpa pendências
  room.state.civs.pendingSnipe.P1 = null;
  room.state.civs.pendingSnipe.P2 = null;
}


function applyAssign(room, by, mapIndex, civName) {
  ensureAssignSlots(room);
  room.state.assign.byMap[mapIndex][by] = civName;
}

function alreadyAssigned(room, by, civName) {
  return room.state.assign.byMap.some(slot => slot[by] === civName);
}

// igual ao alreadyAssigned, mas ignora o slot do mapa atual (para permitir troca/overwrite)
function alreadyAssignedExcept(room, by, civName, mapIndex) {
  return room.state.assign.byMap.some((slot, idx) => idx !== mapIndex && slot[by] === civName);
}

function applyAssignClear(room, by, mapIndex) {
  ensureAssignSlots(room);
  if (!room.state.assign.byMap[mapIndex]) return;
  room.state.assign.byMap[mapIndex][by] = null;
}

function validateAction(room, action) {
  const step = currentStep(room);
  if (!step) return { ok: false, error: "NO_STEP" };

  // ready gate
  if (!room.state.started) {
    if (action.kind !== "READY") return { ok: false, error: "NOT_STARTED" };
    return { ok: true };
  }

  // confirmação entre etapas
  if (room.state.confirm && room.state.confirm.needed) {
    if (action.kind !== "CONFIRM") return { ok: false, error: "WAIT_CONFIRM" };
    return { ok: true };
  }
  if (action.kind === "CONFIRM") {
    return { ok: false, error: "NO_CONFIRM_PENDING" };
  }

  // Auto steps should not receive user actions
  if (step.type === "MAP_RANDOM" || step.type === "CIV_REVEAL" || step.type === "SUMMARY") {
    return { ok: false, error: "AUTO_STEP" };
  }

  // Turn / Simul enforcement
  if (step.mode === "TURN") {
    if (step.by !== action.by) return { ok: false, error: "NOT_YOUR_TURN" };
  } else if (step.mode === "SIMUL") {
    if (action.by !== "P1" && action.by !== "P2") return { ok: false, error: "INVALID_ROLE" };
  }

  // Type enforcement (ASSIGN permite CLEAR)
  if (step.type !== action.kind) {
    if (!(step.type === "ASSIGN" && action.kind === "ASSIGN_CLEAR")) {
      return { ok: false, error: "WRONG_ACTION" };
    }
  }

  // Validation per action
  if (action.kind === "MAP_BAN") {
    if (!room.config.maps.includes(action.item)) return { ok: false, error: "MAP_NOT_IN_POOL" };
    if (isMapTaken(room, action.item)) return { ok: false, error: "MAP_TAKEN" };
  }

  if (action.kind === "MAP_PICK") {
    if (!room.config.maps.includes(action.item)) return { ok: false, error: "MAP_NOT_IN_POOL" };
    if (isMapTaken(room, action.item)) return { ok: false, error: "MAP_TAKEN" };
  }

  if (action.kind === "CIV_BAN") {
    if (!room.config.civs.includes(action.item)) return { ok: false, error: "CIV_NOT_IN_POOL" };
    if (isCivBanned(room, action.item)) return { ok: false, error: "CIV_ALREADY_BANNED" };
  }

  if (action.kind === "CIV_PICK") {
    if (!room.config.civs.includes(action.item)) return { ok: false, error: "CIV_NOT_IN_POOL" };
    if (isCivBanned(room, action.item)) return { ok: false, error: "CIV_BANNED" };

    // pode repetir a do oponente, mas não pode repetir a própria
    if (room.state.civs.pickedBy[action.by].includes(action.item)) return { ok: false, error: "CIV_DUP_SELF" };

    // limite do step
    const need = step.count || 1;
    if (room.state.stepProgress[action.by] >= need) return { ok: false, error: "LIMIT_REACHED" };
  }

  if (action.kind === "CIV_SNIPE") {
    const opp = action.by === "P1" ? "P2" : "P1";

    // só pode clicar nas civs do oponente
    if (!room.state.civs.pickedBy[opp].includes(action.item)) return { ok: false, error: "NOT_IN_OPP_PICKS" };

    // só pode escolher uma vez (neste step)
    if (room.state.civs.pendingSnipe[action.by]) {
      return { ok: false, error: "SNIPE_ALREADY_CHOSEN" };
    }

    const need = step.count || 1;
    if (room.state.stepProgress[action.by] >= need) return { ok: false, error: "LIMIT_REACHED" };
  }

  if (action.kind === "ASSIGN_CLEAR") {
    const mapIndex = action.mapIndex;
    if (typeof mapIndex !== "number") return { ok: false, error: "INVALID_MAP_INDEX" };
    ensureAssignSlots(room);
    if (mapIndex < 0 || mapIndex >= room.state.assign.byMap.length) return { ok: false, error: "INVALID_MAP_INDEX" };
    return { ok: true };
  }

  if (action.kind === "ASSIGN") {
    const { mapIndex, civ } = action;
    if (typeof mapIndex !== "number") return { ok: false, error: "BAD_MAP_INDEX" };
    if (!room.state.maps.picked[mapIndex]) return { ok: false, error: "MAP_INDEX_OOB" };

    const myCivs = room.state.civs.pickedBy[action.by];
    if (!myCivs.includes(civ)) return { ok: false, error: "CIV_NOT_OWNED" };

    ensureAssignSlots(room);
    // permite trocar a civ no mapa antes da confirmação (overwrite)
    // (não bloqueia se já havia algo atribuído neste mapa)

    if (alreadyAssignedExcept(room, action.by, civ, mapIndex)) return { ok: false, error: "CIV_ALREADY_USED" };
  }

  return { ok: true };
}

function advanceAutoSteps(room) {
  // loop automático: MAP_RANDOM e CIV_REVEAL e SUMMARY
  while (true) {
    const step = currentStep(room);
    if (!step) return;

    if (step.type === "MAP_RANDOM") {
      applyMapRandom(room);
      room.state.stepIndex += 1;
      resetProgress(room);
      // pausa antes de entrar na fase de CIV (mostra mapas definidos, incluindo o random)
      beginConfirmTo(room, room.state.stepIndex, "MAP_TO_CIV");
      updateTimerForCurrentStep(room);
      return;
    }

    if (step.type === "CIV_REVEAL") {
      room.state.civs.revealed = true;
      room.state.stepIndex += 1;
      resetProgress(room);
      continue;
    }

    if (step.type === "SUMMARY") {
      // só marca final, não precisa alterar nada aqui
      return;
    }

    return;
  }
}

function stepCompleted(room) {
  const step = currentStep(room);
  if (!step) return true;

  if (step.mode === "TURN") {
    return true; // turn steps advance after 1 action
  }

  // SIMUL steps:
  const need = step.count || 1;

  if (step.type === "CIV_PICK" || step.type === "CIV_SNIPE") {
    return room.state.stepProgress.P1 >= need && room.state.stepProgress.P2 >= need;
  }

  if (step.type === "ASSIGN") {
    ensureAssignSlots(room);
    const nMaps = room.state.maps.picked.length;
    if (nMaps === 0) return false;

    // completa quando ambos atribuíram civ pra todos os mapas
    for (let i = 0; i < nMaps; i++) {
      const slot = room.state.assign.byMap[i];
      if (!slot.P1 || !slot.P2) return false;
    }
    return true;
  }

  return false;
}

function advanceOne(room) {
  room.state.stepIndex += 1;
  resetProgress(room);
  advanceAutoSteps(room);
  updateTimerForCurrentStep(room);
}

// Avança 1 step (sem confirmação entre picks/bans). A confirmação MAP->CIV é disparada apenas após o MAP_RANDOM ser resolvido.
function advanceOneWithMapGate(room, prevType) {
  room.state.stepIndex += 1;
  resetProgress(room);
  advanceAutoSteps(room);
  updateTimerForCurrentStep(room);
}

function applyAction(room, action) {
  const step = currentStep(room);

  // READY (antes de começar)
  if (action.kind === "READY") {
    room.state.ready[action.by] = true;

    // só começa quando ambos prontos
    if (room.state.ready.P1 && room.state.ready.P2) {
      room.state.started = true;
      room.state.stepIndex = 0;
      room.state.confirm.needed = false;
      room.state.confirm.ok.P1 = false;
      room.state.confirm.ok.P2 = false;
      resetProgress(room);
      advanceAutoSteps(room);
      updateTimerForCurrentStep(room);
    }
    return;
  }

  // CONFIRM (entre etapas)
  if (action.kind === "CONFIRM") {
    room.state.confirm.ok[action.by] = true;
    if (room.state.confirm.ok.P1 && room.state.confirm.ok.P2) {
      room.state.confirm.needed = false;
      if (typeof room.state.confirm.nextIndex === "number") {
        room.state.stepIndex = room.state.confirm.nextIndex;
      } else {
        room.state.stepIndex += 1;
      }
      room.state.confirm.nextIndex = null;
      room.state.confirm.reason = null;
      resetProgress(room);
      advanceAutoSteps(room);
      updateTimerForCurrentStep(room);
    }
    return;
  }

  // --- daqui pra baixo seguem ações normais ---
  if (!step) return;

  if (action.kind === "CIV_SNIPE") {
    setPendingSnipe(room, action.by, action.item);
    room.state.stepProgress[action.by] += 1;

    if (stepCompleted(room)) {
      commitSnipes(room);
      // sem confirmação entre snipe e próxima etapa
      advanceOne(room);
    }
    return;
  }

  if (action.kind === "MAP_BAN") {
    applyMapBan(room, action.by, action.item);
    advanceOneWithMapGate(room, "MAP_BAN");
    return;
  }

  if (action.kind === "MAP_PICK") {
    applyMapPick(room, action.by, action.item);
    advanceOneWithMapGate(room, "MAP_PICK");
    return;
  }

  if (action.kind === "CIV_BAN") {
    applyCivBan(room, action.by, action.item);
    // sem confirmação entre bans
    advanceOne(room);
    return;
  }

  if (action.kind === "CIV_PICK") {
    applyCivPick(room, action.by, action.item);
    room.state.stepProgress[action.by] += 1;

    if (stepCompleted(room)) {
      beginConfirmTo(room, room.state.stepIndex + 1);
    }
    return;
  }

  if (action.kind === "ASSIGN") {
    applyAssign(room, action.by, action.mapIndex, action.civ);

    if (stepCompleted(room)) {
      beginConfirmTo(room, room.state.stepIndex + 1);
    }
    return;
  }

  if (action.kind === "ASSIGN_CLEAR") {
    applyAssignClear(room, action.by, action.mapIndex);
    // Se removeu algo, apenas mantém na etapa e atualiza o timer
    updateTimerForCurrentStep(room);
    return;
  }
}

function safeRoomPayload(room, forRole = null) {
  // envia config + state (sem socket ids)
  const payload = {
    id: room.id,
    createdAt: room.createdAt,
    config: room.config,
    seats: {
      P1: !!room.seats.P1,
      P2: !!room.seats.P2
    },
    state: JSON.parse(JSON.stringify(room.state))
  };

  // durante ASSIGN, esconder escolhas do oponente (só revela quando sair do step)
  const step = currentStep(room);
  const hideAssign = step && step.type === "ASSIGN";
  if (hideAssign && (forRole === "P1" || forRole === "P2") && payload.state.assign && payload.state.assign.byMap) {
    const opp = forRole === "P1" ? "P2" : "P1";
    payload.state.assign.byMap = payload.state.assign.byMap.map(slot => ({
      ...slot,
      [opp]: null
    }));
  }

  return payload;
}

// Emit room state to sockets in the room, respecting role-specific view (ASSIGN hiding).
async function emitRoomState(room) {
  try {
    const sockets = await io.in(room.id).fetchSockets();
    for (const s of sockets) {
      const role = (s.data && s.data.role) || (s.handshake && s.handshake.query && s.handshake.query.role) || null;
      s.emit("room:state", { room: safeRoomPayload(room, role) });
    }
  } catch (err) {
    console.error("emitRoomState error:", err);
  }
}


// ===== auto-resolve por tempo =====
function availableMaps(room) {
  const st = room.state;
  return room.config.maps.filter(m => !isMapTaken(room, m));
}

function availableCivs(room, by) {
  const st = room.state;
  const mine = st.civs.pickedBy[by];
  return room.config.civs.filter(c => !isCivBanned(room, c) && !mine.includes(c));
}

function autoResolveStep(room) {
  const step = currentStep(room);
  if (!step) return;

  // TURN: faz 1 ação e entra em confirmação
  if (step.mode === "TURN") {
    const by = step.by;

    if (step.type === "MAP_BAN") {
      const pool = availableMaps(room);
      if (pool.length) applyMapBan(room, by, rand(pool));
      advanceOneWithMapGate(room, "MAP_BAN");
      return;
    }

    if (step.type === "MAP_PICK") {
      const pool = availableMaps(room);
      if (pool.length) applyMapPick(room, by, rand(pool));
      advanceOneWithMapGate(room, "MAP_PICK");
      return;
    }

    if (step.type === "CIV_BAN") {
      const pool = room.config.civs.filter(c => !isCivBanned(room, c));
      if (pool.length) applyCivBan(room, by, rand(pool));
      beginConfirmTo(room, room.state.stepIndex + 1);
      return;
    }
  }

  // SIMUL: completa o que faltar e, se completo, confirma
  if (step.mode === "SIMUL") {
    const need = step.count || 1;

    if (step.type === "CIV_PICK") {
      for (const by of ["P1", "P2"]) {
        while (room.state.stepProgress[by] < need) {
          const pool = availableCivs(room, by);
          if (!pool.length) break;
          const pick = rand(pool);
          applyCivPick(room, by, pick);
          room.state.stepProgress[by] += 1;
        }
      }
      if (stepCompleted(room)) {
        // em timeout, ASSIGN deve avançar direto para o resumo (sem exigir OK)
        advanceOne(room);
      }
      return;
    }

    if (step.type === "CIV_SNIPE") {
      for (const by of ["P1", "P2"]) {
        while (room.state.stepProgress[by] < need) {
          const opp = by === "P1" ? "P2" : "P1";
          const oppPicks = room.state.civs.pickedBy[opp] || [];
          if (!oppPicks.length) break;
          // se já tem pending, não escolhe de novo
          if (room.state.civs.pendingSnipe[by]) break;
          setPendingSnipe(room, by, rand(oppPicks));
          room.state.stepProgress[by] += 1;
        }
      }
      if (stepCompleted(room)) {
        commitSnipes(room);
        beginConfirmTo(room, room.state.stepIndex + 1);
      }
      return;
    }

    if (step.type === "ASSIGN") {
      ensureAssignSlots(room);
      const nMaps = room.state.maps.picked.length;

      for (const by of ["P1", "P2"]) {
        const mine = room.state.civs.pickedBy[by] || [];
        const used = new Set(room.state.assign.byMap.map(s => s[by]).filter(Boolean));

        for (let i = 0; i < nMaps; i++) {
          if (room.state.assign.byMap[i][by]) continue;
          const remaining = mine.filter(c => !used.has(c));
          if (!remaining.length) break;
          room.state.assign.byMap[i][by] = remaining[0];
          used.add(remaining[0]);
        }
      }

      if (stepCompleted(room)) {
        // em timeout, ASSIGN deve avançar direto para o resumo (sem exigir OK)
        advanceOne(room);
      }
      return;
    }
  }
}

// tick: expira o timer e auto-resolve
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.state.started) continue;
    if (room.state.confirm && room.state.confirm.needed) continue;

    const step = currentStep(room);
    if (!stepNeedsTimer(step)) continue;

    const endsAt = room.state.timer && room.state.timer.endsAt;
    if (!endsAt) continue;

    if (nowMs() >= endsAt) {
      autoResolveStep(room);
      // fire-and-forget; emitter will log errors
      emitRoomState(room);
    }
  }
}, 500);

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, role }) => {
    const room = getRoom(roomId);
    if (!room) return socket.emit("room:error", { error: "ROOM_NOT_FOUND" });

    if (role !== "P1" && role !== "P2" && role !== "OBS") return socket.emit("room:error", { error: "INVALID_ROLE" });

    // seat lock (apenas P1/P2)
    if (role === "P1" || role === "P2") {
      if (room.seats[role] && room.seats[role] !== socket.id) {
        return socket.emit("room:error", { error: "ROLE_TAKEN" });
      }
      room.seats[role] = socket.id;
    }

    // ensure socket.data exists (compat with older/newer socket.io)
    if (!socket.data) socket.data = {};
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.join(roomId);

    socket.emit("room:state", { room: safeRoomPayload(room, role) });
    socket.to(roomId).emit("room:presence", { role, joined: true });

    // auto-advance just in case
    if (room.state.started) {
      advanceAutoSteps(room);
      updateTimerForCurrentStep(room);
      emitRoomState(room);
    }
  });

  socket.on("draft:action", ({ roomId, action }) => {
    const room = getRoom(roomId);
    if (!room) return socket.emit("draft:error", { error: "ROOM_NOT_FOUND" });

    const v = validateAction(room, action);
    if (!v.ok) return socket.emit("draft:error", v);

    applyAction(room, action);

    emitRoomState(room);
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data || {};
    if (!roomId || !role) return;

    const room = getRoom(roomId);
    if (!room) return;

    // free seat if same socket
    if ((role === "P1" || role === "P2") && room.seats[role] === socket.id) room.seats[role] = null;

    socket.to(roomId).emit("room:presence", { role, joined: false });
    emitRoomState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("listening on", PORT));
