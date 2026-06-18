async function qs(sel){return document.querySelector(sel)}
async function qsa(sel){return Array.from(document.querySelectorAll(sel))}

const api = {
  getTasks: (q,status,priority)=> fetch(`/api/tasks?q=${encodeURIComponent(q||"")}&status=${status||""}&priority=${priority||""}`).then(r=>r.json()),
  create: (form)=> fetch('/api/tasks',{method:'POST',body: form}).then(r=>r.json()),
  toggle: id=> fetch(`/api/tasks/${id}/toggle`,{method:'POST'}).then(r=>r.json()),
  del: id=> fetch(`/api/tasks/${id}`,{method:'DELETE'}).then(r=>r.json()),
  stats: ()=> fetch('/api/stats').then(r=>r.json())
}

function renderTasks(tasks){
  const list = document.getElementById('list'); list.innerHTML='';
  tasks.forEach(t=>{
    const el=document.createElement('div'); el.className='task';
    const left=document.createElement('div');
    left.innerHTML = `<div><input type=checkbox ${t.completed? 'checked':''} data-id='${t.id}' class='check'> <strong>${escapeHtml(t.title)}</strong></div><div class='meta'>${t.category||''} • ${t.created.slice(0,10)} ${t.deadline? '• due '+t.deadline.split('T')[0]:''}</div>`;
    const right=document.createElement('div'); right.className='right';
    const pri=document.createElement('div'); pri.className='badge '+(t.priority=='high'?'pri-high':t.priority=='low'?'pri-low':'pri-med'); pri.textContent = t.priority[0].toUpperCase()+t.priority.slice(1);
    const del=document.createElement('button'); del.textContent='Xóa'; del.className='btn'; del.onclick=()=>{ if(confirm('Xóa?')) api.del(t.id).then(load); };
    const edit=document.createElement('button'); edit.textContent='Sửa'; edit.className='btn'; edit.onclick=()=>{ const n=prompt('Sửa tiêu đề', t.title); if(n) { const f=new FormData(); f.append('title',n); fetch(`/api/tasks/${t.id}`,{method:'PUT',body:f}).then(()=>load()) } };
    right.appendChild(pri); right.appendChild(edit); right.appendChild(del);
    el.appendChild(left); el.appendChild(right);
    list.appendChild(el);
  });
  qsa('.check').then(arr=>arr.forEach(cb=>cb.addEventListener('change',e=>{api.toggle(e.target.dataset.id).then(load);}))); 
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
    }
  }catch(e){console.warn('reminders failed',e)}
}

// poll reminders every 60s
setInterval(()=>{ if(document.visibilityState==='visible') load() }, 60*1000);

function daysUntil(iso){ try{ const d=new Date(iso); const diff=(d - new Date())/ (1000*60*60*24); return diff; }catch(e){return 999} }

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('addForm').addEventListener('submit',async e=>{
    e.preventDefault(); const f=new FormData(e.target); await api.create(f); e.target.reset(); load();
  });
  document.getElementById('search').addEventListener('input', load);
  document.getElementById('filter').addEventListener('change', load);
  document.getElementById('priority').addEventListener('change', load);
  load();
});
