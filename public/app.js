const socket = io();
const $ = (id) => document.getElementById(id);

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
  if(step.type === "ASSIGN") return "ASSIGN • CIV POR MAPA";
  if(step.type === "SUMMARY") return "RESUMO";
  return step.type;
}

function instructionText(room){
  const st = room.state;
  const step = room.config.flow[st.stepIndex];

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

  // helper to load image
  const loadImg = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  const maps = room.state.maps.picked;
  let slots = room.state.assign.byMap || [];
  // BO1 (ou séries sem ASSIGN): usa picks diretos como "atribuição" do único mapa
  if((!slots || slots.length === 0) && Array.isArray(room.state.maps?.picked) && room.state.maps.picked.length === 1){
    const c1 = room.state.civs?.pickedBy?.P1?.[0] || null;
    const c2 = room.state.civs?.pickedBy?.P2?.[0] || null;
    slots = [{ P1: c1, P2: c2 }];
  }

  // layout
  const startY = 170;
  const cardW = 420;
  const cardH = 180;
  const gapX = 30;
  const gapY = 25;

  const cols = 3;
  for(let i=0;i<maps.length;i++){
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
    const mapName = maps[i];
    const mapSlug = slugify(mapName);
    const mapTry = [`imgs/maps/${mapSlug}.jpg`, `imgs/${mapSlug}.jpg`];
    let mapImg = await loadImg(mapTry[0]);
    if(!mapImg) mapImg = await loadImg(mapTry[1]);

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

    // assignments
    const a = slots[i] || {P1:null,P2:null};

    // P1 civ (com ícone)
    ctx.font = "bold 16px system-ui";
    ctx.fillStyle = "#0b7a3e";
    ctx.fillText("P1:", x+160, y+85);

    const p1Name = a.P1 || "—";
    if(a.P1){
      const civSlug = slugify(a.P1);
      const civTry = [`imgs/civs/${civSlug}.jpg`, `imgs/${civSlug}.jpg`];
      let civImg = await loadImg(civTry[0]);
      if(!civImg) civImg = await loadImg(civTry[1]);
      if(civImg) ctx.drawImage(civImg, x+205, y+65, 34, 34);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(p1Name, x+245, y+85);
    } else {
      ctx.fillStyle = "#0b1220";
      ctx.fillText(p1Name, x+205, y+85);
    }

    // P2 civ (com ícone)
    ctx.fillStyle = "#a56a00";
    ctx.fillText("P2:", x+160, y+120);

    const p2Name = a.P2 || "—";
    if(a.P2){
      const civSlug2 = slugify(a.P2);
      const civTry2 = [`imgs/civs/${civSlug2}.jpg`, `imgs/${civSlug2}.jpg`];
      let civImg2 = await loadImg(civTry2[0]);
      if(!civImg2) civImg2 = await loadImg(civTry2[1]);
      if(civImg2) ctx.drawImage(civImg2, x+205, y+100, 34, 34);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(p2Name, x+245, y+120);
    } else {
      ctx.fillStyle = "#0b1220";
      ctx.fillText(p2Name, x+205, y+120);
    }
  }

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

  $("hdrId").textContent = room.id;
  $("hdrSeries").textContent = room.config.series;

  $("rid").textContent = room.id;
  $("hdrStep").textContent = (room.state.confirm?.needed && room.state.confirm.reason==="MAP_TO_CIV") ? "MAPAS DEFINIDOS" : stepText(currentStep(room));

  $("who").innerHTML = MY_ROLE === "P1"
    ? `<span class="dot green"></span> Você é o <strong>JOGADOR #1</strong>`
    : `<span class="dot amber"></span> Você é o <strong>JOGADOR #2</strong>`;

  $("rP1").textContent = room.state.ready.P1 ? "PRONTO" : "AGUARDANDO";
  $("rP2").textContent = room.state.ready.P2 ? "PRONTO" : "AGUARDANDO";

  // show ready box until started
  if(!room.state.started){
    $("readyBox").classList.remove("hidden");
    $("draftBox").classList.add("hidden");
  } else {
    $("readyBox").classList.add("hidden");
    $("draftBox").classList.remove("hidden");
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
  $("instruction").textContent = baseInstr + timerSuffix;

  // confirm box
  if(room.state.confirm?.needed){
    $("confirmBox").classList.remove("hidden");

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
    $("confirmBox").classList.add("hidden");
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
    $("assignMaps").classList.add("hidden");
    $("confirmBox").classList.add("hidden");

    $("summaryBox").classList.remove("hidden");
    drawSummary(room);
  } else {
    const poolPanel = document.querySelector(".poolPanel");
    if(poolPanel) poolPanel.classList.remove("hidden");
    $("summaryBox").classList.add("hidden");
  }
}

// Join / Ready
$("join").addEventListener("click", () => {
  const id = $("roomId").value.trim().toUpperCase();
  const role = $("role").value;

  if(!id) return setStatus("Informe o ID.", false);

  ROOM_ID = id;
  MY_ROLE = role;

  socket.emit("join", { roomId: ROOM_ID, role: MY_ROLE });
  setStatus("Conectando…", true);
});

$("readyBtn").addEventListener("click", () => {
  if(!ROOM_ID) return;
  socket.emit("draft:action", { roomId: ROOM_ID, action: { by: MY_ROLE, kind: "READY" } });
});

$("confirmBtn").addEventListener("click", () => {
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
  if(id) $("roomId").value = id;
  if(role === "P1" || role === "P2") $("role").value = role;
})();


// atualiza o contador de tempo localmente (sem esperar novo state)
setInterval(() => {
  if(!ROOM) return;
  if(ROOM.state?.confirm?.needed) return;
  if(!ROOM.state?.timer?.endsAt) return;
  const left = Math.max(0, Math.ceil((ROOM.state.timer.endsAt - Date.now())/1000));
  const baseInstr = instructionText(ROOM);
  $("instruction").textContent = baseInstr + ` • ⏱ ${left}s`;
}, 250);
