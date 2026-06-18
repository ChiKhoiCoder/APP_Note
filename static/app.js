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
function toast(msg, type=''){
  let container = document.querySelector('.toasts');
  if(!container){ container = document.createElement('div'); container.className='toasts'; document.body.appendChild(container); }
  const el = document.createElement('div'); el.className='toast '+(type||''); el.innerHTML = `<i class='fa fa-bell'></i><div style="flex:1">${msg}</div><div style="opacity:.7;margin-left:8px;cursor:pointer" onclick="this.parentElement.remove()">✕</div>`;
  container.appendChild(el);
  setTimeout(()=>{ el.remove() }, 6000);
}

// debounce helper
function debounce(fn,wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait) } }

function renderTasks(tasks){
  const list = document.getElementById('list'); list.innerHTML='';
  tasks.forEach(t=>{
    const el=document.createElement('div'); el.className='task';
    const left=document.createElement('div');
    left.innerHTML = `<div><input type=checkbox ${t.completed? 'checked':''} data-id='${t.id}' class='check'> <strong>${escapeHtml(t.title)}</strong></div><div class='meta'>${t.category||''} • ${t.created.slice(0,10)} ${t.deadline? '• due '+t.deadline.split('T')[0]:''}</div>`;
    const right=document.createElement('div'); right.className='right';
    const pri=document.createElement('div'); pri.className='badge '+(t.priority=='high'?'pri-high':t.priority=='low'?'pri-low':'pri-med'); pri.textContent = t.priority[0].toUpperCase()+t.priority.slice(1);
    const del=document.createElement('button'); del.textContent='Xóa'; del.className='btn'; del.onclick=async ()=>{ if(confirm('Xóa?')){ try{ const res = await api.del(t.id); if(res && res.ok) toast('Đã xóa', 'warn'); }catch(e){ toast('Xóa thất bại') } load(); } };
    const edit=document.createElement('button'); edit.textContent='Sửa'; edit.className='btn'; edit.onclick=async ()=>{ const n=prompt('Sửa tiêu đề', t.title); if(n) { try{ const f=new FormData(); f.append('title',n); await fetch(`/api/tasks/${t.id}`,{method:'PUT',body:f}); toast('Đã cập nhật', 'success'); }catch(e){ toast('Cập nhật thất bại') } load(); } };
    right.appendChild(pri); right.appendChild(edit); right.appendChild(del);
    el.appendChild(left); el.appendChild(right);
    list.appendChild(el);
  });
  qsa('.check').then(arr=>arr.forEach(cb=>cb.addEventListener('change',e=>{ api.toggle(e.target.dataset.id).then(()=>{ toast('Đã cập nhật trạng thái'); load(); }).catch(()=>{ toast('Cập nhật thất bại') }) }))); 
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
