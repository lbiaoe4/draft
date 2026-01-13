const $ = (id) => document.getElementById(id);

function formatCreatedAt(v){
  if(!v) return "";
  if(typeof v === "string") return v.replace("T"," ").replace("Z","");
  try{
    return new Date(v).toLocaleString();
  }catch(e){
    return String(v);
  }
}

function fmtStep(r){
  if(!r.started) return "Aguardando PRONTO";
  const t = r.stepType || "—";
  const i = (r.stepIndex ?? 0) + 1;
  const total = r.stepTotal || 0;
  return `${t} (${i}/${total})`;
}

function playerText(r){
  const p1 = r.seats?.P1 ? "P1 ✅" : "P1 —";
  const p2 = r.seats?.P2 ? "P2 ✅" : "P2 —";
  return `${p1} • ${p2}`;
}

function confirmText(r){
  if(!r.confirmNeeded) return "—";
  const p1 = r.confirmOk?.P1 ? "P1 OK" : "P1 …";
  const p2 = r.confirmOk?.P2 ? "P2 OK" : "P2 …";
  return `${p1} • ${p2}`;
}

function timerText(r){
  if(r.timerLeft === null || r.timerLeft === undefined) return "—";
  return `${r.timerLeft}s`;
}

function openRoom(id, role){
  const url = `/room.html?id=${encodeURIComponent(id)}&role=${encodeURIComponent(role)}`;
  window.open(url, "_blank", "noopener");
}

function render(list){
  const filter = ($("filter").value || "").trim().toUpperCase();
  const rows = $("rows");
  rows.innerHTML = "";

  const filtered = list.filter(r => !filter || (r.id || "").includes(filter));
  $("count").textContent = `${filtered.length} salas`;

  for(const r of filtered){
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.innerHTML = `<div class="mono"><b>${r.id}</b></div><div class="muted small">${formatCreatedAt(r.createdAt)}</div>`;
    tr.appendChild(tdId);

    const tdSeries = document.createElement("td");
    tdSeries.textContent = r.series || "—";
    tr.appendChild(tdSeries);

    const tdStep = document.createElement("td");
    tdStep.innerHTML = `<div>${fmtStep(r)}</div><div class="muted small">${r.started ? (r.completed?"Concluída":"Em andamento") : ""}</div>`;
    tr.appendChild(tdStep);

    const tdTimer = document.createElement("td");
    tdTimer.textContent = timerText(r);
    tr.appendChild(tdTimer);

    const tdPlayers = document.createElement("td");
    tdPlayers.textContent = playerText(r);
    tr.appendChild(tdPlayers);

    const tdConfirm = document.createElement("td");
    tdConfirm.textContent = confirmText(r);
    tr.appendChild(tdConfirm);

    const tdSum = document.createElement("td");
    if(r.summaryAvailable){
      tdSum.innerHTML = `<img class="thumb" src="/api/admin/rooms/${r.id}" data-id="${r.id}" alt="Resumo" />`;
      // imagem real é dataUrl, vamos buscar no endpoint detalhado ao clicar
      tdSum.innerHTML = `<span class="ok">✅</span> <span class="small">salvo</span>`;
    } else {
      tdSum.innerHTML = `<span class="muted">—</span>`;
    }
    tr.appendChild(tdSum);

    const tdAct = document.createElement("td");
    const div = document.createElement("div");
    div.className = "actions";
    const bObs = document.createElement("button");
    bObs.textContent = "Abrir OBS";
    bObs.onclick = () => openRoom(r.id, "OBS");
    div.appendChild(bObs);

    const bP1 = document.createElement("button");
    bP1.textContent = "Abrir P1";
    bP1.onclick = () => openRoom(r.id, "P1");
    div.appendChild(bP1);

    const bP2 = document.createElement("button");
    bP2.textContent = "Abrir P2";
    bP2.onclick = () => openRoom(r.id, "P2");
    div.appendChild(bP2);

    if(r.summaryAvailable){
      const bSum = document.createElement("button");
      bSum.className = "primary";
      bSum.textContent = "Ver resumo";
      bSum.onclick = () => {
        const url = "/admin-summary.html?id=" + encodeURIComponent(r.id);
        window.open(url, "_blank", "noopener");
      };
      div.appendChild(bSum);
    }

    tdAct.appendChild(div);
    tr.appendChild(tdAct);

    rows.appendChild(tr);
  }
}

async function load(){
  const resp = await fetch("/api/admin/rooms");
  const data = await resp.json();
  const list = data.rooms || [];
  render(list);
  $("last").textContent = "Atualizado: " + new Date().toLocaleTimeString();
}

$("refresh").onclick = load;
$("filter").addEventListener("input", () => load());

load();
setInterval(load, 2000);
