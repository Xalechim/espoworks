(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const TAPES = window.TAPES, SITE = window.SITE;
  const stage = $("#stage"), wrap = $("#stage-wrap"), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 60) : ms));
  let scale = 1, current = null, vidIdx = 0, busy = false, counterTimer = null, counterSecs = 0, staticRefs = 0, osdTimer = null;

  /* ---------- scale the fixed-size stage to the window ---------- */
  function layout() {
    const portrait = window.innerWidth < 900;
    document.body.classList.toggle("portrait", portrait);
    const sw = portrait ? 640 : 1200, sh = portrait ? 1360 : 700;
    scale = Math.min(wrap.clientWidth / sw, portrait ? 10 : 1.35);
    stage.style.transform = `scale(${scale})`;
    stage.style.left = Math.max(0, (wrap.clientWidth - sw * scale) / 2) + "px";
    wrap.style.height = sh * scale + "px";
  }
  addEventListener("resize", layout); layout();
  const rectOf = el => {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale, cx: (r.left - s.left + r.width / 2) / scale, cy: (r.top - s.top + r.height / 2) / scale };
  };

  /* ---------- build the shelf ---------- */
  const tapeEls = TAPES.map((t, i) => {
    const b = document.createElement("button");
    b.className = "tape"; b.style.setProperty("--c", t.color);
    b.setAttribute("aria-label", `Put in the VCR: ${t.title}`); b.title = t.title;
    b.innerHTML = `<span class="body"></span><span class="stripe"></span><span class="label"></span>`;
    $(".label", b).textContent = t.title;
    b.addEventListener("click", () => insert(i));
    $(i < 5 ? "#row-1" : "#row-2").appendChild(b);
    return b;
  });

  /* ---------- TV bits ---------- */
  const NS = "http://www.w3.org/2000/svg", ticks = $("#ch-ticks");
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, l = document.createElementNS(NS, "line");
    l.setAttribute("x1", 524 + Math.sin(a) * 41); l.setAttribute("y1", 258 - Math.cos(a) * 41);
    l.setAttribute("x2", 524 + Math.sin(a) * 47); l.setAttribute("y2", 258 - Math.cos(a) * 47);
    ticks.appendChild(l);
  }
  const needle = $("#ch-needle"); needle.style.transformOrigin = "524px 258px";
  const turnKnob = n => { needle.style.transform = `rotate(${(n % 12) * 30}deg)`; };

  const canvas = $("#static"), g = canvas.getContext("2d"), img = g.createImageData(160, 120);
  function drawStatic() {
    if (!staticRefs) return;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    setTimeout(() => requestAnimationFrame(drawStatic), 45);
  }
  async function burst(ms) {
    staticRefs++; canvas.classList.add("on"); sfx.staticOn(); if (staticRefs === 1) drawStatic();
    await sleep(ms);
    if (--staticRefs === 0) { canvas.classList.remove("on"); sfx.staticOff(); }
  }
  function osd(a, b, ms = 2600) {
    $("#osd-a").textContent = a || ""; $("#osd-b").textContent = b || "";
    $("#osd-a").classList.toggle("show", !!a); $("#osd-b").classList.toggle("show", !!b);
    clearTimeout(osdTimer); osdTimer = setTimeout(() => { $("#osd-a").classList.remove("show"); $("#osd-b").classList.remove("show"); }, ms);
  }
  const idle = $("#idle"), podcast = $("#podcast"), player = $("#player");
  function showScreen(which) {
    idle.hidden = which !== "idle"; podcast.hidden = which !== "podcast";
    player.classList.toggle("on", which === "player");
    if (which !== "player") player.innerHTML = "";
  }

  /* ---------- VCR display ---------- */
  const vtext = $("#vcr-text");
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function vcr(text, blink) { vtext.textContent = text; vtext.classList.toggle("blink", !!blink); }
  function startCounter() { stopCounter(); counterSecs = 0; vcr("0:00"); counterTimer = setInterval(() => vcr(fmt(++counterSecs)), 1000); }
  function stopCounter() { clearInterval(counterTimer); counterTimer = null; }

  /* ---------- cassette flying animation ---------- */
  const CW = 200, CH = 114;
  function makeCassette(t) {
    const c = document.createElement("div");
    c.className = "cassette"; c.style.setProperty("--c", t.color); c.style.left = c.style.top = "0";
    c.innerHTML = `<span class="stripe"></span><span class="label"></span><span class="window"><i class="reel"></i><i class="reel"></i></span>`;
    $(".label", c).textContent = t.title;
    stage.appendChild(c); return c;
  }
  const xf = (cx, cy, sx, sy, rot) => `translate(${cx - CW / 2}px,${cy - CH / 2}px) rotate(${rot}deg) scale(${sx},${sy})`;
  const fly = (el, frames, duration, easing = "ease-in-out") => reduced
    ? Promise.resolve(el.style.transform = frames[frames.length - 1].transform)
    : el.animate(frames, { duration, easing, fill: "forwards" }).finished;
  const spineXf = r => xf(r.cx, r.cy, r.h / CW, r.w / CH, 90);

  async function insert(i) {
    if (busy) return;
    busy = true; sfx.unlock();
    try {
      if (current !== null) await doEject();
      const t = TAPES[i], btn = tapeEls[i];
      sfx.pick();
      const from = rectOf(btn), slot = rectOf($("#vcr-slot"));
      const c = makeCassette(t);
      c.style.transform = spineXf(from); btn.classList.add("out");
      await fly(c, [
        { transform: spineXf(from) },
        { transform: xf((from.cx + slot.cx) / 2, Math.min(from.cy, slot.cy) - 40, 1, 1, 8), offset: .55 },
        { transform: xf(slot.cx, slot.cy - 6, 1, 1, 0) },
      ], 800);
      sfx.whir(1.3); vcr("LOAD", true);
      await fly(c, [{ transform: xf(slot.cx, slot.cy - 6, 1, 1, 0) }, { transform: xf(slot.cx, slot.cy + 4, .92, .08, 0), opacity: .9 }], 520, "ease-in");
      sfx.clunk(); c.remove();
      const sl = $("#vcr-slot"); sl.style.setProperty("--c", t.color); sl.classList.add("loaded");
      current = i; vidIdx = 0; $("#btn-eject").disabled = false;
      setGuide(i);
      document.getElementById("tv").classList.add("flicker");
      showScreen("idle"); await burst(850);
      document.getElementById("tv").classList.remove("flicker");
      startVideo(0, true);
    } finally { busy = false; }
  }

  async function doEject() {
    const i = current; if (i === null) return;
    const t = TAPES[i], btn = tapeEls[i];
    stopCounter(); vcr("EJECT", true); sfx.eject(); current = null; $("#btn-eject").disabled = true;
    showScreen("idle"); osd("", "", 1); turnKnob(0); resetGuide();
    const slot = rectOf($("#vcr-slot")), c = makeCassette(t);
    $("#vcr-slot").classList.remove("loaded");
    c.style.transform = xf(slot.cx, slot.cy + 4, .92, .08, 0);
    const to = rectOf(btn);
    burst(500);
    await fly(c, [{ transform: xf(slot.cx, slot.cy + 4, .92, .08, 0) }, { transform: xf(slot.cx, slot.cy - 6, 1, 1, 0) }], 520, "ease-out");
    await fly(c, [
      { transform: xf(slot.cx, slot.cy - 6, 1, 1, 0) },
      { transform: xf((to.cx + slot.cx) / 2, Math.min(to.cy, slot.cy) - 50, 1, 1, -8), offset: .45 },
      { transform: spineXf(to) },
    ], 800);
    c.remove(); btn.classList.remove("out"); sfx.pick(); vcr("12:00", true);
  }
  async function eject() { if (busy || current === null) return; busy = true; try { await doEject(); } finally { busy = false; } }

  /* ---------- video / podcast on the tube ---------- */
  async function startVideo(n, first) {
    const t = TAPES[current]; if (!t) return;
    const total = Math.max(1, t.videos.length);
    vidIdx = ((n % total) + total) % total; turnKnob(vidIdx + 1);
    markChannel();
    if (t.podcast) {
      showScreen("podcast");
      podcast.innerHTML = `<h2></h2>${t.podcast.lines.map(l => `<div>${l}</div>`).join("")}<a target="_blank" rel="noopener" href="${t.podcast.url}">▶ LISTEN ON APPLE PODCASTS</a>`;
      $("h2", podcast).textContent = t.title;
      osd("PLAY ▶", "", 2200); startCounter(); return;
    }
    const v = t.videos[vidIdx];
    if (!first) { showScreen("idle"); await burst(350); if (TAPES[current] !== t) return; }
    showScreen("player");
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    f.title = v.title; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.referrerPolicy = "strict-origin-when-cross-origin";
    player.innerHTML = ""; player.appendChild(f);
    osd(`PLAY ▶  CH ${String(vidIdx + 1).padStart(2, "0")}`, v.title, 3200); startCounter();
  }
  async function nextChannel() {
    sfx.unlock();
    if (current === null) { sfx.beep(); osd("NO TAPE", "Pick a tape from the shelf", 2600); showScreen("idle"); return; }
    if (busy) return; sfx.beep(); startVideo(vidIdx + 1);
  }

  /* ---------- guide panel ---------- */
  const gTitle = $("#guide-title"), gBody = $("#guide-body"), gChans = $("#guide-channels"), gNow = $("#guide-now");
  const intro = gBody.innerHTML, introTitle = gTitle.textContent;
  function resetGuide() { gTitle.textContent = introTitle; gBody.innerHTML = intro; gChans.innerHTML = ""; gNow.textContent = "Now showing: nothing. Pick a tape!"; }
  function setGuide(i) {
    const t = TAPES[i]; gTitle.textContent = t.title; gNow.textContent = `Now showing: ${t.title}`;
    gBody.innerHTML = ""; t.blurb.forEach(p => { const e = document.createElement("p"); e.textContent = p; gBody.appendChild(e); });
    gChans.innerHTML = "";
    if (t.podcast) { const li = document.createElement("li"); li.innerHTML = `<a class="listen" target="_blank" rel="noopener" href="${t.podcast.url}">Listen on Apple Podcasts ↗</a>`; gChans.appendChild(li); return; }
    t.videos.forEach((v, n) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.innerHTML = `<span class="n">CH ${String(n + 1).padStart(2, "0")}</span><span></span>`; $("span:last-child", b).textContent = v.title;
      b.addEventListener("click", () => { if (!busy && current === i) { sfx.unlock(); sfx.beep(); startVideo(n); $("#stage-wrap").scrollIntoView({ behavior: "smooth", block: "start" }); } });
      li.appendChild(b); gChans.appendChild(li);
    });
  }
  function markChannel() { [...gChans.querySelectorAll("button")].forEach((b, n) => b.setAttribute("aria-current", n === vidIdx)); }

  /* plain list (also good for search engines and screen readers) */
  const plain = $("#plain-list");
  TAPES.forEach(t => {
    const li = document.createElement("li"); li.innerHTML = `<strong></strong> `; $("strong", li).textContent = t.title;
    (t.podcast ? [{ id: null, title: "Apple Podcasts" }] : t.videos).forEach(v => {
      const a = document.createElement("a"); a.textContent = v.title; a.target = "_blank"; a.rel = "noopener";
      a.href = t.podcast ? t.podcast.url : `https://youtu.be/${v.id}`; li.append(" · ", a);
    });
    plain.appendChild(li);
  });

  /* ---------- controls ---------- */
  $("#btn-play").addEventListener("click", nextChannel);
  $("#knob-ch").addEventListener("click", nextChannel);
  $("#btn-eject").addEventListener("click", () => { sfx.unlock(); eject(); });
  function toggleSfx() {
    sfx.unlock(); sfx.setOn(!sfx.isOn());
    const b = $("#sfx-toggle"); b.setAttribute("aria-pressed", sfx.isOn()); b.textContent = sfx.isOn() ? "🔊 Sound FX: on" : "🔇 Sound FX: off";
    if (sfx.isOn()) sfx.beep();
  }
  $("#sfx-toggle").addEventListener("click", toggleSfx);
  $("#knob-sfx").addEventListener("click", toggleSfx);

  const modal = $("#modal");
  $("#machine").addEventListener("click", () => {
    sfx.unlock(); sfx.beep(); sfx.clunk();
    const body = $("#modal-body");
    body.innerHTML = SITE.email
      ? `“Hey Espo, it’s me. Give me a call back, or just write: <a href="mailto:${SITE.email}">${SITE.email}</a>”`
      : `“Hey Espo, it’s me. Let’s work together.” <a href="https://www.espoworks.com/contact">Leave a message on the contact page.</a>`;
    modal.hidden = false; $("#modal-close").focus();
  });
  const closeModal = () => { modal.hidden = true; $("#machine").focus(); };
  $("#modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  $("#resume").addEventListener("click", () => { sfx.unlock(); sfx.beep(); });

  osd("", "", 1);
})();
