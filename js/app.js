/**
 * ÀWA — Motor de Interatividade, Busca Shotdeck, Navegação e Chat de Contato
 */

(function () {
  const cfg = window.AWA_CONFIG;

  // Normaliza texto para busca tolerante a acentos e plural simples ("zenitais" -> "zenital")
  function norm(str) {
    return (str || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function matchQuery(haystack, query) {
    const q = norm(query);
    if (!q) return true;
    const h = norm(haystack);
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every((tok) => {
      if (h.includes(tok)) return true;
      // Suporte simples a plural em PT-BR: "zenitais" -> "zenital", "closes" -> "close"
      if (tok.endsWith("ais") && h.includes(tok.slice(0, -3) + "al")) return true;
      if (tok.endsWith("is") && h.includes(tok.slice(0, -2) + "l")) return true;
      if (tok.endsWith("es") && h.includes(tok.slice(0, -2))) return true;
      if (tok.endsWith("s") && tok.length > 3 && h.includes(tok.slice(0, -1))) return true;
      return false;
    });
  }

  function getProjectById(id) {
    return (window.AWA_PROJECTS || []).find((p) => p.id === id) || window.AWA_PROJECTS[0];
  }

  /**
   * Extracts individual person/crew/partner names from a project's technical credits.
   */
  function extractCreditNames(project) {
    if (!project || !Array.isArray(project.credits)) return [];
    const seen = new Map();
    project.credits.forEach((c) => {
      const raw = String(c.name || "").trim();
      if (!raw) return;
      raw
        .split(/\s*,\s*|\s+\/\s+|\s+e\s+/i)
        .map((part) => part.replace(/^["“”']+|["“”']+$/g, "").trim())
        .filter((part) => part.length >= 2)
        .forEach((name) => {
          const key = norm(name);
          if (key && !seen.has(key)) seen.set(key, name);
        });
    });
    return Array.from(seen.values());
  }

  /**
   * Turns individual credit names in a project's technical sheet into clickable gallery search links.
   */
  function renderCreditValueLinks(rawName) {
    return String(rawName || "")
      .split(/(\s*,\s*|\s+\/\s+|\s+e\s+)/i)
      .map((part) => {
        if (/^(\s*,\s*|\s+\/\s+|\s+e\s+)$/i.test(part)) return part;
        const clean = part.replace(/^["“”']+|["“”']+$/g, "").trim();
        if (clean.length < 2) return part;
        return `<a href="portfolio.html?q=${encodeURIComponent(clean)}" class="eyecandy-credit-link">${part.trim()}</a>`;
      })
      .join("");
  }

  /**
   * Enriches every shot's tags with the names of everyone credited in its project's technical sheet.
   */
  function enrichShotsWithCreditTags() {
    const projectCreditsMap = new Map();
    (window.AWA_PROJECTS || []).forEach((proj) => {
      projectCreditsMap.set(proj.id, extractCreditNames(proj));
    });

    (window.AWA_SHOTS || []).forEach((shot) => {
      const crewNames = projectCreditsMap.get(shot.projectId) || [];
      if (!crewNames.length) return;
      if (!Array.isArray(shot.tags)) shot.tags = [];
      const existing = new Set(shot.tags.map((t) => norm(t)));
      crewNames.forEach((name) => {
        const key = norm(name);
        if (key && !existing.has(key)) {
          existing.add(key);
          shot.tags.push(name);
        }
      });
    });
  }

  /**
   * Renders minimal hover metadata with project title and slightly smaller year.
   */
  function renderHoverMeta(project) {
    if (!project) return "";
    return `<div class="video-masonry-sub"><span class="video-masonry-proj">${project.title}</span><span class="video-masonry-year"> · ${project.year}</span></div>`;
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Lazy-play videos when visible in viewport + mobile Safari/Android autoplay unlock
  let _videoObserver = null;
  let _visibleVideos = new Set();

  function prepareMobileVideoAttrs(vid) {
    vid.muted = true;
    vid.defaultMuted = true;
    vid.playsInline = true;
    const allowLoop = vid.dataset.noLoop !== "1";
    vid.loop = allowLoop;
    vid.autoplay = true;
    vid.setAttribute("muted", "");
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.setAttribute("autoplay", "");
    if (!allowLoop) {
      vid.removeAttribute("loop");
    }
  }

  function safePlayVideo(vid) {
    prepareMobileVideoAttrs(vid);
    if (!vid.getAttribute("src") && vid.dataset.src) {
      vid.setAttribute("src", vid.dataset.src);
      vid.addEventListener(
        "loadeddata",
        () => {
          if (_visibleVideos.has(vid)) {
            vid.play().catch(() => {});
          }
        },
        { once: true }
      );
      vid.load();
    }
    const p = vid.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  }

  // First touch/scroll on mobile unlocks any deferred <video> autoplay loops
  ["touchstart", "pointerdown", "click"].forEach((evt) => {
    document.addEventListener(
      evt,
      () => {
        _visibleVideos.forEach((vid) => {
          if (vid.paused) safePlayVideo(vid);
        });
      },
      { passive: true }
    );
  });

  function attachViewportVideoObserver(rootEl) {
    if (!rootEl) return;
    const videos = rootEl.querySelectorAll("video[data-src]");
    if (!videos.length) return;
    _visibleVideos.clear();
    videos.forEach(prepareMobileVideoAttrs);

    if (!("IntersectionObserver" in window)) {
      videos.forEach((v) => {
        _visibleVideos.add(v);
        safePlayVideo(v);
      });
      return;
    }
    if (_videoObserver) _videoObserver.disconnect();
    _videoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const vid = entry.target;
          if (entry.isIntersecting) {
            _visibleVideos.add(vid);
            safePlayVideo(vid);
          } else {
            _visibleVideos.delete(vid);
            vid.pause();
          }
        });
      },
      { rootMargin: "80px 0px", threshold: 0.05 }
    );
    videos.forEach((v) => _videoObserver.observe(v));
  }

  function extractYouTubeId(input) {
    if (!input) return "";
    const str = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
    const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : "";
  }

  // =========================================================================
  // 1. HEADER & FOOTER COMPARTILHADOS
  // =========================================================================
  function renderLayoutChrome() {
    const currentPage = document.body.dataset.page || "home";
    const navItems = [
      { id: "home", label: "Início", href: "index.html" },
      { id: "portfolio", label: "Galeria", href: "portfolio.html" },
      // { id: "time", label: "Time & Parceiros", href: "time.html" },
      { id: "clientes", label: "Clientes & Projetos", href: "clientes.html" }
    ];

    const headerEl = document.getElementById("site-header");
    if (headerEl) {
      headerEl.innerHTML = `
        <div class="container header-inner">
          <a href="index.html" class="brand-link" aria-label="ÀWA — Página inicial">
            <img src="${cfg.assets.simbolo}" alt="Símbolo ÀWA" class="brand-symbol" />
            <img src="${cfg.assets.tipografia}" alt="ÀWA" class="brand-wordmark" />
          </a>

          <nav class="nav-links" aria-label="Navegação principal">
            ${navItems
              .map(
                (item) => `
              <a href="${item.href}" class="nav-link ${currentPage === item.id ? "active" : ""}">
                ${item.label}
              </a>`
              )
              .join("")}
          </nav>

          <div style="display:flex;align-items:center;gap:12px;">
            <a href="contato.html" class="nav-cta nav-cta-desktop ${currentPage === "contato" ? "active" : ""}">
              Contato
            </a>
            <button type="button" class="menu-toggle" id="menu-toggle-btn" aria-label="Abrir menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <line x1="3" y1="7" x2="21" y2="7"></line>
                <line x1="3" y1="17" x2="21" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    const mobileNavEl = document.getElementById("mobile-nav");
    if (mobileNavEl) {
      mobileNavEl.innerHTML = `
        ${navItems
          .map(
            (item) =>
              `<a href="${item.href}" class="nav-link ${currentPage === item.id ? "active" : ""}">${item.label}</a>`
          )
          .join("")}
        <a href="contato.html" class="nav-link ${currentPage === "contato" ? "active" : ""}">Contato</a>
      `;
    }

    const toggleBtn = document.getElementById("menu-toggle-btn");
    if (toggleBtn && mobileNavEl) {
      toggleBtn.addEventListener("click", () => {
        mobileNavEl.classList.toggle("open");
      });
    }

    const footerEl = document.getElementById("site-footer");
    if (footerEl) {
      footerEl.innerHTML = `
        <div class="container">
          <div class="footer-grid">
            <div>
              <img src="${cfg.assets.juncao}" alt="ÀWA — Símbolo e Tipografia" style="height:68px;width:auto;margin-bottom:16px;" />
              <p style="color:var(--fg-muted);font-size:0.9rem;max-width:32ch;line-height:1.6;">
                Àwa significa <strong>nós</strong>. Cinema autoral tecido a muitas mãos — da concepção do quadro ao corte final.
              </p>
            </div>
            <div>
              <div class="footer-heading">Setores</div>
              <div class="footer-links">
                <a href="index.html">Início & Notícias</a>
                <a href="portfolio.html">Galeria</a>
                <a href="clientes.html">Clientes & Projetos</a>
                <a href="contato.html">Contato Direto</a>
              </div>
            </div>
            <div>
              <div class="footer-heading">Busca Rápida</div>
              <div class="footer-links">
                <a href="portfolio.html?q=zenital">Takes Zenitais</a>
                <a href="portfolio.html?q=anamorfica">Lentes Anamórficas</a>
                <a href="portfolio.html?q=preto%20e%20branco">Monocromático P&B</a>
                <a href="portfolio.html?q=documentario">Documentários</a>
              </div>
            </div>
            <div>
              <div class="footer-heading">Contato & Estúdio</div>
              <div class="footer-links">
                <span>${cfg.location}</span>
                <span>${cfg.instagram}</span>
                <a href="contato.html" style="color:var(--fg);text-decoration:underline;text-underline-offset:4px;">Chat</a>
              </div>
            </div>
          </div>
          <div class="footer-bottom">
            <span>© 2026 ÀWA — Todos os direitos reservados</span>
            <span>Identidade Monocromática · 8 Pontas · Nó Infinito</span>
          </div>
        </div>
      `;
    }
  }

  // =========================================================================
  // 2. MODAL GLOBAL (INSPEÇÃO DE TAKE / NOTÍCIA)
  // =========================================================================
  function ensureGlobalModal() {
    let modal = document.getElementById("awa-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "awa-modal";
      modal.className = "modal-backdrop";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      document.body.appendChild(modal);
    }
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
    return modal;
  }

  let stopActiveNewsReel = null;

  function mountProjectTakeReel(containerEl, projectId, fallbackImage, altText, options = {}) {
    if (!containerEl) return null;
    const rawTakes = (window.AWA_SHOTS || []).filter((s) => s.projectId === projectId && s.video);
    if (!rawTakes.length) {
      containerEl.innerHTML = `<img src="${fallbackImage}" alt="${altText || ""}" />`;
      return null;
    }

    let queue = shuffleArray(rawTakes);
    let idx = 0;
    let activeSlot = 0;
    let cutTimer = null;
    let watchdogCleanup = null;
    let stopped = false;

    containerEl.innerHTML = `
      <div class="project-reel" aria-label="${altText || "Compilado aleatório de takes"}">
        <video class="project-reel-video is-active" muted playsinline webkit-playsinline autoplay preload="auto"></video>
        <video class="project-reel-video" muted playsinline webkit-playsinline autoplay preload="auto"></video>
      </div>
    `;

    const slots = Array.from(containerEl.querySelectorAll("video"));
    slots.forEach((vid) => {
      if (queue.length > 1) {
        vid.dataset.noLoop = "1";
        vid.loop = false;
      }
      prepareMobileVideoAttrs(vid);
    });

    function clearTimers() {
      if (cutTimer) {
        clearTimeout(cutTimer);
        cutTimer = null;
      }
      if (watchdogCleanup) {
        watchdogCleanup();
        watchdogCleanup = null;
      }
    }

    function stopAll() {
      stopped = true;
      clearTimers();
      slots.forEach((v) => {
        _visibleVideos.delete(v);
        v.onended = null;
        v.onerror = null;
        try {
          v.pause();
        } catch (_) {}
      });
    }

    function loadSlot(slot, shot) {
      if (!slot || !shot) return;
      slot.dataset.shotId = shot.id;
      slot.poster = shot.image || fallbackImage || "";
      if (slot.getAttribute("src") !== shot.video) {
        slot.setAttribute("src", shot.video);
        slot.load();
      }
      if (queue.length > 1) {
        slot.dataset.noLoop = "1";
        slot.loop = false;
      } else {
        slot.loop = true;
      }
      prepareMobileVideoAttrs(slot);
    }

    function nextShotIndex() {
      idx += 1;
      if (idx >= queue.length) {
        const lastId = queue[queue.length - 1]?.id;
        queue = shuffleArray(rawTakes);
        if (queue.length > 1 && queue[0]?.id === lastId) {
          [queue[0], queue[1]] = [queue[1], queue[0]];
        }
        idx = 0;
      }
      return idx;
    }

    function scheduleNextCut() {
      clearTimers();
      if (stopped || queue.length <= 1) return;
      const currentVid = slots[activeSlot];
      currentVid.loop = false;

      const triggerAdvance = () => {
        if (stopped || !document.body.contains(containerEl)) {
          stopAll();
          return;
        }
        const rect = containerEl.getBoundingClientRect();
        const offscreen = rect.bottom < -120 || rect.top > (window.innerHeight || 900) + 120;
        if (document.hidden || offscreen) {
          cutTimer = setTimeout(triggerAdvance, 1000);
          return;
        }
        advanceTake();
      };

      const armWatchdog = (ms) => {
        if (cutTimer) clearTimeout(cutTimer);
        cutTimer = setTimeout(triggerAdvance, ms);
      };

      const armDurationWatchdog = () => {
        const durSec = Number.isFinite(currentVid.duration) && currentVid.duration > 0 ? currentVid.duration : 10;
        const ms = Math.max(4000, Math.ceil(durSec * 1000) + 2500);
        armWatchdog(ms);
      };

      const onPlayingOrMeta = () => {
        if (stopped || slots[activeSlot] !== currentVid) return;
        armDurationWatchdog();
      };

      currentVid.addEventListener("playing", onPlayingOrMeta);
      currentVid.addEventListener("loadedmetadata", onPlayingOrMeta);
      watchdogCleanup = () => {
        currentVid.removeEventListener("playing", onPlayingOrMeta);
        currentVid.removeEventListener("loadedmetadata", onPlayingOrMeta);
      };

      if (!currentVid.paused && currentVid.readyState >= 2) {
        armDurationWatchdog();
      } else {
        armWatchdog(8000);
      }

      currentVid.onended = () => {
        clearTimers();
        triggerAdvance();
      };
      currentVid.onerror = () => {
        clearTimers();
        cutTimer = setTimeout(triggerAdvance, 350);
      };
    }

    function advanceTake() {
      if (stopped || !document.body.contains(containerEl)) {
        stopAll();
        return;
      }
      const nextIdx = nextShotIndex();
      const nextShot = queue[nextIdx];
      const nextSlotIdx = activeSlot === 0 ? 1 : 0;
      const currVid = slots[activeSlot];
      const nextVid = slots[nextSlotIdx];

      const commitSwap = () => {
        if (stopped) return;
        nextVid.currentTime = 0;
        nextVid.classList.add("is-active");
        currVid.classList.remove("is-active");
        _visibleVideos.delete(currVid);
        _visibleVideos.add(nextVid);
        try {
          currVid.pause();
        } catch (_) {}
        const playPromise = nextVid.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
        activeSlot = nextSlotIdx;

        const peekIdx = (nextIdx + 1) % queue.length;
        loadSlot(currVid, queue[peekIdx]);
        scheduleNextCut();
      };

      if (nextVid.getAttribute("src") !== nextShot.video) {
        loadSlot(nextVid, nextShot);
      }

      if (nextVid.readyState >= 2) {
        commitSwap();
      } else {
        let settled = false;
        const onReady = () => {
          if (settled) return;
          settled = true;
          commitSwap();
        };
        nextVid.addEventListener("canplay", onReady, { once: true });
        nextVid.addEventListener("loadeddata", onReady, { once: true });
        setTimeout(() => {
          if (!settled) {
            settled = true;
            commitSwap();
          }
        }, 1200);
      }
    }

    loadSlot(slots[0], queue[0]);
    _visibleVideos.add(slots[0]);
    slots[0].addEventListener(
      "loadeddata",
      () => {
        if (!stopped && activeSlot === 0 && slots[0].paused) {
          slots[0].play().catch(() => {});
        }
      },
      { once: true }
    );
    const p0 = slots[0].play();
    if (p0 && typeof p0.catch === "function") p0.catch(() => {});

    if (queue.length > 1) {
      loadSlot(slots[1], queue[1]);
      scheduleNextCut();
    }

    return stopAll;
  }

  function closeModal() {
    if (typeof stopActiveNewsReel === "function") {
      stopActiveNewsReel();
      stopActiveNewsReel = null;
    }
    const modal = document.getElementById("awa-modal");
    if (modal) {
      modal.classList.remove("open");
      modal.querySelectorAll("video").forEach((v) => v.pause());
    }
    const eyeModal = document.getElementById("awa-eyecandy-modal");
    if (eyeModal) {
      eyeModal.classList.remove("open");
      eyeModal.querySelectorAll("video").forEach((v) => v.pause());
    }
    document.body.style.overflow = "";
  }

  let activeLightboxNav = null;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (activeLightboxNav && document.getElementById("awa-eyecandy-modal")?.classList.contains("open")) {
      if (e.key === "ArrowLeft") activeLightboxNav.prev();
      if (e.key === "ArrowRight") activeLightboxNav.next();
    }
  });

  function ensureEyecandyModal() {
    let modal = document.getElementById("awa-eyecandy-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "awa-eyecandy-modal";
      modal.className = "eyecandy-modal-backdrop";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }
    return modal;
  }

  function openShotModal(shotId, listContext) {
    const shots = listContext && listContext.length ? listContext : window.AWA_SHOTS;
    const idx = shots.findIndex((s) => s.id === shotId);
    const shot = shots[idx] || window.AWA_SHOTS[0];
    const project = getProjectById(shot.projectId);
    const modal = ensureEyecandyModal();

    const prevShot = shots[(idx - 1 + shots.length) % shots.length];
    const nextShot = shots[(idx + 1) % shots.length];

    const mediaHtml = shot.video
      ? `<video src="${shot.video}" poster="${shot.image}" autoplay loop controls playsinline></video>`
      : `<img src="${shot.image}" alt="${shot.title}" />`;

    modal.innerHTML = `
      <button type="button" class="eyecandy-modal-close" id="eye-close-btn" aria-label="Fechar">×</button>
      <button type="button" class="eyecandy-modal-chevron prev" id="eye-prev-btn" aria-label="Anterior">‹</button>
      <button type="button" class="eyecandy-modal-chevron next" id="eye-next-btn" aria-label="Próximo">›</button>

      <div class="eyecandy-modal-stage">
        <div class="eyecandy-modal-video-wrap">
          ${mediaHtml}
        </div>

        <div class="eyecandy-modal-meta">
          <div>
            <h2 class="eyecandy-modal-title">${shot.title} <span style="opacity:0.55;font-weight:400;">(${project.year})</span></h2>
            <div class="eyecandy-credit-list">
              <div><strong>Técnica / Enquadramento —</strong> <a href="portfolio.html?q=${encodeURIComponent(shot.enquadramento)}" class="eyecandy-credit-link">${shot.enquadramento}</a> · ${shot.movimento}</div>
              <div><strong>Obra —</strong> <a href="projeto.html?id=${encodeURIComponent(project.id)}" class="eyecandy-credit-link">${project.title}</a> (${project.category})</div>
              <div><strong>Óptica & Câmera —</strong> ${shot.lente} · ${shot.camera} · ${shot.iluminacao}</div>
              <div><strong>Timecode —</strong> <span class="mono">${shot.timecode}</span></div>
              ${project.creditNote ? `<div><strong>Participação —</strong> ${project.creditNote}</div>` : ""}
            </div>
            <p style="color:var(--fg-muted);font-size:0.9rem;line-height:1.55;margin-bottom:14px;max-width:66ch;">${shot.notes}</p>
            <div class="eyecandy-pill-tags">
              ${(() => {
                const limit = shot.projectId === "instrumental-sesc-brasil-2026" ? 45 : 8;
                const combined = [...(shot.tags || []).slice(0, limit), ...extractCreditNames(project)];
                const unique = [];
                const seenModal = new Set();
                combined.forEach((t) => {
                  const k = norm(t);
                  if (k && !seenModal.has(k)) {
                    seenModal.add(k);
                    unique.push(t);
                  }
                });
                return unique
                  .map(
                    (t) =>
                      `<a href="portfolio.html?q=${encodeURIComponent(t)}" class="eyecandy-pill-tag">${t}</a>`
                  )
                  .join("");
              })()}
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end;">
            ${
              shot.youtubeUrl
                ? `<a href="${shot.youtubeUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">YouTube ↗</a>`
                : ""
            }
            <a href="projeto.html?id=${encodeURIComponent(project.id)}&shot=${encodeURIComponent(shot.id)}" class="btn ${shot.youtubeUrl ? "btn-ghost" : "btn-primary"}">
              Projeto
            </a>
            <span class="mono" style="font-size:0.68rem;color:var(--fg-dim);">${idx + 1} / ${shots.length} · ← → PARA NAVEGAR</span>
          </div>
        </div>
      </div>
    `;

    modal.classList.add("open");
    document.body.style.overflow = "hidden";

    const goPrev = () => openShotModal(prevShot.id, shots);
    const goNext = () => openShotModal(nextShot.id, shots);
    activeLightboxNav = { prev: goPrev, next: goNext };

    document.getElementById("eye-close-btn").onclick = closeModal;
    document.getElementById("eye-prev-btn").onclick = goPrev;
    document.getElementById("eye-next-btn").onclick = goNext;
  }

  function openNewsModal(newsOrProjectId) {
    let item = (window.AWA_NEWS || []).find((n) => n.id === newsOrProjectId || n.projectId === newsOrProjectId);
    const projectMatch = item ? getProjectById(item.projectId) : (window.AWA_PROJECTS || []).find((p) => p.id === newsOrProjectId);
    if (!item && projectMatch) {
      item = {
        id: projectMatch.id,
        projectId: projectMatch.id,
        tag: (projectMatch.category || "PROJETO").toUpperCase(),
        date: projectMatch.year,
        title: projectMatch.title,
        fullText: projectMatch.synopsis || projectMatch.logline || "",
        image: projectMatch.coverImage
      };
    }
    if (!item) return;
    if (typeof stopActiveNewsReel === "function") {
      stopActiveNewsReel();
      stopActiveNewsReel = null;
    }
    const project = projectMatch || getProjectById(item.projectId);
    const modal = ensureGlobalModal();

    modal.innerHTML = `
      <div class="modal-panel" style="max-width:860px;">
        <div class="modal-top-bar">
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="news-tag">${item.tag}</span>
            <span class="mono" style="font-size:0.72rem;color:var(--fg-muted);">${item.date}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">Fechar</button>
        </div>
        <div class="modal-media" id="news-modal-media">
          <img src="${item.image}" alt="${item.title}" />
        </div>
        <div style="padding:28px 32px;display:flex;flex-direction:column;gap:16px;">
          <h2 style="font-family:var(--font-display);font-size:1.75rem;line-height:1.2;">${item.title}</h2>
          <p style="color:var(--fg-soft);font-size:1rem;line-height:1.7;">${item.fullText}</p>
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">
            <a href="projeto.html?id=${encodeURIComponent(project.id)}" class="btn btn-primary">
              Projeto
            </a>
            <a href="portfolio.html" class="btn btn-ghost">Galeria</a>
          </div>
        </div>
      </div>
    `;

    stopActiveNewsReel = mountProjectTakeReel(
      document.getElementById("news-modal-media"),
      item.projectId,
      item.image,
      item.title
    );

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    document.getElementById("modal-close-btn").onclick = closeModal;
  }

  // =========================================================================
  // 3. HOME PAGE (NOTÍCIAS TOPO + GALERIA INTERATIVA + CAPAS)
  // =========================================================================
  function initHomePage() {
    const tickerEl = document.getElementById("news-ticker-items");
    const latestGridEl = document.getElementById("hero-latest-projects");
    const heroFeatureEl = document.getElementById("hero-featured-news");
    const newsGridEl = document.getElementById("news-grid");
    const galleryFiltersEl = document.getElementById("gallery-filters");
    const galleryGridEl = document.getElementById("interactive-gallery-grid");

    if (tickerEl) {
      tickerEl.innerHTML = window.AWA_NEWS.map(
        (n) => `
        <span class="ticker-item" data-news-id="${n.id}">
          <span class="ticker-dot"></span>
          <strong style="color:var(--fg);">${n.date}</strong> · ${n.title}
        </span>`
      ).join("");

      tickerEl.querySelectorAll("[data-news-id]").forEach((el) => {
        el.addEventListener("click", () => openNewsModal(el.dataset.newsId));
      });
    }

    if (latestGridEl) {
      const randomProjects = shuffleArray(window.AWA_PROJECTS || []).slice(0, 3).map((proj) => {
        const newsMatch = (window.AWA_NEWS || []).find((n) => n.projectId === proj.id);
        return {
          modalKey: newsMatch ? newsMatch.id : proj.id,
          projectId: proj.id,
          tag: newsMatch ? newsMatch.tag : proj.category,
          date: proj.year,
          title: newsMatch ? newsMatch.title : proj.title,
          excerpt: newsMatch ? newsMatch.excerpt : proj.logline,
          image: newsMatch ? newsMatch.image : proj.coverImage
        };
      });
      if (randomProjects.length) {
        latestGridEl.innerHTML = randomProjects
          .map(
            (item, idx) => `
          <article class="hero-featured-card" data-news-id="${item.modalKey}" tabindex="0">
            <div class="hero-featured-media" id="hero-featured-media-${idx}">
              <img src="${item.image}" alt="${item.title}" />
            </div>
            <div class="hero-featured-body">
              <div style="display:flex;flex-direction:column;gap:10px;">
                <div class="news-meta-row">
                  <span class="news-tag">${item.tag}</span>
                  <span>${item.date}</span>
                </div>
                <h2 style="font-family:var(--font-display);font-size:1.15rem;font-weight:500;line-height:1.28;">${item.title}</h2>
                <p style="color:var(--fg-muted);font-size:0.86rem;line-height:1.55;">${item.excerpt}</p>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid var(--border);">
                <span class="mono" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;">Projeto</span>
                <span>→</span>
              </div>
            </div>
          </article>`
          )
          .join("");

        randomProjects.forEach((item, idx) => {
          mountProjectTakeReel(
            document.getElementById(`hero-featured-media-${idx}`),
            item.projectId,
            item.image,
            item.title
          );
        });

        latestGridEl.querySelectorAll("[data-news-id]").forEach((card) => {
          card.addEventListener("click", () => openNewsModal(card.dataset.newsId));
          card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openNewsModal(card.dataset.newsId);
            }
          });
        });
      } else {
        latestGridEl.innerHTML = `
          <article class="hero-featured-card" style="grid-column: 1 / -1;">
            <div class="hero-featured-body" style="justify-content:center;align-items:flex-start;min-height:220px;">
              <span class="news-tag">EM BREVE</span>
              <h2 style="font-family:var(--font-display);font-size:1.35rem;font-weight:500;">Novo acervo ÀWA em ingestão</h2>
              <p style="color:var(--fg-muted);font-size:0.92rem;">Os primeiros trabalhos e projetos oficiais estão sendo catalogados direto do DaVinci Resolve Studio.</p>
            </div>
          </article>
        `;
      }
    }

    if (heroFeatureEl) {
      if (window.AWA_NEWS.length) {
        const lead = window.AWA_NEWS[0];
        heroFeatureEl.innerHTML = `
          <div class="hero-featured-media" id="hero-featured-media">
            <img src="${lead.image}" alt="${lead.title}" />
          </div>
          <div class="hero-featured-body">
            <div class="news-meta-row">
              <span class="news-tag">${lead.tag} · DESTAQUE RECENTE</span>
              <span>${lead.date}</span>
            </div>
            <h2 style="font-family:var(--font-display);font-size:1.35rem;font-weight:500;line-height:1.28;">${lead.title}</h2>
            <p style="color:var(--fg-muted);font-size:0.9rem;">${lead.excerpt}</p>
            <div style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid var(--border);">
              <span class="mono" style="font-size:0.7rem;letter-spacing:0.14em;text-transform:uppercase;">Ler</span>
              <span>→</span>
            </div>
          </div>
        `;
        mountProjectTakeReel(
          document.getElementById("hero-featured-media"),
          lead.projectId,
          lead.image,
          lead.title
        );
        heroFeatureEl.addEventListener("click", () => openNewsModal(lead.id));
      } else {
        heroFeatureEl.innerHTML = `
          <div class="hero-featured-body" style="justify-content:center;align-items:flex-start;min-height:280px;">
            <span class="news-tag">EM BREVE</span>
            <h2 style="font-family:var(--font-display);font-size:1.35rem;font-weight:500;">Novo acervo ÀWA em ingestão</h2>
            <p style="color:var(--fg-muted);font-size:0.92rem;">Os primeiros trabalhos e projetos oficiais estão sendo catalogados direto do DaVinci Resolve Studio.</p>
          </div>
        `;
      }
    }

    if (newsGridEl) {
      newsGridEl.innerHTML = window.AWA_NEWS.slice(1, 4)
        .map(
          (n) => `
        <article class="news-card" data-news-id="${n.id}">
          <div>
            <div class="news-meta-row" style="margin-bottom:14px;">
              <span class="news-tag">${n.tag}</span>
              <span>${n.date}</span>
            </div>
            <h3 class="news-card-title">${n.title}</h3>
            <p class="news-card-excerpt" style="margin-top:10px;">${n.excerpt}</p>
          </div>
          <div class="news-card-foot">
            <span>Projeto</span>
            <span>→</span>
          </div>
        </article>`
        )
        .join("");

      newsGridEl.querySelectorAll("[data-news-id]").forEach((el) => {
        el.addEventListener("click", () => openNewsModal(el.dataset.newsId));
      });
    }

    // Galeria Interativa: todas as categorias, enquadramentos e tags existentes em ordem aleatória
    const tagDisplayMap = new Map();
    const addFilterTag = (raw) => {
      const clean = String(raw || "").trim();
      if (!clean || clean === "," || clean === "-" || clean === "—") return;
      const key = norm(clean);
      if (!key || tagDisplayMap.has(key)) return;
      tagDisplayMap.set(key, clean);
    };

    (window.AWA_SHOTS || []).forEach((s) => {
      addFilterTag(s.category);
      addFilterTag(s.enquadramento);
      (s.tags || []).forEach(addFilterTag);
    });

    const allFilterTags = shuffleArray(Array.from(tagDisplayMap.values()));
    const INITIAL_TAG_LIMIT = 14;
    let showAllTags = false;
    let activeTag = "Todos";

    function shotMatchesTag(shot, tag) {
      if (tag === "Todos") return true;
      const target = norm(tag);
      if (norm(shot.category) === target || norm(shot.enquadramento) === target) return true;
      return (shot.tags || []).some((t) => norm(t) === target);
    }

    function renderGallery() {
      const basePool =
        activeTag === "Todos"
          ? window.AWA_SHOTS
          : (window.AWA_SHOTS || []).filter((s) => shotMatchesTag(s, activeTag));
      const filtered = shuffleArray(basePool).slice(0, 8);

      if (!filtered.length) {
        galleryGridEl.className = "interactive-gallery-grid";
        galleryGridEl.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <img src="${cfg.assets.simbolo}" alt="" style="width:36px;opacity:0.4;" />
            <p style="color:var(--fg-muted);">Acervo zerado — aguardando a publicação dos primeiros takes oficiais.</p>
          </div>`;
        return;
      }

      const w = window.innerWidth;
      const maxCols = w >= 1400 ? 4 : w >= 900 ? 3 : 2;
      const numCols = Math.min(maxCols, filtered.length);
      const cols = Array.from({ length: numCols }, () => []);
      filtered.forEach((shot, i) => cols[i % numCols].push(shot));

      galleryGridEl.className = "eyecandy-masonry";
      galleryGridEl.innerHTML = cols
        .map(
          (colShots) => `
        <div class="eyecandy-masonry-col">
          ${colShots
            .map((shot) => {
              const project = getProjectById(shot.projectId);
              const aspectStyle = shot.aspect ? `aspect-ratio:${shot.aspect};` : "aspect-ratio:16 / 9;";
              return `
              <article class="video-masonry-card" data-shot-id="${shot.id}" style="${aspectStyle}" tabindex="0" aria-label="${shot.title} — ${project ? project.title : ""}">
                ${
                  shot.video
                    ? `<video data-src="${shot.video}" poster="${shot.image}" style="background:#000 url('${shot.image}') center/cover no-repeat;" autoplay loop muted playsinline webkit-playsinline preload="metadata"></video>`
                    : `<img src="${shot.image}" alt="${shot.title}" loading="lazy" />`
                }
                <div class="video-masonry-hover">
                  ${renderHoverMeta(project)}
                </div>
              </article>`;
            })
            .join("")}
        </div>`
        )
        .join("");

      galleryGridEl.querySelectorAll("[data-shot-id]").forEach((tile) => {
        tile.addEventListener("click", () => openShotModal(tile.dataset.shotId, filtered));
      });
      attachViewportVideoObserver(galleryGridEl);
    }

    if (galleryFiltersEl && galleryGridEl) {
      function renderGalleryFilters() {
        const visibleTags = showAllTags ? allFilterTags : allFilterTags.slice(0, INITIAL_TAG_LIMIT);
        const pillList = ["Todos", ...visibleTags];
        if (activeTag !== "Todos" && !pillList.includes(activeTag)) {
          pillList.push(activeTag);
        }

        const pillsHtml = pillList
          .map((tag) => {
            const safeTag = tag.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
            return `
          <button type="button" class="filter-pill ${tag === activeTag ? "active" : ""}" data-tag="${safeTag}">
            ${safeTag}
          </button>`;
          })
          .join("");

        const toggleHtml =
          allFilterTags.length > INITIAL_TAG_LIMIT
            ? `<button type="button" class="filter-pill" id="gallery-toggle-tags" style="border-style:dashed;color:var(--fg);">
                ${showAllTags ? "Mostrar menos" : `Ver todas (${allFilterTags.length}) +`}
              </button>`
            : "";

        galleryFiltersEl.innerHTML = pillsHtml + toggleHtml;

        galleryFiltersEl.querySelectorAll("[data-tag]").forEach((btn) => {
          btn.addEventListener("click", () => {
            activeTag = btn.dataset.tag;
            renderGalleryFilters();
            renderGallery();
          });
        });

        const toggleBtn = document.getElementById("gallery-toggle-tags");
        if (toggleBtn) {
          toggleBtn.addEventListener("click", () => {
            showAllTags = !showAllTags;
            renderGalleryFilters();
          });
        }
      }

      renderGalleryFilters();
      renderGallery();
    }
  }

  // =========================================================================
  // 4. PORTFÓLIO EM VÍDEO / SHOTDECK (ESTILO EYECANDY + BUSCA GOOGLE)
  // =========================================================================
  function initPortfolioPage() {
    const searchInput = document.getElementById("shotdeck-search-input");
    const clearBtn = document.getElementById("search-clear-btn");
    const suggestionsEl = document.getElementById("search-suggestions");
    const tagCloudEl = document.getElementById("eyecandy-tag-cloud");
    const sortSelectEl = document.getElementById("eyecandy-sort-select");
    const resultsGridEl = document.getElementById("shotdeck-results-grid");
    const resultsCountEl = document.getElementById("results-count");
    const facetFramingEl = document.getElementById("facet-framing");
    const facetCategoryEl = document.getElementById("facet-category");
    const facetCameraEl = document.getElementById("facet-camera");
    const modeTabs = document.querySelectorAll("[data-mode]");

    if (!searchInput || !resultsGridEl) return;

    const params = new URLSearchParams(window.location.search);
    let state = {
      query: params.get("q") || "",
      mode: params.get("mode") || "shots", // "shots" | "projects"
      sort: "shuffle", // "shuffle" | "popular" | "recent" | "title"
      framing: "all",
      category: "all",
      camera: "all"
    };

    searchInput.value = state.query;

    // Placeholder animado estilo Eyecandy
    const placeholderExamples = [
      'Buscar "zenital"...',
      'Buscar "arvoreser"...',
      'Buscar "anamórfica"...',
      'Buscar "silhueta"...',
      'Buscar "preto e branco"...',
      'Buscar "documentário"...'
    ];
    let phIdx = 0;
    setInterval(() => {
      if (document.activeElement !== searchInput && !searchInput.value) {
        phIdx = (phIdx + 1) % placeholderExamples.length;
        searchInput.placeholder = placeholderExamples[phIdx];
      }
    }, 2600);

    // Nuvem randômica de técnicas, categorias & tags reais do acervo (16 termos por carregamento)
    const cloudTagMap = new Map();
    const addCloudTerm = (raw) => {
      const clean = String(raw || "").trim();
      if (!clean || clean === "," || clean === "-" || clean === "—") return;
      const key = norm(clean);
      if (!key || cloudTagMap.has(key)) return;
      cloudTagMap.set(key, clean.toUpperCase());
    };
    (window.AWA_SHOTS || []).forEach((s) => {
      addCloudTerm(s.category);
      addCloudTerm(s.enquadramento);
      (s.tags || []).forEach(addCloudTerm);
    });
    const cloudTerms = shuffleArray(Array.from(cloudTagMap.values())).slice(0, 16);

    // Construir índice de autocompletar
    const suggestionPool = [];
    const seen = new Set();
    function addSug(text, type) {
      const k = norm(text);
      if (!k || seen.has(k)) return;
      seen.add(k);
      suggestionPool.push({ text, type });
    }
    window.AWA_PROJECTS.forEach((p) => {
      addSug(p.title, "Projeto");
      addSug(p.category, "Formato");
      extractCreditNames(p).forEach((name) => addSug(name, "Ficha Técnica"));
    });
    window.AWA_SHOTS.forEach((s) => {
      addSug(s.enquadramento, "Enquadramento");
      addSug(s.lente, "Lente");
      addSug(s.camera, "Câmera");
      addSug(s.title, "Take");
      s.tags.forEach((t) => addSug(t, "Tag"));
    });

    function renderTagCloud() {
      if (!tagCloudEl) return;
      tagCloudEl.innerHTML = cloudTerms
        .map((t) => {
          const safeDisplay = t.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          const safeQuery = t.toLowerCase().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          return `
        <button type="button" class="cloud-tag-btn ${norm(state.query) === norm(t) ? "active" : ""}" data-q="${safeQuery}">
          ${safeDisplay}
        </button>`;
        })
        .join("");

      tagCloudEl.querySelectorAll("[data-q]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.query = norm(state.query) === norm(btn.dataset.q) ? "" : btn.dataset.q;
          searchInput.value = state.query;
          renderAll();
        });
      });
    }

    function renderSuggestions() {
      const q = state.query.trim();
      if (!q || document.activeElement !== searchInput) {
        suggestionsEl.classList.remove("open");
        return;
      }
      const matches = suggestionPool.filter((s) => matchQuery(s.text, q)).slice(0, 7);
      if (!matches.length) {
        suggestionsEl.classList.remove("open");
        return;
      }
      suggestionsEl.innerHTML = matches
        .map(
          (m) => `
        <div class="suggestion-row" data-sug="${m.text}">
          <span>${m.text}</span>
          <span class="suggestion-type">${m.type}</span>
        </div>`
        )
        .join("");
      suggestionsEl.classList.add("open");

      suggestionsEl.querySelectorAll("[data-sug]").forEach((row) => {
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          state.query = row.dataset.sug;
          searchInput.value = state.query;
          suggestionsEl.classList.remove("open");
          renderAll();
        });
      });
    }

    function sortList(items) {
      const copy = [...items];
      if (state.sort === "popular") {
        copy.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      } else if (state.sort === "recent") {
        copy.sort((a, b) => (b.addedOrder || 0) - (a.addedOrder || 0));
      } else if (state.sort === "title") {
        copy.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
      } else if (state.sort === "shuffle") {
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
      }
      return copy;
    }

    function renderResults() {
      clearBtn.classList.toggle("visible", state.query.length > 0);
      modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === state.mode));

      if (state.mode === "shots") {
        resultsGridEl.className = "eyecandy-masonry";

        const filtered = sortList(
          window.AWA_SHOTS.filter((shot) => {
            const proj = getProjectById(shot.projectId);
            const searchBlob = [
              shot.title,
              shot.enquadramento,
              shot.movimento,
              shot.iluminacao,
              shot.lente,
              shot.camera,
              shot.cor,
              shot.notes,
              shot.category,
              proj.title,
              proj.client,
              ...shot.tags
            ].join(" ");

            if (!matchQuery(searchBlob, state.query)) return false;
            if (state.framing !== "all" && norm(shot.enquadramento) !== norm(state.framing)) return false;
            if (state.category !== "all" && norm(shot.category) !== norm(state.category)) return false;
            if (state.camera !== "all" && !norm(shot.camera).includes(norm(state.camera))) return false;
            return true;
          })
        );

        resultsCountEl.textContent = `${filtered.length} ${
          filtered.length === 1 ? "take em vídeo" : "takes em vídeo"
        }${state.query ? ` para "${state.query}"` : ""}`;

        if (!filtered.length) {
          resultsGridEl.className = "shotdeck-grid";
          resultsGridEl.innerHTML = `
            <div class="empty-state">
              <img src="${cfg.assets.simbolo}" alt="" style="width:42px;opacity:0.4;" />
              <h3 style="font-family:var(--font-display);font-size:1.3rem;">Nenhum take encontrado para "${state.query}"</h3>
              <p style="color:var(--fg-muted);max-width:44ch;">Tente buscar por enquadramentos como <strong>zenital</strong>, <strong>arvoreser</strong>, <strong>anamórfica</strong> ou limpe os filtros.</p>
              <button type="button" class="btn btn-ghost btn-sm" id="reset-search-btn">Limpar</button>
            </div>`;
          const resetBtn = document.getElementById("reset-search-btn");
          if (resetBtn) {
            resetBtn.onclick = () => {
              state.query = "";
              state.framing = "all";
              state.category = "all";
              state.camera = "all";
              searchInput.value = "";
              facetFramingEl.value = "all";
              facetCategoryEl.value = "all";
              facetCameraEl.value = "all";
              renderAll();
            };
          }
          return;
        }

        function getMasonryCols() {
          const w = window.innerWidth;
          if (w >= 2000) return 7;
          if (w >= 1600) return 6;
          if (w >= 1200) return 5;
          if (w >= 900) return 4;
          if (w >= 600) return 3;
          return 2;
        }

        const numCols = Math.min(getMasonryCols(), Math.max(1, filtered.length));
        const cols = Array.from({ length: numCols }, () => []);
        filtered.forEach((shot, i) => {
          cols[i % numCols].push(shot);
        });

        resultsGridEl.innerHTML = cols
          .map(
            (colShots) => `
          <div class="eyecandy-masonry-col">
            ${colShots
              .map((shot) => {
                const proj = getProjectById(shot.projectId);
                const aspectStyle = shot.aspect ? `aspect-ratio:${shot.aspect};` : "aspect-ratio:16 / 9;";
                return `
                <article class="video-masonry-card" data-shot-id="${shot.id}" style="${aspectStyle}" tabindex="0" aria-label="${shot.title} — ${proj.title}">
                  ${
                    shot.video
                      ? `<video data-src="${shot.video}" poster="${shot.image}" style="background:#000 url('${shot.image}') center/cover no-repeat;" autoplay loop muted playsinline webkit-playsinline preload="metadata"></video>`
                      : `<img src="${shot.image}" alt="${shot.title}" loading="lazy" />`
                  }
                  <div class="video-masonry-hover">
                    ${renderHoverMeta(proj)}
                  </div>
                </article>`;
              })
              .join("")}
          </div>`
          )
          .join("");

        resultsGridEl.dataset.lastCols = String(numCols);

        resultsGridEl.querySelectorAll("[data-shot-id]").forEach((card) => {
          card.addEventListener("click", () => openShotModal(card.dataset.shotId, filtered));
          card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openShotModal(card.dataset.shotId, filtered);
            }
          });
        });
        attachViewportVideoObserver(resultsGridEl);
      } else {
        // Modo "Trabalhos Completos (Obras)"
        resultsGridEl.className = "shotdeck-grid";
        const filteredProjects = window.AWA_PROJECTS.filter((proj) => {
          const projShots = window.AWA_SHOTS.filter((s) => s.projectId === proj.id);
          const blob = [
            proj.title,
            proj.category,
            proj.client,
            proj.year,
            proj.camera,
            proj.lenses,
            proj.logline,
            proj.synopsis,
            ...extractCreditNames(proj),
            ...projShots.flatMap((s) => [s.enquadramento, ...s.tags])
          ].join(" ");
          if (!matchQuery(blob, state.query)) return false;
          if (state.category !== "all" && norm(proj.category) !== norm(state.category)) return false;
          if (state.camera !== "all" && !norm(proj.camera).includes(norm(state.camera))) return false;
          return true;
        });

        resultsCountEl.textContent = `${filteredProjects.length} ${
          filteredProjects.length === 1 ? "trabalho completo" : "trabalhos completos"
        }${state.query ? ` relacionados a "${state.query}"` : ""}`;

        resultsGridEl.innerHTML = filteredProjects
          .map(
            (proj) => `
          <a href="projeto.html?id=${encodeURIComponent(proj.id)}" class="shot-card">
            <div class="shot-card-media">
              ${
                proj.coverVideo
                  ? `<video src="${proj.coverVideo}" poster="${proj.coverImage}" autoplay loop muted playsinline preload="metadata"></video>`
                  : `<img src="${proj.coverImage}" alt="${proj.title}" loading="lazy" />`
              }
              <div class="shot-card-badges">
                <span class="shot-chip">${proj.category}</span>
                <span class="shot-chip">${proj.year}</span>
              </div>
            </div>
            <div class="shot-card-body">
              <div class="shot-card-project">${proj.client}</div>
              <h3 class="shot-card-title">${proj.title}</h3>
              <p style="color:var(--fg-muted);font-size:0.86rem;line-height:1.5;">${proj.logline}</p>
              ${proj.creditNote ? `<p class="mono" style="color:var(--fg-soft);font-size:0.72rem;line-height:1.45;margin-top:6px;">${proj.creditNote}</p>` : ""}
              <div class="shot-specs-line" style="margin-top:auto;padding-top:8px;">
                <span>${proj.duration}</span>
                <span>·</span>
                <span>${proj.aspectRatio}</span>
                <span>·</span>
                <span style="color:var(--fg);">Projeto →</span>
              </div>
            </div>
          </a>`
          )
          .join("");
      }
    }

    function renderAll() {
      renderTagCloud();
      renderResults();
    }

    searchInput.addEventListener("input", () => {
      state.query = searchInput.value;
      renderAll();
      renderSuggestions();
    });

    searchInput.addEventListener("focus", renderSuggestions);
    searchInput.addEventListener("blur", () => {
      setTimeout(() => suggestionsEl.classList.remove("open"), 150);
    });

    clearBtn.addEventListener("click", () => {
      state.query = "";
      searchInput.value = "";
      searchInput.focus();
      renderAll();
    });

    if (sortSelectEl) {
      sortSelectEl.addEventListener("change", () => {
        state.sort = sortSelectEl.value;
        renderResults();
      });
    }

    modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        state.mode = tab.dataset.mode;
        renderAll();
      });
    });

    facetFramingEl.addEventListener("change", () => {
      state.framing = facetFramingEl.value;
      renderAll();
    });
    facetCategoryEl.addEventListener("change", () => {
      state.category = facetCategoryEl.value;
      renderAll();
    });
    facetCameraEl.addEventListener("change", () => {
      state.camera = facetCameraEl.value;
      renderAll();
    });

    // Atalho "/" para focar na busca
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // Rebalanceia colunas ao redimensionar a janela lateralmente
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - lastWidth) > 40) {
        lastWidth = window.innerWidth;
        if (state.mode === "shots") renderResults();
      }
    });

    renderAll();
  }

  // =========================================================================
  // 5. PÁGINA DO PROJETO (projeto.html?id=...)
  // =========================================================================
  function initProjectPage() {
    const container = document.getElementById("project-detail-root");
    if (!container) return;

    if (!window.AWA_PROJECTS || !window.AWA_PROJECTS.length) {
      container.innerHTML = `
        <section class="page-banner">
          <div class="container">
            <div class="eyebrow">Acervo em Preparação</div>
            <h1 class="page-title">Nenhum projeto publicado ainda</h1>
            <p style="color:var(--fg-muted);margin-bottom:24px;">Assim que você aprovar os primeiros takes, este espaço exibirá a ficha técnica e o vídeo completo da obra.</p>
            <a href="portfolio.html" class="btn btn-primary">Galeria</a>
          </div>
        </section>`;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const focusShotId = params.get("shot");
    const projIdx = window.AWA_PROJECTS.findIndex((p) => p.id === id);
    const project = projIdx >= 0 ? window.AWA_PROJECTS[projIdx] : window.AWA_PROJECTS[0];
    const prevProject = window.AWA_PROJECTS[(projIdx - 1 + window.AWA_PROJECTS.length) % window.AWA_PROJECTS.length];
    const nextProject = window.AWA_PROJECTS[(projIdx + 1) % window.AWA_PROJECTS.length];

    document.title = `${project.title} — ÀWA`;

    const projectShots = window.AWA_SHOTS.filter((s) => s.projectId === project.id);
    const ytId = extractYouTubeId(project.youtubeId || project.youtubeUrl);
    const isVerticalProject = (() => {
      const ar = String(project.aspectRatio || "");
      const ratioMatch = ar.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
      if (ratioMatch && Number(ratioMatch[1]) < Number(ratioMatch[2])) return true;
      const dimMatch = ar.match(/(\d+)\s*[×x]\s*(\d+)/i);
      if (dimMatch && Number(dimMatch[1]) < Number(dimMatch[2])) return true;
      const firstAspect = String(projectShots[0]?.aspect || "").match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      return Boolean(firstAspect && Number(firstAspect[1]) < Number(firstAspect[2]));
    })();

    container.innerHTML = `
      <section class="project-hero">
        <div class="container">
          <div class="eyebrow" style="margin-bottom:14px;">${project.category} · ${project.year} · ${project.status}</div>
          <h1 class="project-title-xl">${project.title}</h1>
          <p style="color:var(--fg-soft);font-size:1.15rem;max-width:60ch;">${project.logline}</p>
        </div>
      </section>

      <section id="filme-completo" style="padding:36px 0 52px;border-bottom:1px solid var(--border);background:var(--surface-1);">
        <div class="container">
          ${
            ytId
              ? `<div class="youtube-player-wrap ${isVerticalProject ? "is-vertical" : ""}">
                  <iframe
                    src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1"
                    title="${project.title}"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                  ></iframe>
                </div>`
              : `<div class="youtube-player-wrap ${isVerticalProject ? "is-vertical" : ""}" id="project-hero-reel"></div>`
          }
        </div>
      </section>

      <section>
        <div class="container project-details-grid">
          <div style="display:flex;flex-direction:column;gap:28px;">
            <div>
              <div class="eyebrow" style="margin-bottom:12px;">Sinopse & Abordagem</div>
              <p style="color:var(--fg-soft);font-size:1.05rem;line-height:1.75;">${project.synopsis}</p>
            </div>
            <div style="border-left:2px solid var(--fg);padding-left:20px;">
              <div class="mono" style="font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:8px;">Nota de Direção & Óptica</div>
              <p style="color:var(--fg);font-size:0.98rem;line-height:1.65;">"${project.directorNote}"</p>
            </div>
            <div>
              <div class="eyebrow" style="margin-bottom:16px;">Créditos de Set (Sistema ÀWA)</div>
              <div class="spec-table">
                ${project.credits
                  .map(
                    (c) => `
                  <div class="spec-row">
                    <span class="spec-label">${c.role}</span>
                    <span class="spec-value">${renderCreditValueLinks(c.name)}</span>
                  </div>`
                  )
                  .join("")}
              </div>
              ${
                project.creditNote
                  ? `<p class="mono" style="margin-top:14px;padding:12px 14px;border:1px solid var(--border);border-left:2px solid var(--fg);background:var(--surface-1);color:var(--fg-soft);font-size:0.78rem;line-height:1.55;">${project.creditNote}</p>`
                  : ""
              }
            </div>
          </div>

          <div>
            <div class="eyebrow" style="margin-bottom:16px;">Especificações Técnicas</div>
            <div class="spec-table">
              <div class="spec-row"><span class="spec-label">Cliente / Produção</span><span class="spec-value">${project.client}</span></div>
              <div class="spec-row"><span class="spec-label">Ano</span><span class="spec-value">${project.year}</span></div>
              <div class="spec-row"><span class="spec-label">Duração</span><span class="spec-value">${project.duration}</span></div>
              <div class="spec-row"><span class="spec-label">Aspect Ratio</span><span class="spec-value">${project.aspectRatio}</span></div>
              <div class="spec-row"><span class="spec-label">Câmera</span><span class="spec-value">${project.camera}</span></div>
              <div class="spec-row"><span class="spec-label">Lentes</span><span class="spec-value">${project.lenses}</span></div>
              <div class="spec-row"><span class="spec-label">Finalização</span><span class="spec-value">${project.format}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section style="padding:56px 0 80px;border-bottom:1px solid var(--border);">
        <div class="container">
          <div class="section-header-bar">
            <div>
              <div class="eyebrow" style="margin-bottom:10px;">Shotdeck da Obra</div>
              <h2 class="section-heading">Takes Indexados deste Projeto (${projectShots.length})</h2>
            </div>
            <a href="portfolio.html?q=${encodeURIComponent(project.title)}" class="btn btn-ghost btn-sm">Galeria</a>
          </div>

          <div class="shotdeck-grid" id="project-shots-grid">
            ${projectShots
              .map(
                (shot) => `
              <article class="shot-card ${focusShotId === shot.id ? "shot-highlight" : ""}" data-shot-id="${shot.id}" id="take-${shot.id}">
                <div class="shot-card-media">
                  ${
                    shot.video
                      ? `<video data-src="${shot.video}" poster="${shot.image}" style="background:#000 url('${shot.image}') center/cover no-repeat;" autoplay loop muted playsinline webkit-playsinline preload="metadata"></video>`
                      : `<img src="${shot.image}" alt="${shot.title}" />`
                  }
                  <div class="shot-card-badges">
                    <span class="shot-chip">${shot.enquadramento}</span>
                    <span class="shot-chip">${shot.timecode}</span>
                  </div>
                </div>
                <div class="shot-card-body">
                  <h3 class="shot-card-title">${shot.title}</h3>
                  <div class="shot-specs-line">${shot.lente} · ${shot.movimento}</div>
                  <p style="font-size:0.84rem;color:var(--fg-muted);">${shot.notes}</p>
                </div>
              </article>`
              )
              .join("")}
          </div>

          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;padding-top:32px;border-top:1px solid var(--border);">
            <a href="projeto.html?id=${encodeURIComponent(prevProject.id)}" class="btn btn-ghost">← Anterior</a>
            <a href="projeto.html?id=${encodeURIComponent(nextProject.id)}" class="btn btn-ghost">Próximo →</a>
          </div>
        </div>
      </section>
    `;

    if (!ytId) {
      mountProjectTakeReel(
        document.getElementById("project-hero-reel"),
        project.id,
        project.coverImage,
        project.title
      );
    }

    container.querySelectorAll("[data-shot-id]").forEach((card) => {
      card.addEventListener("click", () => openShotModal(card.dataset.shotId, projectShots));
    });
    attachViewportVideoObserver(container);

    if (focusShotId) {
      const target = document.getElementById(`take-${focusShotId}`);
      if (target) {
        setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
      }
    }
  }

  // =========================================================================
  // 6. TIME & PARCEIROS (time.html)
  // =========================================================================
  function initTimePage() {
    const teamGrid = document.getElementById("team-grid");
    const variantsWall = document.getElementById("variants-wall");
    const partnersGrid = document.getElementById("partners-grid");

    if (teamGrid) {
      teamGrid.innerHTML = window.AWA_TEAM.map(
        (m) => `
        <article class="team-card">
          <div class="team-card-photo">
            <img src="${m.image}" alt="${m.name}" loading="lazy" />
          </div>
          <div class="team-card-body">
            <span class="set-badge">${m.badge}</span>
            <h3 style="font-family:var(--font-display);font-size:1.25rem;font-weight:500;">${m.name}</h3>
            <p style="color:var(--fg-muted);font-size:0.9rem;line-height:1.6;">${m.bio}</p>
          </div>
        </article>`
      ).join("");
    }

    if (variantsWall) {
      variantsWall.innerHTML = window.AWA_SET_VARIANTS.map(
        (v) => `
        <div class="variant-cell">
          <img src="${cfg.assets.tipografia}" alt="ÀWA" />
          <div class="variant-role">${v.label}</div>
          <div class="variant-dept">${v.dept}</div>
        </div>`
      ).join("");
    }

    if (partnersGrid) {
      partnersGrid.innerHTML = window.AWA_PARTNERS.map(
        (p) => `
        <article class="partner-card">
          <div>
            <div class="mono" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:10px;">
              ${p.type} · ${p.city}
            </div>
            <h3 style="font-family:var(--font-display);font-size:1.25rem;font-weight:500;margin-bottom:10px;">${p.name}</h3>
            <p style="color:var(--fg-muted);font-size:0.9rem;line-height:1.6;">${p.desc}</p>
          </div>
          <div class="mono" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--fg-dim);">
            Aliança Técnica Ativa
          </div>
        </article>`
      ).join("");
    }
  }

  // =========================================================================
  // 7. CLIENTES & PROJETOS (clientes.html)
  // =========================================================================
  function initClientesPage() {
    const clientsWall = document.getElementById("clients-wall");
    const projectsTableBody = document.getElementById("projects-index-body");
    const categoryFilterBar = document.getElementById("clientes-category-filters");
    if (!clientsWall || !projectsTableBody) return;

    let activeFilter = "Todos";
    const cats = ["Todos", "Show Ao Vivo", "Ficção", "Documentário", "Videoclipe", "Publicidade", "Bastidores"];

    clientsWall.innerHTML = window.AWA_CLIENTS.map(
      (c) => `
      <a href="projeto.html?id=${encodeURIComponent(c.projectId)}" class="client-tile">
        <div>
          <div class="mono" style="font-size:0.68rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:10px;">
            ${c.sector}
          </div>
          <h3 class="client-name">${c.name}</h3>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:0.7rem;color:var(--fg-soft);">
          <span>${c.projectsCount} · ${c.highlight}</span>
          <span>→</span>
        </div>
      </a>`
    ).join("");

    function renderTable() {
      const list =
        activeFilter === "Todos"
          ? window.AWA_PROJECTS
          : window.AWA_PROJECTS.filter((p) => p.category === activeFilter);

      projectsTableBody.innerHTML = list
        .map(
          (p) => `
        <tr class="projects-index-row" onclick="window.location.href='projeto.html?id=${encodeURIComponent(p.id)}'">
          <td class="mono" style="font-size:0.8rem;color:var(--fg-muted);">${p.year}</td>
          <td>
            <div style="font-family:var(--font-display);font-size:1.1rem;font-weight:500;">${p.title}</div>
            <div class="mono" style="font-size:0.68rem;color:var(--fg-dim);margin-top:3px;">${p.camera} · ${p.aspectRatio}</div>
          </td>
          <td class="hide-mobile" style="color:var(--fg-soft);font-size:0.92rem;">${p.client}</td>
          <td><span class="news-tag">${p.category}</span></td>
          <td class="hide-mobile" style="color:var(--fg-muted);font-size:0.86rem;">${p.status}</td>
          <td class="mono" style="text-align:right;font-size:0.78rem;">Ver →</td>
        </tr>`
        )
        .join("");
    }

    if (categoryFilterBar) {
      categoryFilterBar.innerHTML = cats
        .map(
          (c) =>
            `<button type="button" class="filter-pill ${c === activeFilter ? "active" : ""}" data-cat="${c}">${c}</button>`
        )
        .join("");

      categoryFilterBar.querySelectorAll("[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeFilter = btn.dataset.cat;
          categoryFilterBar.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          renderTable();
        });
      });
    }

    renderTable();
  }

  // =========================================================================
  // 8. CONTATO — CHAT INTERATIVO DIRETO PARA O WHATSAPP (contato.html)
  // =========================================================================
  function initContactChat() {
    const messagesEl = document.getElementById("chat-messages");
    const quickRepliesEl = document.getElementById("chat-quick-replies");
    const formEl = document.getElementById("chat-form");
    const inputEl = document.getElementById("chat-input");
    const summaryWrapEl = document.getElementById("email-summary-wrap");
    const resetChatBtn = document.getElementById("reset-chat-btn");

    if (!messagesEl || !formEl || !inputEl) return;

    const params = new URLSearchParams(window.location.search);
    const preSubject = params.get("assunto");

    const chatData = {
      name: "",
      projectType: preSubject || "",
      brief: ""
    };

    const steps = [
      {
        key: "name",
        prompt: "Olá! Aqui é a mesa de direção da ÀWA. Como podemos te chamar (seu nome ou produtora)?",
        placeholder: "Digite aqui sua mensagem",
        quick: []
      },
      {
        key: "projectType",
        prompt: (d) => `Prazer, ${d.name}. Sobre qual formato ou frente você gostaria de conversar?`,
        placeholder: "Escolha uma opção ou escreva o tipo de projeto...",
        quick: ["Ficção / Curta ou Longa", "Documentário", "Videoclipe / Filme-Álbum", "Publicidade", "Coprodução / Orçamento"]
      },
      {
        key: "brief",
        prompt: "Agora conte em poucas linhas a ideia, janela de gravação ou referência visual que você imagina:",
        placeholder: "Descreva seu projeto, prazos ou dúvidas...",
        quick: ["Já tenho roteiro / tratamento", "Quero desenvolver do zero com a ÀWA", "Cotação de diária / equipe"]
      }
    ];

    let stepIndex = 0;

    function addBubble(sender, text) {
      const div = document.createElement("div");
      div.className = `chat-msg ${sender}`;
      div.innerHTML = `
        <div class="chat-msg-meta">${sender === "awa" ? "ÀWA · DIREÇÃO" : "VOCÊ"}</div>
        <div>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      `;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderQuickReplies(options) {
      quickRepliesEl.innerHTML = (options || [])
        .map((opt) => `<button type="button" class="quick-tag" data-reply="${opt}">${opt}</button>`)
        .join("");

      quickRepliesEl.querySelectorAll("[data-reply]").forEach((btn) => {
        btn.addEventListener("click", () => handleUserAnswer(btn.dataset.reply));
      });
    }

    function compileEmailSummary() {
      const subject = `[Site ÀWA] ${chatData.projectType || "Novo Contato"} — ${chatData.name}`;
      const body = [
        `Olá equipe ÀWA,`,
        ``,
        `Nome / Organização: ${chatData.name}`,
        `Formato / Assunto: ${chatData.projectType}`,
        ``,
        `Mensagem / Briefing:`,
        `${chatData.brief}`,
        ``,
        `---`,
        `Enviado via Chat Direto do Site ÀWA`
      ].join("\n");

      const whatsappDigits = (cfg.whatsapp || "").replace(/\D/g, "");
      const whatsappHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(body)}`
        : `https://wa.me/?text=${encodeURIComponent(body)}`;

      summaryWrapEl.innerHTML = `
        <div class="email-summary-box">
          <div class="news-meta-row" style="margin-bottom:12px;">
            <span class="news-tag">PRONTO PARA ENVIAR</span>
            <span>WHATSAPP</span>
          </div>
          <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--fg-soft);margin-bottom:12px;">
            <strong>Assunto:</strong> ${subject}
          </div>
          <pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:0.76rem;color:var(--fg-muted);background:var(--surface-2);padding:14px;border:1px solid var(--border);margin-bottom:16px;line-height:1.55;">${body}</pre>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <a href="${whatsappHref}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" id="open-whatsapp-btn">
              Enviar pelo WhatsApp
            </a>
            <button type="button" class="btn btn-ghost" id="copy-brief-btn">
              Copiar
            </button>
          </div>
        </div>
      `;

      const copyBtn = document.getElementById("copy-brief-btn");
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard?.writeText(body);
          copyBtn.textContent = "Copiado ✓";
          setTimeout(() => (copyBtn.textContent = "Copiar"), 2000);
        };
      }
    }

    function promptCurrentStep() {
      if (stepIndex >= steps.length) {
        addBubble(
          "awa",
          `Perfeito, ${chatData.name}! Compilei toda a nossa conversa abaixo. Clique em "Enviar pelo WhatsApp".`
        );
        renderQuickReplies([]);
        inputEl.placeholder = "Deseja acrescentar mais algum detalhe à mensagem?";
        compileEmailSummary();
        return;
      }

      const step = steps[stepIndex];
      const msgText = typeof step.prompt === "function" ? step.prompt(chatData) : step.prompt;
      addBubble("awa", msgText);
      inputEl.placeholder = step.placeholder;
      renderQuickReplies(step.quick);
    }

    function handleUserAnswer(val) {
      const clean = (val || "").trim();
      if (!clean) return;
      addBubble("user", clean);
      inputEl.value = "";

      if (stepIndex < steps.length) {
        const key = steps[stepIndex].key;
        chatData[key] = clean;
        stepIndex += 1;
        setTimeout(promptCurrentStep, 220);
      } else {
        // Mensagens extras depois de concluído são anexadas ao briefing
        chatData.brief += `\n+ Complemento: ${clean}`;
        compileEmailSummary();
        addBubble("awa", 'Adicionado à mensagem! Você já pode clicar em "Enviar pelo WhatsApp".');
      }
    }

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      handleUserAnswer(inputEl.value);
    });

    function startChat() {
      messagesEl.innerHTML = "";
      summaryWrapEl.innerHTML = "";
      stepIndex = 0;
      chatData.name = "";
      chatData.senderEmail = "";
      chatData.projectType = preSubject || "";
      chatData.brief = "";
      promptCurrentStep();
    }

    if (resetChatBtn) resetChatBtn.addEventListener("click", startChat);
    startChat();
  }

  // Boot
  document.addEventListener("DOMContentLoaded", () => {
    enrichShotsWithCreditTags();
    renderLayoutChrome();
    const page = document.body.dataset.page;
    if (page === "home") initHomePage();
    if (page === "portfolio") initPortfolioPage();
    if (page === "projeto") initProjectPage();
    if (page === "time") initTimePage();
    if (page === "clientes") initClientesPage();
    if (page === "contato") initContactChat();
  });
})();
