const socket = io();
const $ = (id) => document.getElementById(id);

// helpers (observer.html não possui todos os elementos do room.html)
function setText(id, value){
  const el = $(id);
  if(el) el.textContent = value;
}
function showEl(id){
  const el = $(id);
  if(el) el.classList.remove("hidden");
}
function hideEl(id){
  const el = $(id);
  if(el) el.classList.add("hidden");
}

let ROOM_ID = "";
let MY_ROLE = "P1";
let ROOM = null;

let selectedMapIndex = null; // para ASSIGN

function qs() {
  const p = new URLSearchParams(location.search);
  return {
    id: (p.get("id") || "").toUpperCase(),
    role: (p.get("role") || "").toUpperCase()
  };
}

function setStatus(text, ok=false){
  $("status").className = "status " + (ok ? "okText" : "muted");
  $("status").textContent = text;
}

function stepText(step){
  if(!step) return "—";
  if(step.type === "MAP_BAN") return "MAPA • BAN";
  if(step.type === "MAP_PICK") return "MAPA • PICK";
  if(step.type === "MAP_RANDOM") return "MAPA • RANDOM PICK";
  if(step.type === "CIV_BAN") return "CIV • BAN";
  if(step.type === "CIV_PICK") return "CIV • PICK (SIMULTÂNEO)";
  if(step.type === "CIV_REVEAL") return "CIV • REVEAL";
  if(step.type === "CIV_SNIPE") return "CIV • SNIPE (SIMULTÂNEO)";
  if(step.type === "ASSIGN_DECIDE") return "ASSIGN • CONFIRMAR";
  if(step.type === "ASSIGN") return "ASSIGN • CIV POR MAPA";
  if(step.type === "SUMMARY") return "RESUMO";
  return step.type;
}

function instructionText(room){
  const st = room.state;
  const step = room.config.flow[st.stepIndex];

  if(MY_ROLE === "OBS"){
    if(!st.started) return "Observando… aguardando ambos jogadores ficarem PRONTOS.";
    if(st.confirm?.needed) return "Observando… aguardando confirmação dos jogadores.";
  }

  if(!st.started){
    return "Aguardando ambos jogadores ficarem PRONTOS.";
  }

  // etapa concluída: aguarda OK dos dois
  if(st.confirm?.needed){
    const mineOk = !!st.confirm.ok?.[MY_ROLE];
    const oppRole = MY_ROLE === "P1" ? "P2" : "P1";
    const oppOk = !!st.confirm.ok?.[oppRole];
    if(mineOk && !oppOk) return "OK enviado ✅ aguardando o oponente confirmar…";
    if(!mineOk && oppOk) return "Oponente confirmou ✅ clique OK para avançar."; 
    if(mineOk && oppOk) return "Ambos confirmaram ✅ avançando…";
    return "Etapa concluída. Clique OK para avançar.";
  }

  if(!step) return "—";

if(step.type === "MAP_BAN"){
  if(step.mode === "TURN"){
    return step.by === MY_ROLE
      ? "Sua vez: BANIR 1 MAPA"
      : "Vez do oponente: BANIR 1 MAPA";
  }
  return "BANIR 1 MAPA";
}

if(step.type === "MAP_PICK"){
  if(step.mode === "TURN"){
    return step.by === MY_ROLE
      ? "Sua vez: ESCOLHER 1 MAPA"
      : "Vez do oponente: ESCOLHER 1 MAPA";
  }
  return "ESCOLHER 1 MAPA";
}


if(step.type === "CIV_BAN"){
  return step.by === MY_ROLE
    ? "Sua vez: BANIR 1 CIV"
    : "Vez do oponente: BANIR 1 CIV";
}


  if(step.type === "CIV_PICK"){
    const need = step.count || 1;
    const mine = st.stepProgress[MY_ROLE];
    return `ESCOLHA ${need} CIVILIZAÇÕES (${mine}/${need}) • simultâneo`;
  }

  if(step.type === "CIV_SNIPE"){
	  const need = step.count || 1;
	  const mine = st.stepProgress[MY_ROLE];
	  const pend = st.civs?.pendingSnipe?.[MY_ROLE];
	  const oppRole = MY_ROLE === "P1" ? "P2" : "P1";
	  const oppPend = st.civs?.pendingSnipe?.[oppRole];

	  if (pend && !oppPend) {
		return `SNIPE escolhido ✅ aguardando o oponente…`;
	  }

	  return `SNIPE: REMOVA ${need} CIV DO OPONENTE (${mine}/${need}) • clique nas civs do oponente`;
	}


  if(step.type === "ASSIGN"){
    return `ASSIGN: selecione uma CIV sua para cada MAPA (sem repetir)`;
  }

  if(step.type === "ASSIGN_DECIDE"){
    const mine = st.assignDecide?.[MY_ROLE];
    if(mine === true) return "Você votou SIM ✅ aguardando o oponente…";
    if(mine === false) return "Você votou NÃO ✅ aguardando o oponente…";
    return "Desejam selecionar civilizações por mapa? (ambos precisam marcar SIM)";
  }

  if(step.type === "CIV_REVEAL"){
    return `REVEAL: civs reveladas`;
  }

  if(step.type === "MAP_RANDOM"){
    return `RANDOM PICK: mapa definido automaticamente`;
  }

  if(step.type === "SUMMARY"){
    return `RESUMO: imagem gerada`;
  }

  return "—";
}

function slugify(name){
  return String(name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function imgUrl(kind, name){
  const slug = slugify(name);
  // tenta estrutura recomendada
  if(kind === "map") return [`imgs/maps/${slug}.jpg`, `imgs/${slug}.jpg`];
  if(kind === "civ") return [`imgs/civs/${slug}.jpg`, `imgs/${slug}.jpg`];
  return [`imgs/${slug}.jpg`];
}

function makeIcon(kind, name, extraClass=""){
  const wrap = document.createElement("div");
  wrap.className = `iconCard ${extraClass}`.trim();

  const img = document.createElement("img");
  img.className = "iconImg";
  const urls = imgUrl(kind, name);
  img.src = urls[0];
  img.onerror = () => {
    // fallback
    if(img.dataset.fallbackDone) return;
    img.dataset.fallbackDone = "1";
    img.src = urls[1] || "imgs/placeholder.jpg";
  };

  const lab = document.createElement("div");
  lab.className = "iconLabel";
  lab.textContent = name;

  wrap.appendChild(img);
  wrap.appendChild(lab);
  return wrap;
}

function clear(el){ el.innerHTML = ""; }

function currentStep(room){
  return room.config.flow[room.state.stepIndex] || null;
}

function isMyTurn(room){
  if(MY_ROLE === "OBS") return false;
  if(room.state.confirm?.needed) return false;
  const step = currentStep(room);
  if(!step) return false;
  if(step.mode === "SIMUL") return true;
  if(step.mode === "TURN") return step.by === MY_ROLE;
  return false;
}

function renderMiniRows(room){
  // Em MAP: "Selecionado" mostra maps picked; "Banido" mostra bans
  // Em CIV: "Selecionado" mostra civ picks (se não revelou, esconde); "Banido/Sniped" mostra ban global + snipes recebidos etc.
  const st = room.state;
  const step = currentStep(room);

  const p1Sel = $("p1Sel");
  const p2Sel = $("p2Sel");
  const p1Ban = $("p1Ban");
  const p2Ban = $("p2Ban");

  clear(p1Sel); clear(p2Sel); clear(p1Ban); clear(p2Ban);

  const phaseIsMap = step && (step.type.startsWith("MAP") || step.type==="MAP_RANDOM");

  if(phaseIsMap){
    // picks (atribui por jogador, incluindo RANDOM)
    const pb = st.maps.pickedBy;
    if(pb){
      (pb.P1||[]).forEach(m => p1Sel.appendChild(makeIcon("map", m)));
      (pb.P2||[]).forEach(m => p2Sel.appendChild(makeIcon("map", m)));
      (pb.RND||[]).forEach(m => {
        // random aparece para ambos como “definido”
        p1Sel.appendChild(makeIcon("map", m));
        p2Sel.appendChild(makeIcon("map", m));
      });
    } else {
      // fallback antigo
      (st.maps.picked||[]).forEach(m => p1Sel.appendChild(makeIcon("map", m)));
    }
    // bans
    st.maps.bannedBy.P1.forEach(m => p1Ban.appendChild(makeIcon("map", m, "banOutline")));
    st.maps.bannedBy.P2.forEach(m => p2Ban.appendChild(makeIcon("map", m, "banOutline")));
    return;
  }

  // CIV phase / ASSIGN / SUMMARY
  const revealed = st.civs.revealed;

  const p1P = st.civs.pickedBy.P1;
  const p2P = st.civs.pickedBy.P2;

  const showCivs = (arr, targetEl, roleOfRow) => {
    arr.forEach(c => {
      // Antes do REVEAL: cada jogador vê apenas as próprias civs; do oponente fica oculto
      if (revealed || roleOfRow === MY_ROLE) {
        targetEl.appendChild(makeIcon("civ", c));
      } else {
        const hidden = document.createElement("div");
        hidden.className = "iconCard hiddenCard";
        hidden.innerHTML = `<div class="hiddenMark">?</div><div class="iconLabel">Oculto</div>`;
        targetEl.appendChild(hidden);
      }
    });
  };

  showCivs(p1P, p1Sel, "P1");
  showCivs(p2P, p2Sel, "P2");

  // bans + snipes
  st.civs.bannedBy.P1.forEach(c => p1Ban.appendChild(makeIcon("civ", c, "banOutline")));
  st.civs.bannedBy.P2.forEach(c => p2Ban.appendChild(makeIcon("civ", c, "banOutline")));

  st.civs.snipedBy.P2.forEach(c => {
    // se P2 snipou, P1 perdeu
    p1Ban.appendChild(makeIcon("civ", c, "snipOutline"));
  });
  st.civs.snipedBy.P1.forEach(c => {
    p2Ban.appendChild(makeIcon("civ", c, "snipOutline"));
  });
}

function renderAssignMaps(room){
  const st = room.state;
  const step = currentStep(room);
  const box = $("assignMaps");

  if(!step || step.type !== "ASSIGN"){
    box.classList.add("hidden");
    selectedMapIndex = null;
    return;
  }

  box.classList.remove("hidden");

  // mostra civs disponíveis do oponente (apenas visual)
  const opp = MY_ROLE === "P1" ? "P2" : "P1";
  const oppRow = document.getElementById("oppCivsRow");
  if(oppRow){
    clear(oppRow);
    (st.civs.pickedBy?.[opp] || []).forEach(c => oppRow.appendChild(makeIcon("civ", c)));
  }

  const mapsRow = $("mapsRow");
  clear(mapsRow);

  st.maps.picked.forEach((m, idx) => {
    const card = document.createElement("div");
    card.className = "mapAssignCard" + (selectedMapIndex===idx ? " active" : "");
    card.addEventListener("click", () => {
      selectedMapIndex = idx;
      renderAssignMaps(room);
    });

    const top = document.createElement("div");
    top.className = "mapTop";
    top.appendChild(makeIcon("map", m));

    const slot = document.createElement("div");
    slot.className = "assignSlots";

    const p1 = document.createElement("div");
    p1.className = "assignSlot";
    p1.innerHTML = `<div class="slotHead"><span class="dot green"></span>P1</div>`;
    const a1 = st.assign.byMap?.[idx]?.P1;
    p1.appendChild(a1 ? makeIcon("civ", a1) : emptySlot());

    const p2 = document.createElement("div");
    p2.className = "assignSlot";
    p2.innerHTML = `<div class="slotHead"><span class="dot amber"></span>P2</div>`;
    const a2 = st.assign.byMap?.[idx]?.P2;
    p2.appendChild(a2 ? makeIcon("civ", a2) : emptySlot());

    slot.appendChild(p1);
    slot.appendChild(p2);

    card.appendChild(top);
    card.appendChild(slot);
    mapsRow.appendChild(card);
  });

  $("assignHint").classList.remove("hidden");
}

function emptySlot(){
  const d = document.createElement("div");
  d.className = "iconCard emptyCard";
  d.innerHTML = `<div class="hiddenMark">+</div><div class="iconLabel">Vazio</div>`;
  return d;
}

function renderPool(room){
  const st = room.state;
  const step = currentStep(room);
  const pool = $("pool");
  clear(pool);

  // reset visibilidade (ASSIGN usa containers separados)
  pool.classList.remove("hidden");
  const ap = document.getElementById("assignPools");
  if(ap) ap.classList.add("hidden");

  $("poolTitle").textContent = "POOL";
  $("assignHint").classList.add("hidden");

  if(!st.started){
    // sem pool enquanto não inicia
    return;
  }


  // REVIEW (fim da fase de MAPAS): mostra mapas definidos + botão OK (confirm MAP->CIV)
  if(st.confirm?.needed && st.confirm.reason === "MAP_TO_CIV"){
    $("poolTitle").textContent = "MAPAS DEFINIDOS";
    $("assignHint").classList.add("hidden");

    // lista de mapas escolhidos (inclui o Random já definido no estado)
    (st.maps.picked || []).forEach(m => {
      const card = document.createElement("div");
      card.className = "poolItem";
      card.appendChild(makeIcon("map", m));
      pool.appendChild(card);
    });

    // opcional: lista bans
    const bans = [...(st.maps.bannedBy?.P1||[]), ...(st.maps.bannedBy?.P2||[])];
    if(bans.length){
      const sep = document.createElement("div");
      sep.className = "poolSep";
      sep.textContent = "Bans:";
      pool.appendChild(sep);
      bans.forEach(m => {
        const wrap = document.createElement("div");
        wrap.className = "poolItem";
        wrap.appendChild(makeIcon("map", m, "banOutline"));
        pool.appendChild(wrap);
      });
    }
    return;
  }

  // Decide o que é clicável no momento
  const clickable = isMyTurn(room);

  // ASSIGN DECIDE
  if(step.type === "ASSIGN_DECIDE"){
    $("poolTitle").textContent = "ASSIGN";
    const box = document.createElement("div");
    box.className = "panel";
    box.style.borderRadius = "18px";
    box.innerHTML = `<div class="center"><div class="instruction" style="margin:0">Desejam selecionar as civilizações para cada mapa?</div><div class="muted small mt1">Ambos devem marcar <strong>SIM</strong> para habilitar o ASSIGN.</div></div>`;
    pool.appendChild(box);

    const mine = st.assignDecide?.[MY_ROLE];
    if(MY_ROLE === "OBS"){
      const m = document.createElement("div");
      m.className = "muted mt1";
      m.textContent = "(Observer) aguardando decisão dos jogadores…";
      pool.appendChild(m);
      return;
    }

    const row = document.createElement("div");
    row.className = "joinGrid";
    row.style.gridTemplateColumns = "1fr 1fr";
    row.style.marginTop = "12px";

    const yes = document.createElement("button");
    yes.className = "btn primary w100";
    yes.textContent = mine === true ? "SIM ✅" : "SIM";
    yes.disabled = mine !== null;
    yes.addEventListener("click", () => {
      socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "ASSIGN_DECIDE", choice: true } });
    });

    const no = document.createElement("button");
    no.className = "btn w100";
    no.textContent = mine === false ? "NÃO ✅" : "NÃO";
    no.disabled = mine !== null;
    no.addEventListener("click", () => {
      socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "ASSIGN_DECIDE", choice: false } });
    });

    row.appendChild(yes);
    row.appendChild(no);
    pool.appendChild(row);
    return;
  }

  

  // MAP BAN / MAP PICK
  if(step.type === "MAP_BAN" || step.type === "MAP_PICK"){
    $("poolTitle").textContent = "MAPAS";
    room.config.maps.forEach(m => {
      const taken = st.maps.picked.includes(m) || st.maps.bannedBy.P1.includes(m) || st.maps.bannedBy.P2.includes(m);
      const btn = document.createElement("button");
      btn.className = "poolBtn" + (taken ? " taken" : "");
      btn.disabled = taken || !clickable || (step.mode==="TURN" && step.by!==MY_ROLE);

      btn.appendChild(makeIcon("map", m));
      btn.addEventListener("click", () => {
        const kind = step.type; // MAP_BAN or MAP_PICK
        socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind, item: m } });
      });
      pool.appendChild(btn);
    });
    return;
  }

  // CIV BAN (BO1)
  if(step.type === "CIV_BAN"){
    $("poolTitle").textContent = "CIVILIZAÇÕES";
    room.config.civs.forEach(c => {
      const banned = st.civs.bannedGlobal.includes(c);
      const btn = document.createElement("button");
      btn.className = "poolBtn" + (banned ? " taken" : "");
      btn.disabled = banned || !clickable || step.by!==MY_ROLE;
      btn.appendChild(makeIcon("civ", c));
      btn.addEventListener("click", () => {
        socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "CIV_BAN", item: c } });
      });
      pool.appendChild(btn);
    });
    return;
  }

  // CIV PICK (SIMUL): pode repetir do oponente, mas não a própria
  if(step.type === "CIV_PICK"){
    $("poolTitle").textContent = "ESCOLHA SUAS CIVILIZAÇÕES";
    const myPicked = st.civs.pickedBy[MY_ROLE];

    room.config.civs.forEach(c => {
      const banned = st.civs.bannedGlobal.includes(c);
      const dupSelf = myPicked.includes(c);

      const btn = document.createElement("button");
      btn.className = "poolBtn" + ((banned || dupSelf) ? " taken" : "");
      btn.disabled = banned || dupSelf || !clickable;

      btn.appendChild(makeIcon("civ", c));
      btn.addEventListener("click", () => {
        socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "CIV_PICK", item: c } });
      });
      pool.appendChild(btn);
    });
    return;
  }

  // CIV SNIPE (SIMUL): mostra somente civs do OPONENTE
	if(step.type === "CIV_SNIPE"){
	  $("poolTitle").textContent = "SNIPE: CIVS DO OPONENTE";

	  const opp = MY_ROLE === "P1" ? "P2" : "P1";
	  const oppPicks = st.civs.pickedBy[opp] || [];

	  // 👇 ADICIONE ESTA LINHA
	  const alreadySniped = st.civs?.pendingSnipe?.[MY_ROLE];

	  oppPicks.forEach(c => {
		const btn = document.createElement("button");
		btn.className = "poolBtn" + (alreadySniped === c ? " taken" : "");

		// 👇 ALTERE ESTA LINHA
		btn.disabled = !clickable || !!alreadySniped;

		btn.appendChild(makeIcon("civ", c, "snipOutline"));
		btn.addEventListener("click", () => {
		  socket.emit("draft:action", {
			roomId: ROOM_ID,
			action: { by: MY_ROLE, kind: "CIV_SNIPE", item: c }
		  });
		});
		pool.appendChild(btn);
	  });

	  if(oppPicks.length === 0){
		const msg = document.createElement("div");
		msg.className = "muted";
		msg.textContent = "Oponente não possui civs disponíveis para snipe.";
		pool.appendChild(msg);
	  }

	  return;
	}


  // ASSIGN (SIMUL): pool mostra apenas suas civs restantes (não usadas)
  if(step.type === "ASSIGN"){
    // layout simplificado: só mostra suas civs + civs disponíveis do oponente
    $("poolTitle").textContent = "ASSIGN: ESCOLHA UMA CIV PARA CADA MAPA";
    renderAssignMaps(room);

    // esconde pool padrão e usa os containers dedicados
    pool.classList.add("hidden");
    const assignPools = document.getElementById("assignPools");
    if(assignPools) assignPools.classList.remove("hidden");

    const myPool = document.getElementById("myCivsPool");
    if(myPool) myPool.innerHTML = "";

    const mine = st.civs.pickedBy[MY_ROLE] || [];
    // barra de controle (permite remover/trocar antes do OK)
    const ctrlHost = assignPools || document.body;
    let ctrlBar = document.getElementById("assignCtrlBar");
    if(!ctrlBar){
      ctrlBar = document.createElement("div");
      ctrlBar.id = "assignCtrlBar";
      ctrlBar.className = "assignCtrlBar";
      ctrlHost.prepend(ctrlBar);
    }
    ctrlBar.innerHTML = "";
    const selIdx = (selectedMapIndex === null ? 0 : selectedMapIndex);
    const currentMine = st.assign?.byMap?.[selIdx]?.[MY_ROLE] || null;

    const help = document.createElement("div");
    help.className = "assignCtrlText";
    help.textContent = currentMine ? `Mapa selecionado: #${selIdx+1} • sua civ atual: ${currentMine}` : `Mapa selecionado: #${selIdx+1}`;
    ctrlBar.appendChild(help);

    const btnClear = document.createElement("button");
    btnClear.className = "btn small";
    btnClear.textContent = currentMine ? "Remover / trocar civ" : "Selecione um mapa para trocar";
    btnClear.disabled = !currentMine;
    btnClear.addEventListener("click", () => {
      socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "ASSIGN_CLEAR", mapIndex: selIdx } });
    });
    ctrlBar.appendChild(btnClear);

    const opp = MY_ROLE === "P1" ? "P2" : "P1";
    const oppCivs = st.civs.pickedBy[opp] || [];

    // minhas civs clicáveis (sem repetir)
    mine.forEach(c => {
      const used = st.assign.byMap?.some(slot => slot[MY_ROLE] === c);
      const btn = document.createElement("button");
      btn.className = "poolBtn" + (used ? " taken" : "");
      btn.disabled = used || !clickable;
      btn.appendChild(makeIcon("civ", c));
      btn.addEventListener("click", () => {
        if(selectedMapIndex === null){
          alert("Selecione um mapa primeiro.");
          return;
        }
        socket.emit("draft:action", {
          roomId: ROOM_ID,
          action: { by: MY_ROLE, kind: "ASSIGN", mapIndex: selectedMapIndex, civ: c }
        });
      });
      if(myPool) myPool.appendChild(btn);
    });

    return;
  }

  // SUMMARY: sem pool
}

async function drawSummary(room){
  const canvas = $("summaryCanvas");
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // header
  ctx.fillStyle = "#0b1220";
  ctx.font = "bold 40px system-ui";
  ctx.fillText("LBI • RESUMO DO DRAFT", 40, 70);

  ctx.font = "bold 26px system-ui";
  ctx.fillText(`ID: ${room.id}   |   Série: ${room.config.series}`, 40, 115);

  const p1Label = room.state.players?.P1?.name?.trim() || "Jogador #1";
  const p2Label = room.state.players?.P2?.name?.trim() || "Jogador #2";
  ctx.font = "600 20px system-ui";
  ctx.fillStyle = "rgba(11,18,32,.75)";
  ctx.fillText(`P1: ${p1Label}   |   P2: ${p2Label}`, 40, 150);

  // helper to load image
  const loadImg = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  async function loadCivIcon(civName){
    if(!civName) return null;
    const s = slugify(civName);
    const tries = [`imgs/civs/${s}.jpg`, `imgs/civs/${s}.png`, `imgs/${s}.jpg`, `imgs/${s}.png`];
    for(const t of tries){
      const img = await loadImg(t);
      if(img) return img;
    }
    return null;
  }

  function drawBadge(text, x, y){
    ctx.font = "bold 13px system-ui";
    const padX = 10;
    const padY = 6;
    const w = ctx.measureText(text).width + padX*2;
    ctx.fillStyle = "rgba(11,18,32,.08)";
    roundRect(ctx, x, y-16, w, 24, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(11,18,32,.75)";
    ctx.fillText(text, x+padX, y);
  }

  function drawCivRow(label, civs, x, topY, maxW){
    // Layout mais "organizado": nada de offsets negativos (evita sobreposição)
    const icon = 40;// menor para caber mais colunas
    const gap = 8;
    const lineH = 50;
    const labelW = 92;

    // label à esquerda (centralizado verticalmente com a 1a linha de ícones)
    ctx.font = "bold 17px system-ui";
    ctx.fillStyle = "rgba(11,18,32,.85)";
    ctx.fillText(label, x, topY + 32);

    let cx = x + labelW;
    let lineY = topY;
    const startX = cx;

    (civs || []).forEach(async () => {}); // no-op
    return (async () => {
      for(const civ of (civs || [])){
        const img = await loadCivIcon(civ);
        if(cx + icon > x + maxW){
          cx = startX;
          lineY += lineH;
        }
        if(img){
          ctx.drawImage(img, cx, lineY, icon, icon);
        } else {
          ctx.fillStyle = "rgba(11,18,32,.10)";
          ctx.fillRect(cx, lineY, icon, icon);
        }
        cx += icon + gap;
      }
      // retorna o Y do próximo bloco, com um respiro
      return lineY + lineH + 8;
    })();
  }

  const maps = room.state.maps.picked || [];
  const firstMap = (maps.length ? maps[maps.length-1] : "—");
  drawBadge(`Primeiro jogo: ${firstMap}`, 40, 182);

  const assignEnabled = room.state.assign?.enabled !== false;
  let slots = (assignEnabled ? (room.state.assign.byMap || []) : []);
  // BO1 (ou séries sem ASSIGN): usa picks diretos como "atribuição" do único mapa
  if((!slots || slots.length === 0) && Array.isArray(room.state.maps?.picked) && room.state.maps.picked.length === 1){
    const c1 = room.state.civs?.pickedBy?.P1?.[0] || null;
    const c2 = room.state.civs?.pickedBy?.P2?.[0] || null;
    slots = [{ P1: c1, P2: c2 }];
  }

  // layout
  const startY = 210;
  const cardW = 420;
  const cardH = 180;
  const gapX = 30;
  const gapY = 25;

  // Ordem: o mapa randomizado por último (último da lista) vira GAME 1
  const order = maps.length <= 1
    ? maps.map((m, idx) => ({ map: m, idx }))
    : [{ map: maps[maps.length-1], idx: maps.length-1 }, ...maps.slice(0, maps.length-1).map((m, idx) => ({ map: m, idx }))];

  const cols = 3;
  for(let i=0;i<order.length;i++){
    const item = order[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const x = 40 + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // card bg
    ctx.strokeStyle = "rgba(11,18,32,.18)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, cardW, cardH, 18);
    ctx.stroke();

    // map image
    const mapName = item.map;
    const mapSlug = slugify(mapName);
    const mapTry = [`imgs/maps/${mapSlug}.jpg`, `imgs/maps/${mapSlug}.png`, `imgs/${mapSlug}.jpg`, `imgs/${mapSlug}.png`];
    let mapImg = null;
    for(const t of mapTry){
      mapImg = await loadImg(t);
      if(mapImg) break;
    }

    if(mapImg){
      ctx.drawImage(mapImg, x+18, y+18, 128, 128);
    } else {
      ctx.fillStyle = "rgba(11,18,32,.08)";
      ctx.fillRect(x+18, y+18, 128, 128);
    }

    // map label
    ctx.fillStyle = "#0b1220";
    ctx.font = "bold 18px system-ui";
    ctx.fillText(mapName, x+160, y+44);

    // label (game 1 vs escolha do perdedor)
    const isGame1 = (item.idx === maps.length - 1);

    // Destaque visual forte para o primeiro mapa
    if(isGame1){
      const tagW = 132;
      const tagH = 28;
      const tagX = x + cardW - tagW - 18;
      const tagY = y + 18;
      ctx.fillStyle = "rgba(255,210,120,.95)";
      roundRect(ctx, tagX, tagY, tagW, tagH, 10);
      ctx.fill();
      ctx.fillStyle = "rgba(11,18,32,.92)";
      ctx.font = "900 14px system-ui";
      ctx.fillText("1º JOGO", tagX + 14, tagY + 19);
    }

    ctx.fillStyle = isGame1 ? "rgba(11,18,32,.90)" : "rgba(11,18,32,.65)";
    ctx.font = isGame1 ? "900 15px system-ui" : "bold 14px system-ui";
    ctx.fillText(isGame1 ? "GAME 1 (MAPA INICIAL)" : "ESCOLHA DO PERDEDOR", x+160, y+64);

    // assignments
    const a = slots[item.idx] || {P1:null,P2:null};

    // P1 civ (com ícone)
    ctx.font = "bold 16px system-ui";
    ctx.fillStyle = "#0b7a3e";
    ctx.fillText("P1:", x+160, y+92);

    if(assignEnabled && a.P1){
      const img = await loadCivIcon(a.P1);
      if(img) ctx.drawImage(img, x+205, y+72, 40, 40);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(a.P1, x+252, y+92);
    } else {
      ctx.fillStyle = "#0b1220";
      ctx.fillText(assignEnabled ? "—" : "(ver pool abaixo)", x+205, y+92);
    }

    // P2 civ (com ícone)
    ctx.fillStyle = "#a56a00";
    ctx.fillText("P2:", x+160, y+132);

    if(assignEnabled && a.P2){
      const img2 = await loadCivIcon(a.P2);
      if(img2) ctx.drawImage(img2, x+205, y+112, 40, 40);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(a.P2, x+252, y+132);
    } else {
      ctx.fillStyle = "#0b1220";
      ctx.fillText(assignEnabled ? "—" : "(ver pool abaixo)", x+205, y+132);
    }
  }

  // ===== bloco de pool + snipes (sempre) =====
  const rows = Math.max(1, Math.ceil(order.length / cols));
  const cardsEndY = startY + rows * cardH + (rows - 1) * gapY;
  let baseY = cardsEndY + 55;

  const p1Pool = room.state.civs?.pickedBy?.P1 || [];
  const p2Pool = room.state.civs?.pickedBy?.P2 || [];
  const s1 = room.state.civs?.snipedBy?.P2 || []; // P1 perdeu
  const s2 = room.state.civs?.snipedBy?.P1 || []; // P2 perdeu

  // painel de fundo para dar destaque ao pool/snipes
  const panelX = 30;
  const panelY = baseY - 34;
  const panelW = canvas.width - 60;
  const panelH = canvas.height - panelY - 30;
  ctx.fillStyle = "rgba(11,18,32,.04)";
  roundRect(ctx, panelX, panelY, panelW, panelH, 18);
  ctx.fill();

  ctx.fillStyle = "rgba(11,18,32,.90)";
  ctx.font = "bold 20px system-ui";
  ctx.fillText(assignEnabled ? "Pool final" : "Sem ASSIGN por mapa — pool final", 40, baseY);

  baseY += 28;
  baseY = await drawCivRow("P1", p1Pool, 40, baseY, canvas.width - 80);
  baseY = await drawCivRow("P2", p2Pool, 40, baseY, canvas.width - 80);

  ctx.fillStyle = "rgba(11,18,32,.90)";
  ctx.font = "bold 20px system-ui";
  ctx.fillText("Snipes", 40, baseY);
  baseY += 28;
  baseY = await drawCivRow("P1 perdeu", s1, 40, baseY, canvas.width - 80);
  baseY = await drawCivRow("P2 perdeu", s2, 40, baseY, canvas.width - 80);

  // show image
  const dataUrl = canvas.toDataURL("image/png");
  $("summaryImg").src = dataUrl;

  // envia para o servidor (para o painel admin), apenas 1x por sala
  if(!window.__summarySent){
    window.__summarySent = true;
    fetch(`/api/rooms/${ROOM_ID}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl })
    }).catch(()=>{});
  }

  $("downloadSummary").onclick = () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `LBI_RESUMO_${room.id}.png`;
    a.click();
  };
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function render(room){
  ROOM = room;

  // após conectar, some com a caixa de entrada
  const joinBox = document.getElementById("joinBox");
  if(joinBox) joinBox.classList.add("hidden");

  setText("hdrId", room.id);
  setText("hdrSeries", room.config.series);
  // room.html tem este campo; observer.html não
  setText("rid", room.id);
  setText("hdrStep", (room.state.confirm?.needed && room.state.confirm.reason==="MAP_TO_CIV") ? "MAPAS DEFINIDOS" : stepText(currentStep(room)));

  const p1Name = room.state.players?.P1?.name?.trim() ? room.state.players.P1.name.trim() : "Jogador #1";
  const p2Name = room.state.players?.P2?.name?.trim() ? room.state.players.P2.name.trim() : "Jogador #2";
  if($("who")){
    if(MY_ROLE === "OBS"){
      $("who").innerHTML = `<span class="dot"></span> Você está como <strong>OBSERVER</strong>`;
    } else {
      $("who").innerHTML = MY_ROLE === "P1"
        ? `<span class="dot green"></span> Você é o <strong>${p1Name}</strong>`
        : `<span class="dot amber"></span> Você é o <strong>${p2Name}</strong>`;
    }
  }

  if($("rP1")) $("rP1").textContent = room.state.ready.P1 ? `PRONTO (${p1Name})` : `AGUARDANDO (${p1Name})`;
  if($("rP2")) $("rP2").textContent = room.state.ready.P2 ? `PRONTO (${p2Name})` : `AGUARDANDO (${p2Name})`;

  // show ready box until started
  if($("readyBox") && $("draftBox")){
    if(MY_ROLE === "OBS"){
      // observer sempre vê a tela do draft (mesmo antes de começar)
      $("readyBox").classList.add("hidden");
      $("draftBox").classList.remove("hidden");
    } else if(!room.state.started){
      $("readyBox").classList.remove("hidden");
      $("draftBox").classList.add("hidden");
    } else {
      $("readyBox").classList.add("hidden");
      $("draftBox").classList.remove("hidden");
    }
  }

  // instruction
  let baseInstr = instructionText(room);
  if(room.state.confirm?.needed && room.state.confirm.reason==="MAP_TO_CIV"){
    baseInstr = "Mapas definidos. Clique OK (ambos) para iniciar a fase de civilizações.";
  }
  let timerSuffix = "";
  if(room.state?.timer?.endsAt && !room.state.confirm?.needed){
    const left = Math.max(0, Math.ceil((room.state.timer.endsAt - Date.now())/1000));
    timerSuffix = ` • ⏱ ${left}s`;
  }
  setText("instruction", baseInstr + timerSuffix);

  // confirm box
  if(room.state.confirm?.needed){
    showEl("confirmBox");

    // status de confirmação (mostra também o oponente)
    const ok = room.state.confirm.ok || {P1:false,P2:false};
    const youOk = ok[MY_ROLE] ? "OK" : "Aguardando";
    const oppRole = (MY_ROLE === "P1" ? "P2" : "P1");
    const oppOk = ok[oppRole] ? "OK" : "Aguardando";

    let msg = `Etapa concluída. Você: ${youOk} • Oponente: ${oppOk}`;
    if(room.state.confirm.reason === "MAP_TO_CIV"){
      const maps = (room.state.maps?.picked || []).join(", ");
      if(maps) msg = `Mapas definidos: ${maps}\nVocê: ${youOk} • Oponente: ${oppOk}`;
    }
    const ct = document.getElementById("confirmText");
    if(ct) ct.textContent = msg;
  } else {
    hideEl("confirmBox");
  }

// mini rows / boards
  const step = currentStep(room);
  const boardsBox = document.getElementById("boardsBox");

  const hideBoards =
    (step && (step.type === "ASSIGN" || step.type === "SUMMARY")) ||
    (room.state.confirm?.needed && room.state.confirm.reason === "MAP_TO_CIV");

  if(hideBoards){
    if(boardsBox) boardsBox.classList.add("hidden");
  } else {
    if(boardsBox) boardsBox.classList.remove("hidden");
    renderMiniRows(room);
  }

  // pool
  renderPool(room);

  // assign maps
  renderAssignMaps(room);

  // summary
  if(step && step.type === "SUMMARY"){
    // mostra apenas o resumo (sem boards/pool/assign)
    const poolPanel = document.querySelector(".poolPanel");
    if(poolPanel) poolPanel.classList.add("hidden");
    hideEl("assignMaps");
    hideEl("confirmBox");

    showEl("summaryBox");
    drawSummary(room);
  } else {
    const poolPanel = document.querySelector(".poolPanel");
    if(poolPanel) poolPanel.classList.remove("hidden");
    hideEl("summaryBox");
  }
}

// Join / Ready
$("join")?.addEventListener("click", () => {
  const id = $("roomId").value.trim().toUpperCase();
  const roleEl = $("role");
  const role = roleEl ? roleEl.value : "OBS";

  if(!id) return setStatus("Informe o ID.", false);

  ROOM_ID = id;
  MY_ROLE = role;

  socket.emit("join", { roomId: ROOM_ID, role: MY_ROLE });
  setStatus("Conectando…", true);
});

$("readyBtn")?.addEventListener("click", () => {
  if(!ROOM_ID) return;
  const name = $("playerName") ? $("playerName").value : "";
  socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "READY", name } });
});

$("confirmBtn")?.addEventListener("click", () => {
  if(!ROOM_ID) return;
  socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "CONFIRM" } });
});

socket.on("room:error", (e) => {
  setStatus(`Erro: ${e.error}`, false);
});

socket.on("draft:error", (e) => {
  setStatus(`Ação inválida: ${e.error}`, false);
});

socket.on("room:state", ({ room }) => {
  setStatus("Conectado ✅", true);

  // se chegou aqui e ainda não tem assign array, normal (server cria quando precisar)
  if(!room.state.assign?.byMap) room.state.assign = { byMap: [] };

  render(room);
});

// auto-fill querystring
(() => {
  const { id, role } = qs();
  if(id && $("roomId")) $("roomId").value = id;
  if((role === "P1" || role === "P2" || role === "OBS") && $("role")) $("role").value = role;
})();


// atualiza o contador de tempo localmente (sem esperar novo state)
setInterval(() => {
  if(!ROOM) return;
  if(ROOM.state?.confirm?.needed) return;
  if(!ROOM.state?.timer?.endsAt) return;
  const left = Math.max(0, Math.ceil((ROOM.state.timer.endsAt - Date.now())/1000));
  const baseInstr = instructionText(ROOM);
  if($("instruction")) $("instruction").textContent = baseInstr + ` • ⏱ ${left}s`;
}, 250);
