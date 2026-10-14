
(function(){
  var deck=document.querySelector('.deck'),S=[].slice.call(document.querySelectorAll('.slide')),
      cur=0,cnt=document.getElementById('cnt'),ui=document.getElementById('ui');
  function fit(){var s=Math.min(innerWidth/1280,innerHeight/720);deck.style.transform='scale('+s+')'}
  function go(i){cur=Math.max(0,Math.min(S.length-1,i));S.forEach(function(x,k){x.classList.toggle('on',k===cur)});
    cnt.textContent=(cur+1)+' / '+S.length;try{history.replaceState(null,'','#'+(cur+1))}catch(e){}}
  addEventListener('resize',fit);fit();
  var h=parseInt((location.hash||'#1').slice(1),10);go(isNaN(h)?0:h-1);
  addEventListener('keydown',function(e){
    if(['ArrowRight','PageDown',' ','Enter'].indexOf(e.key)>=0){e.preventDefault();go(cur+1)}
    if(['ArrowLeft','PageUp','Backspace'].indexOf(e.key)>=0){e.preventDefault();go(cur-1)}
    if(e.key==='Home')go(0);if(e.key==='End')go(S.length-1);if(e.key==='f')fs()});
  document.getElementById('prev').onclick=function(){go(cur-1)};
  document.getElementById('next').onclick=function(){go(cur+1)};
  function fs(){var d=document.documentElement;if(!document.fullscreenElement){(d.requestFullscreen||d.webkitRequestFullscreen||function(){}).call(d)}
    else{(document.exitFullscreen||document.webkitExitFullscreen).call(document)}}
  document.getElementById('fs').onclick=fs;
  var x0=null;addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});
  addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;
    if(Math.abs(dx)>40)go(cur+(dx<0?1:-1));x0=null},{passive:true});
  document.getElementById('stage').addEventListener('click',function(e){
    if(e.target.closest('a'))return;go(cur+(e.clientX>innerWidth/3?1:-1))});
  addEventListener('mousemove',function(){ui.classList.add('show');clearTimeout(ui._t);
    ui._t=setTimeout(function(){ui.classList.remove('show')},1800)});
})();
