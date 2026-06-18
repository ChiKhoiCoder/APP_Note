// Simple chat widget client
async function postChat(msg){
  try{
    const res = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({message: msg})});
    return await res.json();
  }catch(e){ return {error:'network'} }
}

function appendMsg(container, text, who='bot'){
  const el = document.createElement('div'); el.className = 'chat-msg '+(who==='user'?'user':'bot'); el.textContent = text; container.appendChild(el); container.scrollTop = container.scrollHeight;
}

document.addEventListener('DOMContentLoaded', ()=>{
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const body = document.getElementById('chat-body');
  const input = document.getElementById('chat-input-field');
  if(!toggle) return;
  toggle.addEventListener('click', async ()=>{ panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; input.focus(); if(panel.style.display==='block'){
      // load history
      try{
        const r = await fetch('/api/chat/history'); const j = await r.json(); if(j && j.messages){ body.innerHTML=''; j.messages.forEach(m=> appendMsg(body, m.content, m.role==='user'?'user':'bot')); body.scrollTop = body.scrollHeight; }
      }catch(e){ console.debug('no history') }
    } });
  document.getElementById('chat-form').addEventListener('submit', async e=>{
    e.preventDefault(); const txt = input.value.trim(); if(!txt) return; appendMsg(body, txt, 'user'); input.value='';
    const r = await postChat(txt);
    if(r && r.reply) appendMsg(body, r.reply, 'bot'); else appendMsg(body, 'Xin lỗi, có lỗi xảy ra', 'bot');
  });
});
