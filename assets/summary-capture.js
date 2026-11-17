(function(){
var params=new URLSearchParams(location.search),lesson=params.get('summary'),token=params.get('summary_token');
if(!lesson||!token||!window.BroadcastChannel)return;
window.KABINET.state.then(function(st){
 if(!st||st.role!=='teacher')return;
 var canvas=document.getElementById('bdCanvas'),button=document.createElement('button'),channel=new BroadcastChannel('lesson-summary:'+token);
 button.type='button';button.id='summaryCapture';button.className='bd-t';button.textContent='Фрагмент в итог';
 document.getElementById('bdExport').parentElement.appendChild(button);
 var message=document.createElement('p');message.id='summaryCaptureStatus';message.setAttribute('role','status');message.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:100;background:#fff8d9;color:#302744;padding:12px;border-radius:12px;display:none';document.body.appendChild(message);
 function say(t){message.style.display='block';message.textContent=t;}
 channel.onmessage=function(e){if(e.data&&e.data.ack)say(e.data.ok?'Фрагмент добавлен. Вернитесь во вкладку итога, чтобы проверить и отправить его.':'В итоге уже три фрагмента. Уберите один во вкладке итога.');};
 button.onclick=function(){
  if(!window.__board||!window.__board.board())return;
  say('Выделите прямоугольником нужный участок доски. Esc — отмена.');
  var rect=canvas.getBoundingClientRect(),overlay=document.createElement('div'),box=document.createElement('div'),start=null;
  overlay.id='summaryCrop';overlay.tabIndex=0;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Выделите фрагмент доски. Escape — отмена');
  overlay.style.cssText='position:fixed;z-index:99;cursor:crosshair;touch-action:none;background:rgba(100,80,160,.04);outline:2px solid #7b61d9;';Object.assign(overlay.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
  box.style.cssText='position:absolute;border:2px dashed #7b61d9;background:rgba(123,97,217,.12);pointer-events:none';overlay.appendChild(box);document.body.appendChild(overlay);overlay.focus();button.disabled=true;
  function close(){overlay.remove();button.disabled=false;}
  function point(e){return {x:Math.max(0,Math.min(rect.width,e.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,e.clientY-rect.top))};}
  overlay.onkeydown=function(e){if(e.key==='Escape'){e.stopPropagation();close();say('Выбор фрагмента отменён.');}};
  overlay.onpointerdown=function(e){e.preventDefault();start=point(e);overlay.setPointerCapture(e.pointerId);};
  overlay.onpointermove=function(e){if(!start)return;var p=point(e);Object.assign(box.style,{left:Math.min(p.x,start.x)+'px',top:Math.min(p.y,start.y)+'px',width:Math.abs(p.x-start.x)+'px',height:Math.abs(p.y-start.y)+'px'});};
  overlay.onpointerup=function(e){if(!start)return;var p=point(e),w=Math.abs(p.x-start.x),h=Math.abs(p.y-start.y);close();if(w<15||h<15){say('Участок слишком маленький. Выделите его ещё раз.');return;}
   try{var c=document.createElement('canvas'),scale=Math.min(2,1400/Math.max(w,h));c.width=Math.round(w*scale);c.height=Math.round(h*scale);var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(canvas,Math.min(p.x,start.x)*canvas.width/rect.width,Math.min(p.y,start.y)*canvas.height/rect.height,w*canvas.width/rect.width,h*canvas.height/rect.height,0,0,c.width,c.height);
    var src=c.toDataURL('image/png');while(src.length>700000&&c.width>200&&c.height>200){var small=document.createElement('canvas');small.width=Math.round(c.width*.75);small.height=Math.round(c.height*.75);small.getContext('2d').drawImage(c,0,0,small.width,small.height);c=small;src=c.toDataURL('image/png');}
    if(src.length>700000){say('Фрагмент слишком большой. Выберите меньший участок.');return;}
    channel.postMessage({lesson:lesson,board:window.__board.board().id,src:src,request:crypto.randomUUID()});say('Фрагмент отправлен во вкладку итога. Если подтверждение не появится, проверьте, что эта вкладка открыта.');
   }catch(err){say('Не удалось создать фрагмент. Попробуйте другой участок или обновите изображения на доске.');}
  };
  overlay.onpointercancel=function(){close();say('Выбор отменён.');};
 };
});
})();
