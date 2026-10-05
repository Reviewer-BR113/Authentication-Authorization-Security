/* =========================================================
   SQL Mentoring — shared behavior for every page.
   - scroll progress bar
   - scroll-triggered reveal (.rv -> .in)
   - one-shot animation runners triggered when [data-run] scrolls in
   - a registry so individual pages can add custom animations:
        SQLViz.register('myAnim', function(el){ ... })
   ========================================================= */
(function(){
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;

  var RUN = {};
  window.SQLViz = {
    reduce: reduce,
    register: function(key, fn){ RUN[key] = fn; },
    run: function(key, el){ if(RUN[key]) RUN[key](el); },
    timers: function(el){ el._t = el._t || []; el._t.forEach(clearTimeout); el._t = []; return el._t; }
  };
  var timers = window.SQLViz.timers;

  /* ---------- built-in reusable runners ---------- */

  // Generic sequential flow: lights [data-s] / [data-c] children in order.
  RUN.flow = function(el){
    var kids = el.querySelectorAll("[data-s],[data-c]");
    var t = timers(el), d = reduce ? 0 : 430;
    kids.forEach(function(k){ k.classList.remove("lit"); });
    kids.forEach(function(k,i){ t.push(setTimeout(function(){ k.classList.add("lit"); }, d*i)); });
  };

  // Count-up numbers: elements [data-count] (with optional data-dec, data-suffix) inside el.
  RUN.counters = function(el){
    el.querySelectorAll("[data-count]").forEach(function(n){
      var to = parseFloat(n.getAttribute("data-count"));
      var dec = parseInt(n.getAttribute("data-dec")||"0",10);
      var suf = n.getAttribute("data-suffix")||"";
      function fmt(v){ return (dec>0 ? v.toFixed(dec) : Math.round(v).toLocaleString()) + suf; }
      if(reduce){ n.textContent = fmt(to); return; }
      var start=null, dur=1500;
      function step(ts){ if(!start)start=ts; var p=Math.min((ts-start)/dur,1); var e=1-Math.pow(1-p,3);
        n.textContent = fmt(to*e); if(p<1) requestAnimationFrame(step); }
      requestAnimationFrame(step);
    });
  };

  // Sequential row highlight for a "scan" list: rows are [data-row], target is [data-target].
  // Optional counter element id via data-count-el on the container.
  RUN.seqscan = function(el){
    var rows = el.querySelectorAll("[data-row]");
    var countId = el.getAttribute("data-count-el");
    var countEl = countId ? document.getElementById(countId) : null;
    var t = timers(el), d = reduce ? 0 : 520;
    rows.forEach(function(r){ r.classList.remove("checking","found","miss"); });
    if(countEl) countEl.textContent = "0";
    rows.forEach(function(r,i){
      t.push(setTimeout(function(){
        if(i>0){ rows[i-1].classList.remove("checking"); rows[i-1].classList.add("miss"); }
        if(countEl) countEl.textContent = (i+1);
        r.classList.add(r.hasAttribute("data-target") ? "found" : "checking");
      }, d*i));
    });
  };

  // B-Tree traverse: light nodes named by [data-node="0|1|2"] in sequence, looping.
  RUN.btree = function(el){
    var t = timers(el), d = reduce ? 0 : 600;
    var order = ["0","1","2"];
    el.querySelectorAll("[data-node]").forEach(function(n){ n.classList.remove("on"); });
    order.forEach(function(step,i){
      t.push(setTimeout(function(){ var n=el.querySelector('[data-node="'+step+'"]'); if(n)n.classList.add("on"); }, d*i));
    });
    if(!reduce) t.push(setTimeout(function(){ RUN.btree(el); }, d*order.length + 1500));
  };

  // SQL line-by-line highlight: highlights each .line child in sequence.
  RUN.sqlLines = function(el){
    var lines = el.querySelectorAll(".line");
    var t = timers(el), d = reduce ? 0 : 700;
    lines.forEach(function(l){ l.classList.remove("active"); });
    if(reduce){ lines.forEach(function(l){ l.classList.add("active"); }); return; }
    lines.forEach(function(l,i){
      t.push(setTimeout(function(){
        if(i>0) lines[i-1].classList.remove("active");
        l.classList.add("active");
        if(i===lines.length-1) t.push(setTimeout(function(){ l.classList.remove("active"); }, 700));
      }, d*i));
    });
  };

  // Comparison table: reveal [data-cr] rows one by one.
  RUN.compare = function(el){
    var rows = el.querySelectorAll("[data-cr]");
    var t = timers(el);
    rows.forEach(function(r){ r.classList.remove("lit"); });
    if(reduce){ rows.forEach(function(r){ r.classList.add("lit"); }); return; }
    rows.forEach(function(r,i){ t.push(setTimeout(function(){ r.classList.add("lit"); }, 200*i + 200)); });
  };

  // Animate bar widths: each [data-bar] grows to its data-w percentage.
  RUN.bars = function(el){
    var bars = el.querySelectorAll("[data-bar]");
    var t = timers(el);
    bars.forEach(function(b){ b.style.width = "0"; });
    if(reduce){ bars.forEach(function(b){ b.style.width = b.getAttribute("data-w")+"%"; }); return; }
    bars.forEach(function(b,i){ t.push(setTimeout(function(){ b.style.width = b.getAttribute("data-w")+"%"; }, 120*i + 200)); });
  };

  // Hash bucket pulse: highlight [data-hit] bucket, loop.
  RUN.hash = function(el){
    var t = timers(el), d = reduce ? 0 : 700, target = el.querySelector("[data-hit]");
    el.querySelectorAll(".bucket").forEach(function(b){ b.classList.remove("on"); });
    t.push(setTimeout(function(){ if(target) target.classList.add("on"); }, d));
    if(!reduce){
      t.push(setTimeout(function(){ if(target) target.classList.remove("on"); }, d+1200));
      t.push(setTimeout(function(){ RUN.hash(el); }, d+2200));
    }
  };

  /* ---------- AlgoViz: reusable algorithm step-controller ----------
     root: element containing `.av-explain` and `.av-bar` (controls injected into .av-bar).
     steps: [{explain, apply}] — apply() sets the FULL visual state for that step.
     Controls: Prev · Play/Pause · Next · Reset · step counter · speed · Auto/Learning/Presentation.
     Manual by default (no autoplay) — students drive with Next. */
  window.AlgoViz = function(root, steps, opts){
    opts = opts || {};
    if(root._algoviz) return root._algoviz;         // build once
    var explainEl = root.querySelector(".av-explain");
    var bar = root.querySelector(".av-bar");
    if(!bar) return null;
    var SPEEDS = [0.25, 0.5, 1, 1.5, 2];
    var BASE = reduce ? 260 : 1500;                 // ≥1s visible at 1×
    var idx = 0, playing = false, timer = null, speedIx = 2, learning = false, presentation = false;

    bar.innerHTML =
      '<button class="av-btn" data-a="prev" title="Previous step" aria-label="Previous step">⏮</button>'+
      '<button class="av-btn play" data-a="play">▶ Play</button>'+
      '<button class="av-btn" data-a="next" title="Next step" aria-label="Next step">⏭</button>'+
      '<button class="av-btn" data-a="reset" title="Reset" aria-label="Reset">🔄</button>'+
      '<span class="av-step"></span>'+
      '<span class="av-sep"></span>'+
      '<span class="av-speed">⚡<input type="range" min="0" max="4" step="1" value="2" aria-label="Speed"><b class="av-spd">1×</b></span>';
    var toggles = document.createElement("div"); toggles.className = "av-toggles";
    toggles.innerHTML =
      '<label class="av-toggle"><input type="checkbox" data-t="auto"> Auto Play</label>'+
      '<label class="av-toggle"><input type="checkbox" data-t="learning"> Learning Mode</label>'+
      '<label class="av-toggle"><input type="checkbox" data-t="presentation"> Presentation Mode</label>';
    bar.parentNode.insertBefore(toggles, bar.nextSibling);

    var prevB=bar.querySelector('[data-a="prev"]'), playB=bar.querySelector('[data-a="play"]'),
        nextB=bar.querySelector('[data-a="next"]'), resetB=bar.querySelector('[data-a="reset"]'),
        stepEl=bar.querySelector(".av-step"), range=bar.querySelector('input[type=range]'), spdEl=bar.querySelector(".av-spd"),
        autoCb=toggles.querySelector('[data-t="auto"]'), learnCb=toggles.querySelector('[data-t="learning"]'), presCb=toggles.querySelector('[data-t="presentation"]');

    function clearT(){ if(timer){ clearTimeout(timer); timer=null; } }
    function speed(){ return SPEEDS[speedIx]; }
    function paint(){
      steps[idx].apply();
      if(explainEl){ explainEl.innerHTML = steps[idx].explain || ""; explainEl.style.display = presentation ? "none" : ""; }
      stepEl.textContent = "Step " + (idx+1) + " / " + steps.length;
      prevB.disabled = idx===0; nextB.disabled = idx===steps.length-1;
      playB.innerHTML = playing ? "⏸ Pause" : "▶ Play";
      autoCb.checked = playing;
    }
    function goTo(i){ idx = Math.max(0, Math.min(steps.length-1, i)); paint(); }
    function schedule(){ clearT(); timer = setTimeout(function(){
        if(idx < steps.length-1){ goTo(idx+1); if(learning){ pause(); } else { schedule(); } }
        else { pause(); }
      }, BASE/speed()); }
    function play(){
      if(idx===steps.length-1) goTo(0);
      if(learning){ goTo(idx+1); return; }   // learning: Play advances one step, then waits
      playing=true; paint(); schedule();
    }
    function pause(){ playing=false; clearT(); paint(); }

    prevB.addEventListener("click", function(){ pause(); goTo(idx-1); });
    nextB.addEventListener("click", function(){ pause(); goTo(idx+1); });
    resetB.addEventListener("click", function(){ pause(); goTo(0); });
    playB.addEventListener("click", function(){ playing ? pause() : play(); });
    range.addEventListener("input", function(){ speedIx = +range.value; spdEl.textContent = speed()+"×"; if(playing){ schedule(); } });
    autoCb.addEventListener("change", function(){ autoCb.checked ? play() : pause(); });
    learnCb.addEventListener("change", function(){ learning = learnCb.checked; if(learning){ presCb.checked=false; presentation=false; } pause(); });
    presCb.addEventListener("change", function(){
      presentation = presCb.checked;
      if(presentation){ learnCb.checked=false; learning=false; speedIx=2; range.value=2; spdEl.textContent="1×"; paint(); play(); }
      else { paint(); }
    });

    goTo(0);
    var api = { play:play, pause:pause, next:function(){pause();goTo(idx+1);}, prev:function(){pause();goTo(idx-1);}, reset:function(){pause();goTo(0);}, goTo:goTo };
    root._algoviz = api;
    return api;
  };

  /* ---------- boot ---------- */
  function boot(){
    // scroll progress
    var sb = document.getElementById("scrollbar");
    if(sb){
      var onScroll = function(){
        var h = document.documentElement;
        var p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
        sb.style.width = (p*100) + "%";
      };
      document.addEventListener("scroll", onScroll, {passive:true}); onScroll();
    }

    // reveal
    var revEls = document.querySelectorAll(".rv");
    if(reduce){
      revEls.forEach(function(e){ e.classList.add("in"); });
    } else {
      var revIO = new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); revIO.unobserve(e.target); } });
      }, {threshold:.12, rootMargin:"0px 0px -8% 0px"});
      revEls.forEach(function(e){ revIO.observe(e); });
    }

    // one-shot animation runners
    var runEls = document.querySelectorAll("[data-run]");
    if(reduce){
      runEls.forEach(function(el){ var f=RUN[el.getAttribute("data-run")]; if(f) f(el); });
    } else {
      var runIO = new IntersectionObserver(function(es){
        es.forEach(function(e){
          if(e.isIntersecting){ var f=RUN[e.target.getAttribute("data-run")]; if(f) f(e.target); runIO.unobserve(e.target); }
        });
      }, {threshold:.4});
      runEls.forEach(function(el){ runIO.observe(el); });
    }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // independent failsafe: never leave content hidden if anything above throws
  setTimeout(function(){
    try{ if(!document.querySelector(".rv.in")) document.querySelectorAll(".rv").forEach(function(e){ e.classList.add("in"); }); }catch(_){}
  }, 800);
})();
