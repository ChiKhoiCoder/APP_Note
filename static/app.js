async function qs(sel){return document.querySelector(sel)}
async function qsa(sel){return Array.from(document.querySelectorAll(sel))}

const api = {
  getTasks: (q,status,priority)=> fetch(`/api/tasks?q=${encodeURIComponent(q||"")}&status=${status||""}&priority=${priority||""}`).then(r=>r.json()),
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
  const list = document.getElementById('list'); list.innerHTML='';
  tasks.forEach(t=>{
    const el=document.createElement('div'); el.className='task'; el.draggable = true; el.dataset.id = t.id;
    const handle = document.createElement('span'); handle.className='drag-handle'; handle.innerHTML='☰'; handle.style.marginRight='8px';
    const left=document.createElement('div');
    left.innerHTML = `<div><input type=checkbox ${t.completed? 'checked':''} data-id='${t.id}' class='check'> <strong>${escapeHtml(t.title)}</strong></div><div class='meta'>${t.category||''} • ${t.created.slice(0,10)} ${t.deadline? '• due '+t.deadline.split('T')[0]:''}</div>`;
    const right=document.createElement('div'); right.className='right';
    const pri=document.createElement('div'); pri.className='badge '+(t.priority=='high'?'pri-high':t.priority=='low'?'pri-low':'pri-med'); pri.textContent = t.priority[0].toUpperCase()+t.priority.slice(1);
    const del=document.createElement('button'); del.textContent='Xóa'; del.className='btn'; del.onclick=async ()=>{
      if(!confirm('Xóa?')) return;
      // save last deleted for undo
      try{ localStorage.setItem('lastDeleted', JSON.stringify(t)); }catch(e){}
      try{
        const res = await api.del(t.id);
        if(res && res.ok){
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
      load();
    };
    const edit=document.createElement('button'); edit.textContent='Sửa'; edit.className='btn'; edit.onclick=async ()=>{ const n=prompt('Sửa tiêu đề', t.title); if(n) { try{ const f=new FormData(); f.append('title',n); await fetch(`/api/tasks/${t.id}`,{method:'PUT',body:f}); toast('Đã cập nhật', 'success'); }catch(e){ toast('Cập nhật thất bại') } load(); } };
    right.appendChild(pri); right.appendChild(edit); right.appendChild(del);
    left.prepend(handle);
    el.appendChild(left); el.appendChild(right);
    list.appendChild(el);
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

async function load(){
  const q=document.getElementById('search').value;
  const status=document.getElementById('filter').value;
  const priority=document.getElementById('priority').value;
  const data=await api.getTasks(q,status,priority);
  renderTasks(data.tasks);
  const st = await api.stats();
  document.getElementById('stat').textContent = `${st.total} việc — ${st.completed} xong — ${st.percent}%`;
  document.getElementById('total').textContent = st.total;
  document.getElementById('done').textContent = st.completed;
  document.getElementById('percent').textContent = st.percent + '%';
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
  const debouncedLoad = debounce(load, 300);
  document.getElementById('search').addEventListener('input', debouncedLoad);
  document.getElementById('filter').addEventListener('change', load);
  document.getElementById('priority').addEventListener('change', load);
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
