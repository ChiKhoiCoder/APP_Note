async function qs(sel){return document.querySelector(sel)}
async function qsa(sel){return Array.from(document.querySelectorAll(sel))}

const api = {
  getTasks: (q,status,priority, tag)=> fetch(`/api/tasks?q=${encodeURIComponent(q||"")}&status=${status||""}&priority=${priority||""}&tag=${encodeURIComponent(tag||"")}`).then(r=>r.json()),
  create: (form)=> fetch('/api/tasks',{method:'POST',body: form}).then(r=>r.json()),
  toggle: id=> fetch(`/api/tasks/${id}/toggle`,{method:'POST'}).then(r=>r.json()),
  del: id=> fetch(`/api/tasks/${id}`,{method:'DELETE'}).then(r=>r.json()),
  stats: ()=> fetch('/api/stats').then(r=>r.json())
}

// Chart instance
let statsChart = null;

function ensureChartLib(){
  if(window.Chart) return Promise.resolve();
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/chart.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
}

// Toaster
// Toaster with optional action
function toast(msg, type='', actionText=null, actionCallback=null){
  let container = document.querySelector('.toasts');
  if(!container){ container = document.createElement('div'); container.className='toasts'; document.body.appendChild(container); }
  const el = document.createElement('div'); el.className='toast '+(type||'');
  const content = document.createElement('div'); content.style.flex='1'; content.textContent = msg;
  el.appendChild(document.createElement('i')).className='fa fa-bell';
  el.appendChild(content);
  if(actionText && typeof actionCallback === 'function'){
    const btn = document.createElement('button'); btn.className='btn'; btn.style.marginLeft='8px'; btn.textContent = actionText;
    btn.addEventListener('click', ()=>{ try{ actionCallback(); }catch(e){} el.remove(); });
    el.appendChild(btn);
  }
  const close = document.createElement('div'); close.style.opacity='.7'; close.style.marginLeft='8px'; close.style.cursor='pointer'; close.textContent='✕'; close.onclick = ()=> el.remove(); el.appendChild(close);
  container.appendChild(el);
  setTimeout(()=>{ try{ el.remove() }catch(e){} }, 7000);
  return el;
}

// debounce helper
function debounce(fn,wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait) } }

function renderTasks(tasks){
  const list = document.getElementById('list');
  // capture previous positions for FLIP
  const prevRects = {};
  list.querySelectorAll('.task').forEach(n=>{ try{ prevRects[n.dataset.id] = n.getBoundingClientRect(); }catch(e){} });
  list.innerHTML='';
  tasks.forEach(t=>{
    const el=document.createElement('div'); el.className='task'; el.draggable = true; el.dataset.id = t.id;
    const handle = document.createElement('span'); handle.className='drag-handle'; handle.innerHTML='☰'; handle.style.marginRight='8px';
    const left=document.createElement('div');
    const avatarHtml = t.assignee_avatar ? `<div class='avatar' title='${escapeHtml(t.assignee||'')}' style='width:36px;height:36px;border-radius:999px;overflow:hidden;display:flex;align-items:center;justify-content:center'><img src='${t.assignee_avatar}' alt='${escapeHtml(t.assignee||'')}'/></div>` : `<div class='avatar' title='${escapeHtml(t.assignee||'')}' style='width:36px;height:36px;border-radius:999px;background:linear-gradient(90deg,#7c5cff,#ff6b9a);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700'>${escapeHtml((t.assignee||'').split(' ').map(x=>x[0]).join('').slice(0,2) || t.title.slice(0,2))}</div>`;
    left.innerHTML = `<div style="display:flex;align-items:center;gap:8px">${avatarHtml}<input type=checkbox ${t.completed? 'checked':''} data-id='${t.id}' class='check'> <strong>${escapeHtml(t.title)}</strong></div><div class='meta'>${t.category||''} • ${t.created.slice(0,10)} ${t.deadline? '• due '+t.deadline.split('T')[0]:''}</div>`;
    const right=document.createElement('div'); right.className='right';
    const pri=document.createElement('div'); pri.className='badge '+(t.priority=='high'?'pri-high':t.priority=='low'?'pri-low':'pri-med'); pri.textContent = t.priority[0].toUpperCase()+t.priority.slice(1);
        const del=document.createElement('button'); del.textContent='Xóa'; del.className='btn'; del.onclick=async ()=>{
          if(!confirm('Xóa?')) return;
          try{ localStorage.setItem('lastDeleted', JSON.stringify(t)); }catch(e){}
          try{
            const res = await api.del(t.id);
            if(res && res.ok){
              // animate removal
              const elNode = document.querySelector('.task[data-id="'+t.id+'"]');
              if(elNode){ elNode.classList.add('leave'); setTimeout(()=> load(), 320); }
              else { load(); }
              toast('Đã xóa', 'warn', 'Hoàn tác', async ()=>{
                try{
                  const f = new FormData(); f.append('title', t.title); f.append('category', t.category||''); f.append('deadline', t.deadline||''); f.append('priority', t.priority||'medium');
                  const r = await api.create(f);
                  if(r && r.task) toast('Hoàn tác thành công', 'success');
                  load();
                }catch(e){ toast('Hoàn tác thất bại') }
              });
            } else { toast('Xóa thất bại') }
          }catch(e){ toast('Xóa thất bại') }
        };
    const edit=document.createElement('button'); edit.textContent='Sửa'; edit.className='btn'; edit.onclick=async ()=>{ const n=prompt('Sửa tiêu đề', t.title); if(n) { try{ const f=new FormData(); f.append('title',n); await fetch(`/api/tasks/${t.id}`,{method:'PUT',body:f}); toast('Đã cập nhật', 'success'); }catch(e){ toast('Cập nhật thất bại') } load(); } };
    right.appendChild(pri); right.appendChild(edit); right.appendChild(del);
    left.prepend(handle);
    el.appendChild(left); el.appendChild(right);
    el.classList.add('enter');
    list.appendChild(el);
    // FLIP - compute new rect and animate from old position
    try{
      const newRect = el.getBoundingClientRect();
      const oldRect = prevRects[el.dataset.id];
      if(oldRect){
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.transition = 'transform 0s';
        requestAnimationFrame(()=>{ el.style.transition = 'transform 260ms cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; });
      }
    }catch(e){}
    requestAnimationFrame(()=>{ el.classList.remove('enter'); });
  });
  qsa('.check').then(arr=>arr.forEach(cb=>cb.addEventListener('change',e=>{ api.toggle(e.target.dataset.id).then(()=>{ toast('Đã cập nhật trạng thái'); load(); }).catch(()=>{ toast('Cập nhật thất bại') }) })));

  // drag-drop handlers
  const draggables = Array.from(list.querySelectorAll('.task'));
  let dragSrc = null; let allowDrag = false;
  draggables.forEach(node=>{
    const h = node.querySelector('.drag-handle');
    if(h){ h.addEventListener('mousedown', ()=> allowDrag = true); h.addEventListener('mouseup', ()=> setTimeout(()=>allowDrag = false, 10)); }
    node.addEventListener('dragstart', e=>{ if(!allowDrag){ e.preventDefault(); return; } node.classList.add('dragging'); dragSrc = node; e.dataTransfer.effectAllowed='move'; });
    node.addEventListener('dragend', e=>{ node.classList.remove('dragging'); dragSrc = null; allowDrag=false; });
    node.addEventListener('dragover', e=>{ e.preventDefault(); const after = getDragAfterElement(list, e.clientY); if(after == null) list.appendChild(dragSrc); else list.insertBefore(dragSrc, after); });
  });
  function getDragAfterElement(container, y){
    const draggableElements = [...container.querySelectorAll('.task:not(.dragging)')];
    return draggableElements.reduce((closest, child)=>{
      const box = child.getBoundingClientRect(); const offset = y - box.top - box.height/2;
      if(offset < 0 && offset > closest.offset){ return {offset: offset, element: child}; } else return closest;
    }, {offset:-Infinity}).element || null;
  }
  // when order changes, send to server
  let reorderTimer; list.addEventListener('drop', ()=>{ clearTimeout(reorderTimer); reorderTimer = setTimeout(()=>{
    const ids = Array.from(list.querySelectorAll('.task')).map(n=>n.dataset.id);
    fetch('/api/tasks/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({order: ids})}).then(r=>r.json()).then(j=>{ if(j.ok) toast('Sắp xếp lưu'); else toast('Không lưu được'); }).catch(()=>toast('Lỗi lưu sắp xếp'))
  }, 250); });
}

function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

// --- Board rendering ---
function renderBoard(tasks){
  const board = document.getElementById('board'); if(!board) return;
  // capture previous card positions for FLIP animation
  const prevRects = {};
  board.querySelectorAll('.card').forEach(n=>{ try{ prevRects[n.dataset.id] = n.getBoundingClientRect(); }catch(e){} });
  board.innerHTML = '';
  // Use fixed status columns: todo, doing, done
  const statusCols = [ {key:'todo', title:'To Do'}, {key:'doing', title:'Doing'}, {key:'done', title:'Done'} ];
  statusCols.forEach(colDef=>{
    const column = document.createElement('div'); column.className = 'column'; column.dataset.status = colDef.key;
    const header = document.createElement('div'); header.className = 'col-header'; header.innerHTML = `<div class='col-title'>${escapeHtml(colDef.title)}</div><div class='col-count'>0</div>`;
    const list = document.createElement('div'); list.className = 'col-list';
    column.appendChild(header); column.appendChild(list); board.appendChild(column);
    column.addEventListener('dragover', e=>{ e.preventDefault(); column.classList.add('drag-over'); });
    column.addEventListener('dragleave', e=>{ column.classList.remove('drag-over'); });
    column.addEventListener('drop', async e=>{
      e.preventDefault(); column.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain'); if(!id) return;
      try{
        const f = new FormData(); f.append('status', colDef.key);
        await fetch(`/api/tasks/${id}`, { method: 'PUT', body: f });
        toast('Di chuyển sang '+colDef.title, 'success');
        await load();
      }catch(err){ toast('Không thể di chuyển', 'warn') }
    });
  });
  // populate cards into status columns
  tasks.forEach(t=>{
    const status = t.status || 'todo';
    const column = board.querySelector(`.column[data-status="${CSS.escape(status)}"]`);
    if(!column) return;
    const list = column.querySelector('.col-list');
    const card = document.createElement('div'); card.className = 'card'; card.draggable = true; card.dataset.id = t.id;
    const imgHtml = `<div class='card-img'>${t.image ? `<img src='${t.image}' style='width:100%;height:100%;object-fit:cover'/>` : ''}</div>`;
    const assignee = escapeHtml(t.assignee || '');
    const assigneeHtml = t.assignee_avatar ? `<div class='avatar' title='${assignee}' style='overflow:hidden;width:40px;height:40px;border-radius:999px'><img src='${t.assignee_avatar}' alt='${assignee}'/></div>` : `<div class='avatar' title='${assignee}' style='background:linear-gradient(90deg,#7c5cff,#ff6b9a)'>${escapeHtml((assignee||t.title).split(' ').map(x=>x[0]||'').join('').slice(0,2))}</div>`;
    card.innerHTML = `<div class='card-top'><div><div class='card-title'>${escapeHtml(t.title)}</div><div class='card-meta'>${t.deadline? '<i class="fa fa-calendar"></i> '+escapeHtml(t.deadline.split('T')[0]) : ''}</div>${imgHtml}<div class='progress'><i style='width:${Math.min(100, (t.completed?100: Math.floor(Math.random()*60)+20))}%'></i></div></div><div style='text-align:right'>${assigneeHtml}<div style='margin-top:8px' class='badges'><div class='tag'>${escapeHtml((t.tags||'').split(',').slice(0,2).join(', '))}</div></div></div></div><div class='card-footer'><div style='font-size:12px;color:#94a3b8'>${escapeHtml(t.category||'')}</div><div style='display:flex;gap:8px'><button class='btn small' title='Comment'><i class='fa fa-comment'></i></button><button class='btn small' title='More'><i class='fa fa-ellipsis-h'></i></button></div></div>`;
    list.appendChild(card);
    // FLIP: animate from previous position if present
    try{
      const newRect = card.getBoundingClientRect();
      const oldRect = prevRects[card.dataset.id];
      if(oldRect){
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        card.style.transition = 'transform 0s';
        requestAnimationFrame(()=>{ card.style.transition = 'transform 280ms cubic-bezier(.2,.8,.2,1)'; card.style.transform = ''; });
      }
    }catch(e){}
    card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', t.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', e=>{ card.classList.remove('dragging'); });
    // comment and more button handlers
    const commentBtn = card.querySelector('button[title="Comment"]');
    const moreBtn = card.querySelector('button[title="More"]');
    if(commentBtn) commentBtn.addEventListener('click', ()=>{ const q = prompt('Gửi bình luận/ghi chú cho thẻ này:'); if(q){ fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({message: 'Comment for task '+t.id+': '+q})}).then(()=>toast('Ghi chú đã gửi','success')).catch(()=>toast('Không gửi được')) } });
    if(moreBtn) moreBtn.addEventListener('click', ()=>{ const action = prompt('Chọn: edit/delete'); if(!action) return; if(action==='delete'){ if(confirm('Xóa thẻ?')){ fetch(`/api/tasks/${t.id}`,{method:'DELETE'}).then(()=>{ toast('Đã xóa','warn'); load(); }).catch(()=>toast('Lỗi xóa')) } } else if(action==='edit'){ const n = prompt('Sửa tiêu đề', t.title); if(n && n!==t.title){ const f = new FormData(); f.append('title', n); fetch(`/api/tasks/${t.id}`,{method:'PUT', body: f}).then(()=>{ toast('Đã cập nhật','success'); load(); }).catch(()=>toast('Lỗi cập nhật')) } } else { toast('Tùy chọn không hợp lệ') } });
    card.addEventListener('dblclick', async ()=>{
      const n = prompt('Sửa tiêu đề', t.title); if(n && n !== t.title){ const f = new FormData(); f.append('title', n); try{ await fetch(`/api/tasks/${t.id}`, {method:'PUT', body: f}); toast('Đã cập nhật', 'success'); load(); }catch(e){ toast('Cập nhật thất bại') } }
    });
  });
  // update counts
  board.querySelectorAll('.column').forEach(col=>{ const cnt = col.querySelectorAll('.card').length; const badge = col.querySelector('.col-count'); if(badge) badge.textContent = cnt; });
}

// toggle view
function setView(v){ const listMain = document.querySelector('main'); const boardView = document.getElementById('board-view'); const btn = document.getElementById('view-toggle'); if(v==='board'){ if(listMain) listMain.style.display='none'; if(boardView) boardView.style.display='block'; if(btn) btn.textContent='List'; localStorage.setItem('view','board'); } else { if(listMain) listMain.style.display='grid'; if(boardView) boardView.style.display='none'; if(btn) btn.textContent='Board'; localStorage.setItem('view','list'); } }

document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('view-toggle');
  if(btn){ btn.addEventListener('click', ()=>{ const cur = localStorage.getItem('view') || 'list'; setView(cur==='list'?'board':'list'); });
  }
  // global brand add/search handlers
  const brandAdd = document.querySelector('.brand-top .btn');
  if(brandAdd){ brandAdd.addEventListener('click', ()=>{ setView('list'); const t = document.querySelector('#addForm input[name=title]'); if(t){ t.focus(); t.select(); } }); }
  const globalSearch = document.getElementById('global-search');
  if(globalSearch){ globalSearch.addEventListener('input', debounce((e)=>{ const v = e.target.value||''; const s = document.getElementById('search'); if(s){ s.value = v; load(); } }, 250)); }
  // sidebar filter buttons
  document.querySelectorAll('.side-item').forEach(b=> b.addEventListener('click', ()=>{
    document.querySelectorAll('.side-item').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    // set filter select to this item's filter and reload
    const f = b.dataset.filter || '';
    const sel = document.getElementById('filter'); if(sel) sel.value = f || '';
    load();
  }));
  // left navigation quick actions
  document.querySelectorAll('.left-nav button').forEach((btn, idx)=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.left-nav button').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      // simple mapping: 0 dashboard -> board, 1 tasks -> list, 2 calendar -> filter by deadline, 3 reports -> open stats, 4 settings -> toast
      if(idx===0) { setView('board'); toast('Dashboard'); }
      else if(idx===1) { setView('list'); load(); }
      else if(idx===2) { setView('list'); document.getElementById('filter').value=''; toast('Calendar view (filter by date)'); }
      else if(idx===3) { setView('list'); toast('Bật Thống kê'); document.getElementById('statsChart') && window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else { toast('Cài đặt'); }
    });
  });
  // make stats widgets clickable to filter
  const totalEl = document.getElementById('total'); const doneEl = document.getElementById('done'); const pctEl = document.getElementById('percent'); const statArea = document.getElementById('stat');
  if(totalEl){ totalEl.style.cursor='pointer'; totalEl.addEventListener('click', ()=>{ document.getElementById('filter').value=''; setView('list'); load(); }); }
  if(doneEl){ doneEl.style.cursor='pointer'; doneEl.addEventListener('click', ()=>{ document.getElementById('filter').value='done'; setView('list'); load(); }); }
  if(pctEl){ pctEl.style.cursor='pointer'; pctEl.addEventListener('click', ()=>{ document.getElementById('filter').value='todo'; setView('list'); load(); }); }
  if(statArea){ statArea.style.cursor='pointer'; statArea.addEventListener('click', ()=>{ setView('board'); }); }
});

async function load(){
  const q=document.getElementById('search').value;
  const status=document.getElementById('filter').value;
  const priority=document.getElementById('priority').value;
  const tag = document.getElementById('filter-tag') ? document.getElementById('filter-tag').value.trim() : '';
  const data=await api.getTasks(q,status,priority, tag);
  const view = localStorage.getItem('view') || 'list';
  if(view === 'board'){
    setView('board');
    renderBoard(data.tasks);
  } else {
    setView('list');
    renderTasks(data.tasks);
  }
  const st = await api.stats();
  // basic stat summary
  document.getElementById('stat').textContent = `${st.total} việc — ${st.completed} xong — ${st.percent}%`;
  document.getElementById('total').textContent = st.total;
  document.getElementById('done').textContent = st.completed;
  document.getElementById('percent').textContent = st.percent + '%';
  // fetch extended stats for charts (trend + breakdown)
  try{
    const full = await fetch('/api/stats/full?days=14').then(r=>r.json());
    const trend = full.trend || [];
    const labels = trend.map(t=> t.date.slice(5));
    const created = trend.map(t=> t.created);
    const completed = trend.map(t=> t.completed);
    // render small line chart for trend
    await ensureChartLib();
    const trendCanvas = document.getElementById('trendChart');
    if(trendCanvas){
      if(window.trendChart) { window.trendChart.data.labels = labels; window.trendChart.data.datasets[0].data = created; window.trendChart.data.datasets[1].data = completed; window.trendChart.update(); }
      else{ window.trendChart = new Chart(trendCanvas.getContext('2d'), { type: 'line', data: { labels, datasets: [ { label: 'Tạo', data: created, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)', tension:0.35 }, { label: 'Hoàn thành', data: completed, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.06)', tension:0.35 } ] }, options:{plugins:{legend:{display:true,position:'bottom'}}, scales:{x:{display:true}, y:{display:true}} } }); }
    }
  }catch(e){ console.warn('full stats failed', e) }
  // update chart
  try{
    await ensureChartLib();
    const ctx = document.getElementById('statsChart').getContext('2d');
    const done = st.completed || 0; const todo = Math.max(0, (st.total||0) - done);
    const data = { labels: ['Hoàn thành','Chưa xong'], datasets:[{data:[done,todo], backgroundColor:['#10b981','#6366f1']}] };
    if(statsChart){ statsChart.data = data; statsChart.update(); }
    else{ statsChart = new Chart(ctx, {type:'doughnut', data, options:{cutout:'60%', plugins:{legend:{position:'bottom'}}}}) }
  }catch(e){ console.warn('chart failed',e) }
  // reminders from server
  try{
    const rems = await fetch(`/api/reminders?within_days=1`).then(r=>r.json());
    const rem = document.getElementById('rem'); rem.innerHTML='';
    const quick = document.getElementById('quick-rem'); quick.innerHTML='';
    if(rems.reminders && rems.reminders.length){
      const ul = document.createElement('div'); ul.className='alert';
      ul.innerHTML = '<strong>Cảnh báo:</strong> có công việc gần hạn:' + '<ul style="margin:8px 0">' + rems.reminders.map(x=>`<li>${escapeHtml(x.title)} — ${x.deadline.split('T')[0]}</li>`).join('') + '</ul>';
      rem.appendChild(ul);
      quick.innerHTML = '<ul style="margin:6px 0">' + rems.reminders.slice(0,3).map(x=>`<li>${escapeHtml(x.title)} — ${x.deadline.split('T')[0]}</li>`).join('') + '</ul>';

      // Desktop notifications (deduped via localStorage)
      try{
        const key = 'seenReminders_v1';
        let seen = [];
        try{ seen = JSON.parse(localStorage.getItem(key) || '[]') }catch(e){ seen = [] }
        const enable = document.getElementById('enable-noti') && document.getElementById('enable-noti').checked;
        if(enable){
          if(Notification.permission !== 'granted'){
            Notification.requestPermission();
          }
        }
        if(enable && Notification.permission === 'granted'){
          const unseen = rems.reminders.filter(r=> !seen.includes(r.id));
          unseen.slice(0,5).forEach(r=>{
            const n = new Notification('Nhắc việc: '+ r.title, { body: 'Hạn: ' + (r.deadline||''), tag: r.id });
            playBeep();
            seen.push(r.id);
          });
          try{ localStorage.setItem(key, JSON.stringify(seen)) }catch(e){}
        }
      }catch(e){ console.warn('notifications failed', e) }
    }
  }catch(e){console.warn('reminders failed',e)}
}

// poll reminders every 60s
setInterval(()=>{ if(document.visibilityState==='visible') load() }, 60*1000);

function daysUntil(iso){ try{ const d=new Date(iso); const diff=(d - new Date())/ (1000*60*60*24); return diff; }catch(e){return 999} }

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('addForm').addEventListener('submit',async e=>{
    e.preventDefault(); const f=new FormData(e.target); try{ const res = await api.create(f); if(res && res.task) toast('Đã thêm: ' + (res.task.title||'item'), 'success'); else toast('Không thêm được'); }catch(e){ toast('Lỗi khi thêm','warn') } e.target.reset(); load();
  });
  // assignee avatar upload
  const uploadBtn = document.getElementById('upload-avatar');
  if(uploadBtn){
    uploadBtn.addEventListener('click', async ()=>{
      const nameInput = document.getElementById('assignee-name');
      const fileInput = document.getElementById('assignee-file');
      if(!nameInput || !fileInput) return toast('Chưa nhập tên hoặc chưa chọn file', 'warn');
      const name = nameInput.value.trim(); if(!name) return toast('Nhập tên người phụ trách trước', 'warn');
      const file = fileInput.files && fileInput.files[0]; if(!file) return toast('Chưa chọn file', 'warn');
      const fd = new FormData(); fd.append('name', name); fd.append('file', file, file.name);
      try{
        const res = await fetch('/api/assignees/avatar', { method: 'POST', body: fd });
        const j = await res.json(); if(res.ok && j.url){ toast('Avatar đã tải lên', 'success'); fileInput.value = null; load(); }
        else toast('Không thể tải avatar', 'warn');
      }catch(e){ console.error(e); toast('Lỗi khi tải avatar', 'warn') }
    });
  }
  const debouncedLoad = debounce(load, 300);
  document.getElementById('search').addEventListener('input', debouncedLoad);
  document.getElementById('filter').addEventListener('change', load);
  document.getElementById('priority').addEventListener('change', load);
  const tagFilter = document.getElementById('filter-tag'); if(tagFilter){ tagFilter.addEventListener('input', debounce(load, 300)); }
  const exportBtn = document.getElementById('export-csv'); if(exportBtn){ exportBtn.addEventListener('click', async ()=>{
    try{
      const res = await fetch('/api/tasks/export');
      if(!res.ok) return toast('Không thể xuất CSV');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'tasks_export.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Đã tải CSV');
    }catch(e){ toast('Lỗi khi tải CSV') }
  }); }
  // select-all checkbox for bulk actions
  const selAll = document.getElementById('select-all');
  if(selAll){ selAll.addEventListener('change', ()=>{
    qsa('.check').then(arr=>arr.forEach(cb=>cb.checked = selAll.checked));
  }); }
  const completeBtn = document.getElementById('complete-selected');
  const deleteBtn = document.getElementById('delete-selected');
  if(completeBtn){ completeBtn.addEventListener('click', async ()=>{
    const boxes = await qsa('.check'); const ids = boxes.filter(b=>b.checked).map(b=>b.dataset.id);
    if(!ids.length) return toast('Chưa chọn mục nào');
    for(const id of ids){ try{ await api.toggle(id); }catch(e){} }
    toast('Đã cập nhật trạng thái cho các mục'); load();
  }); }
  if(deleteBtn){ deleteBtn.addEventListener('click', async ()=>{
    const boxes = await qsa('.check'); const ids = boxes.filter(b=>b.checked).map(b=>b.dataset.id);
    if(!ids.length) return toast('Chưa chọn mục nào');
    if(!confirm(`Xóa ${ids.length} mục?`)) return;
    for(const id of ids){ try{ await api.del(id); }catch(e){} }
    toast('Đã xóa các mục đã chọn', 'warn'); load();
  }); }

  // keyboard shortcuts: 'n' focuses new task title
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey){
      const t = document.querySelector('#addForm input[name=title]'); if(t){ t.focus(); t.select(); e.preventDefault(); }
    }
  });
  load();
});

// add 5 sample tasks helper
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('add-samples');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    const samples = [
      {title: 'Review PR #42', category: 'Work', deadline: new Date(Date.now()+2*24*60*60*1000).toISOString().slice(0,10), priority: 'high', tags: 'sample,work'},
      {title: 'Prepare slides cho họp', category: 'Work', deadline: new Date(Date.now()+3*24*60*60*1000).toISOString().slice(0,10), priority: 'medium', tags: 'sample,presentation'},
      {title: 'Mua sắm đồ dùng', category: 'Personal', deadline: '', priority: 'low', tags: 'sample,personal'},
      {title: 'Hoàn thiện báo cáo', category: 'Work', deadline: new Date(Date.now()+1*24*60*60*1000).toISOString().slice(0,10), priority: 'high', tags: 'sample,urgent'},
      {title: 'Gọi điện cho khách hàng', category: 'Sales', deadline: new Date(Date.now()+4*24*60*60*1000).toISOString().slice(0,10), priority: 'medium', tags: 'sample,call'}
    ];
    btn.disabled = true; btn.textContent = 'Đang thêm...';
    try{
      for(const s of samples){
        const f = new FormData(); f.append('title', s.title); f.append('category', s.category); f.append('deadline', s.deadline); f.append('priority', s.priority); f.append('tags', s.tags);
        try{ await api.create(f); }catch(e){ console.warn('sample create failed', e) }
        await new Promise(r=>setTimeout(r,120));
      }
      toast('Đã thêm 5 mẫu', 'success');
      load();
    }catch(e){ toast('Không thể thêm mẫu') }
    btn.disabled = false; btn.textContent = 'Thêm 5 mẫu';
  });
});

// beep using WebAudio
function playBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); try{ ctx.close() }catch(e){} }, 180);
  }catch(e){/* ignore */}
}

// Initialize notification toggle from localStorage
try{
  document.addEventListener('DOMContentLoaded',()=>{
    const cb = document.getElementById('enable-noti');
    if(!cb) return;
    const val = localStorage.getItem('enable-noti');
    cb.checked = val === '1';
    cb.addEventListener('change', async ()=>{
      localStorage.setItem('enable-noti', cb.checked ? '1' : '0');
      if(cb.checked && Notification.permission !== 'granted'){
        await Notification.requestPermission();
      }
    });
  });
}catch(e){}
