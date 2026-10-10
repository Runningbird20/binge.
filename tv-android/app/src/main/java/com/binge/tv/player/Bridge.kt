package com.binge.tv.player

// Runs in every frame of the server's page (WebViewCompat document-start
// script). Each frame with a video reports it to the app; commands arrive
// at the top frame and are relayed down to every child frame (cross-origin
// included) with postMessage. Same script as the Apple TV app's bridge,
// with two Android differences:
//  - reports go through the BingeBridge Java interface (present in every frame);
//  - muting is done here (Android has no page-level mute): every frame
//    starts muted and keeps its videos muted until told otherwise, so race
//    contenders, preloads and background tiles never make a sound.
object Bridge {
    const val SCRIPT = """
(function(){
  if (window.__bingeBridge) return; window.__bingeBridge = true;
  if (window.__bingeMuted === undefined) window.__bingeMuted = true;
  function pick(){ var vs=document.getElementsByTagName('video'), best=null;
    for (var i=0;i<vs.length;i++){ var v=vs[i]; if(!best || v.readyState>best.readyState || (v.duration||0)>(best.duration||0)) best=v; }
    return best; }
  function tracks(v){ var a=[], x=[], i;
    if (v.audioTracks) for (i=0;i<v.audioTracks.length;i++){ var at=v.audioTracks[i]; a.push({i:i, l:at.label||'', g:at.language||'', on:!!at.enabled}); }
    if (v.textTracks) for (i=0;i<v.textTracks.length;i++){ var tt=v.textTracks[i]; if(tt.kind==='subtitles'||tt.kind==='captions') x.push({i:i, l:tt.label||'', g:tt.language||'', on:i===window.__bingeTextIdx, n:tt.cues?tt.cues.length:0}); }
    return {a:a, x:x}; }
  if (window.__bingeTextIdx === undefined) window.__bingeTextIdx = -2;
  function cueText(v){ var tl=v.textTracks; if(!tl) return '';
    if (window.__bingeTextIdx===-2){ for (var k=0;k<tl.length;k++){ if(tl[k].mode==='showing' && (tl[k].kind==='subtitles'||tl[k].kind==='captions')){ window.__bingeTextIdx=k; break; } } }
    var idx=window.__bingeTextIdx; if(idx<0 || !tl[idx]) return '';
    var tr=tl[idx]; if(tr.mode!=='hidden') tr.mode='hidden';
    var cues=tr.activeCues; if(!cues||!cues.length){ var all=tr.cues, now=v.currentTime, hit=[];
      if(all) for (var q=0;q<all.length;q++){ if(all[q].startTime<=now && all[q].endTime>now) hit.push(all[q]); else if(all[q].startTime>now) break; }
      cues=hit; } if(!cues.length) return '';
    var parts=[]; for (var c=0;c<cues.length;c++){ var t=cues[c].text||''; parts.push(t.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')); }
    return parts.join('\n').trim(); }
  function state(v){ var tr=tracks(v); return {t:v.currentTime||0, d:isFinite(v.duration)?v.duration:0, paused:v.paused, ended:v.ended, ready:v.readyState, h:v.videoHeight||0, at:tr.a, tt:tr.x, cue:cueText(v)}; }
  var FILL_CSS='html.__bf,html.__bf body{background:#000!important;overflow:hidden!important;margin:0!important}'+
    '.__bf-el{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:100vw!important;height:100vh!important;'+
    'max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;'+
    'border-radius:0!important;transform:none!important;z-index:2147483647!important;background:#000!important;visibility:visible!important}'+
    'video.__bf-el{object-fit:contain!important}'+
    // Everything else on the server's page (its own controls, menus, ads) is
    // hidden: visibility inherits, and the pinned element turns itself back
    // on. (No :has(), which older Android WebViews don't support.)
    'html.__bf body{visibility:hidden!important}';
  function pin(el){ if(!document.getElementById('__bf-style')){ var st=document.createElement('style'); st.id='__bf-style'; st.textContent=FILL_CSS; (document.head||document.documentElement).appendChild(st); }
    document.documentElement.classList.add('__bf'); el.classList.add('__bf-el');
    try{ window.scrollTo(0,0); }catch(e){}
    var TRAPS=['transform','filter','contain','will-change','perspective','backdrop-filter','-webkit-backdrop-filter','container-type','clip-path','mask','-webkit-mask','content-visibility','zoom'];
    var RESET={'transform':'none','filter':'none','contain':'none','will-change':'auto','perspective':'none','backdrop-filter':'none','-webkit-backdrop-filter':'none','container-type':'normal','clip-path':'none','mask':'none','-webkit-mask':'none','content-visibility':'visible','zoom':'1'};
    for (var a=el.parentElement || (el.getRootNode && el.getRootNode().host); a && a!==document.documentElement; a=a.parentElement || (a.getRootNode && a.getRootNode().host) || null){
      for (var t=0;t<TRAPS.length;t++) a.style.setProperty(TRAPS[t], RESET[TRAPS[t]], 'important'); }
    if (window.parent !== window) { try{ window.parent.postMessage({__bingeFillUp:true},'*'); }catch(e){} } }
  function unpin(){ document.documentElement.classList.remove('__bf'); var els=document.querySelectorAll('.__bf-el'); for (var i=0;i<els.length;i++) els[i].classList.remove('__bf-el'); }
  window.addEventListener('message', function(e){ if(!(e.data && e.data.__bingeFillUp)) return;
    var fs=document.getElementsByTagName('iframe'); for (var i=0;i<fs.length;i++){ if(fs[i].contentWindow===e.source){ pin(fs[i]); break; } } });
  function cue(cmd){ var parts=cmd.split(':'), size=parseInt(parts[1],10)||100, bg=parts.slice(2).join(':')||'transparent';
    var st=document.getElementById('__bcue'); if(!st){ st=document.createElement('style'); st.id='__bcue'; (document.head||document.documentElement).appendChild(st); }
    st.textContent='video::cue{font-size:'+size+'%!important;background-color:'+bg+'!important;color:#fff!important}'; }
  // Players that wait for a click on their own big Play button (JW Player,
  // Clappr, Video.js, Plyr…): the remote can't reach it, so press it for the
  // viewer. Only while the video hasn't loaded anything yet.
  var lastStart=0;
  function startPlayer(v){ var now=Date.now(); if(now-lastStart<1500) return; lastStart=now;
    try{ if(window.jwplayer){ var jw=window.jwplayer(); if(jw && jw.play) jw.play(); } }catch(e){}
    var sel='.jw-icon-display,.jw-display-icon-container,.vjs-big-play-button,.plyr__control--overlaid,.play-wrapper,[data-plyr="play"],.media-control-button[data-playback],.ytp-large-play-button,button[aria-label="Play"],[class*="play-button"],[class*="playButton"],[class*="big-play"]';
    var b=document.querySelector(sel);
    var target=b || v;
    try{ ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){ target.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); }); }catch(e){} }
  function muteAll(m){ var vs=document.getElementsByTagName('video'); for (var i=0;i<vs.length;i++) vs[i].muted=m; }
  // Once the video plays full screen, frames that aren't on its path (ads,
  // trackers, pop-under bait) are unloaded: they're hidden anyway, and on a
  // Fire TV they cost memory and CPU the video needs.
  function trim(){ if(!document.documentElement.classList.contains('__bf')) return;
    var fs=document.getElementsByTagName('iframe');
    for (var i=fs.length-1;i>=0;i--){ var f=fs[i]; if(!f.classList.contains('__bf-el')){ try{ f.src='about:blank'; }catch(e){} if(f.parentNode) f.parentNode.removeChild(f); } } }
  function apply(cmd){
    if(cmd==='unfill'){ unpin(); return; }
    if(cmd==='trim'){ trim(); return; }
    if(cmd.indexOf('cue:')===0){ cue(cmd); return; }
    if(cmd==='mute'||cmd==='stop'){ window.__bingeMuted=true; muteAll(true); }
    if(cmd==='unmute'){ window.__bingeMuted=false; muteAll(false); }
    var v=pick(); if(!v) return; var p;
    if(cmd==='fill'){ if(v.readyState>0 || v.duration>0) pin(v); return; }
    if(cmd.indexOf('audio:')===0){ var ai=parseInt(cmd.slice(6),10); if(v.audioTracks) for (var k=0;k<v.audioTracks.length;k++) v.audioTracks[k].enabled=(k===ai); return; }
    if(cmd.indexOf('text:')===0){ var ti=parseInt(cmd.slice(5),10); window.__bingeTextIdx=ti; if(v.textTracks) for (var j=0;j<v.textTracks.length;j++){ var t2=v.textTracks[j]; if(t2.kind==='subtitles'||t2.kind==='captions') t2.mode=(j===ti?'hidden':'disabled'); } return; }
    if(cmd==='play'){ if(!v.currentSrc && v.readyState===0) startPlayer(v); p=v.play(); } else if(cmd==='pause'){ v.pause(); }
    else if(cmd==='toggle'){ if(v.paused){p=v.play()} else {v.pause()} }
    else if(cmd==='stop'){ v.pause(); }
    else if(cmd.indexOf('seekBy:')===0){ var x=parseFloat(cmd.slice(7)); v.currentTime=Math.max(0,Math.min((isFinite(v.duration)?v.duration:1e9)-1,v.currentTime+x)); }
    else if(cmd.indexOf('seekTo:')===0){ v.currentTime=parseFloat(cmd.slice(7)); }
    if(p&&p.catch) p.catch(function(){}); }
  function relay(cmd){ apply(cmd); for (var i=0;i<window.frames.length;i++){ try{ window.frames[i].postMessage({__binge:cmd},'*'); }catch(e){} } }
  window.__bingeRun = relay;
  window.addEventListener('message', function(e){ if(e.data && e.data.__binge) relay(e.data.__binge); });
  // Popup ads: window.open does nothing here.
  try{ window.open=function(){ return null; }; }catch(e){}
  setInterval(function(){ var v=pick(); if(!v) return;
    if (window.__bingeMuted && !v.muted) v.muted=true;
    try{ if(window.BingeBridge) window.BingeBridge.post(JSON.stringify(state(v))); }catch(e){} }, 400);
})();
"""
}
