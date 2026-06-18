// Lightweight auth helper + toasts for login/register pages
function showToast(msg, type=''){
  let c = document.querySelector('.toasts');
  if(!c){ c = document.createElement('div'); c.className='toasts'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className = 'toast '+(type||''); t.innerHTML = `<i class="fa fa-info-circle"></i><div style="flex:1;margin-left:8px">${msg}</div><div style="cursor:pointer;margin-left:8px" onclick="this.parentElement.remove()">✕</div>`;
  c.appendChild(t); setTimeout(()=>t.remove(),5000);
}

async function doLogin(form){
  const u = form.username.value?.trim(); const p = form.password.value || '';
  if(!u || !p){ showToast('Vui lòng nhập tên và mật khẩu', 'warn'); return }
  form.querySelector('button[type=submit]').disabled = true;
  try{
    const res = await fetch('/api/login',{method:'POST',body:new FormData(form)});
    if(res.ok){ window.location = '/'; }
    else{
      let j=null; try{ j=await res.json() }catch(e){}
      showToast((j && j.error) ? j.error : 'Đăng nhập thất bại', 'warn');
    }
  }catch(e){ showToast('Lỗi mạng', 'warn') }
  finally{ form.querySelector('button[type=submit]').disabled = false }
}

function passwordStrength(p){
  if(p.length < 8) return {ok:false, msg:'Mật khẩu ít nhất 8 ký tự'};
  if(!/[A-Z]/.test(p)) return {ok:false, msg:'Cần ít nhất 1 chữ hoa'};
  if(!/[0-9]/.test(p)) return {ok:false, msg:'Cần ít nhất 1 chữ số'};
  return {ok:true}
}

async function doRegister(form){
  const u = form.username.value?.trim(); const p = form.password.value || ''; const p2 = form.password2 ? form.password2.value : '';
  if(!u || !p){ showToast('Vui lòng nhập tên và mật khẩu', 'warn'); return }
  if(p !== p2){ showToast('Mật khẩu không khớp', 'warn'); return }
  const chk = passwordStrength(p); if(!chk.ok){ showToast(chk.msg, 'warn'); return }
  form.querySelector('button[type=submit]').disabled = true;
  try{
    const res = await fetch('/api/register',{method:'POST',body:new FormData(form)});
    if(res.ok){ window.location = '/'; }
    else{ let j=null; try{ j=await res.json() }catch(e){}; showToast((j && j.error) ? j.error : 'Đăng ký thất bại', 'warn'); }
  }catch(e){ showToast('Lỗi mạng', 'warn') }
  finally{ form.querySelector('button[type=submit]').disabled = false }
}

// attach handlers if forms exist
document.addEventListener('DOMContentLoaded',()=>{
  const lf = document.querySelector('form[data-auth="login"]'); if(lf) lf.addEventListener('submit',e=>{ e.preventDefault(); doLogin(lf) });
  const rf = document.querySelector('form[data-auth="register"]'); if(rf) rf.addEventListener('submit',e=>{ e.preventDefault(); doRegister(rf) });
});
