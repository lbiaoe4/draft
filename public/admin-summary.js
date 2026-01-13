(function(){
  const root = document.getElementById('root');
  const statusEl = document.getElementById('status');
  const titleEl = document.getElementById('title');
  const refreshBtn = document.getElementById('refresh');

  const params = new URLSearchParams(location.search);
  const id = (params.get('id') || '').trim().toUpperCase();
  if(!id){
    root.textContent = 'ID da sala não informado.';
    return;
  }
  titleEl.textContent = 'Resumo • ' + id;

  function esc(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function load(){
    statusEl.textContent = 'Carregando...';
    root.innerHTML = 'Carregando...';

    const resp = await fetch('/api/admin/rooms/' + encodeURIComponent(id));
    if(!resp.ok){
      statusEl.textContent = 'Erro ' + resp.status;
      root.textContent = 'Não foi possível carregar os dados.';
      return;
    }
    const data = await resp.json();

    const url =
      (data && data.full && data.full.state && data.full.state.summary && data.full.state.summary.dataUrl) ||
      (data && data.full && data.full.room && data.full.room.state && data.full.room.state.summary && data.full.room.state.summary.dataUrl) ||
      (data && data.room && data.room.state && data.room.state.summary && data.room.state.summary.dataUrl) ||
      null;

    if(!url){
      statusEl.textContent = 'Sem resumo salvo';
      root.innerHTML = '<div>Resumo ainda não foi salvo para esta sala.</div>';
      return;
    }

    statusEl.textContent = 'OK';
    root.innerHTML = '<img alt="Resumo ' + esc(id) + '" src="' + esc(url) + '" />';
  }

  refreshBtn.addEventListener('click', load);
  load();
})();
