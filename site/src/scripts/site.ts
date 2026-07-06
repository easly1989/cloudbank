      const root = document.documentElement;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // --- Reveal on scroll (with per-card stagger via --i) --------------------
      const reveals = document.querySelectorAll<HTMLElement>(".reveal");
      if (reduce || !("IntersectionObserver" in window)) {
        reveals.forEach((el) => el.classList.add("in-view"));
      } else {
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                e.target.classList.add("in-view");
                io.unobserve(e.target);
              }
            }
          },
          { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
        );
        reveals.forEach((el) => io.observe(el));
      }

      // --- Scroll progress bar -------------------------------------------------
      const bar = document.getElementById("progress-bar");
      const onScroll = () => {
        const h = document.documentElement;
        const max = h.scrollHeight - h.clientHeight;
        const p = max > 0 ? (h.scrollTop / max) * 100 : 0;
        if (bar) bar.style.width = p + "%";
      };
      document.addEventListener("scroll", onScroll, { passive: true });
      onScroll();

      // --- Active section highlight in the nav ---------------------------------
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("#nav-links a[data-section]"),
      );
      const sections = links
        .map((l) => document.getElementById(l.dataset.section!))
        .filter(Boolean) as HTMLElement[];
      if ("IntersectionObserver" in window && sections.length) {
        const so = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                const id = e.target.id;
                links.forEach((l) => l.classList.toggle("active", l.dataset.section === id));
              }
            }
          },
          { threshold: 0.5 },
        );
        sections.forEach((s) => so.observe(s));
      }

      // --- Count-up stats ------------------------------------------------------
      const counters = document.querySelectorAll<HTMLElement>(".count");
      const runCount = (el: HTMLElement) => {
        const target = Number(el.dataset.count || "0");
        const suffix = el.dataset.suffix || "";
        if (reduce) {
          el.textContent = target + suffix;
          return;
        }
        const start = performance.now();
        const dur = 1100;
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(target * eased) + suffix;
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      if ("IntersectionObserver" in window && counters.length) {
        const co = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                runCount(e.target as HTMLElement);
                co.unobserve(e.target);
              }
            }
          },
          { threshold: 0.6 },
        );
        counters.forEach((c) => co.observe(c));
      } else {
        counters.forEach(runCount);
      }

      // --- Mouse-reactive background: a glow that follows the cursor page-wide,
      // plus subtle parallax on the hero's aurora blobs. ------------------------
      const glow = document.getElementById("cursor-glow");
      const heroBg = document.querySelector<HTMLElement>(".hero-bg");
      if (!reduce && window.matchMedia("(pointer: fine)").matches) {
        let rafId = 0;
        let lastX = 0;
        let lastY = 0;
        const apply = () => {
          rafId = 0;
          if (glow) {
            glow.style.setProperty("--mx", lastX + "px");
            glow.style.setProperty("--my", lastY + "px");
            glow.style.opacity = "1";
          }
          if (heroBg) {
            // Parallax relative to the viewport centre (a few px of drift).
            const dx = (lastX / window.innerWidth - 0.5) * 36;
            const dy = (lastY / window.innerHeight - 0.5) * 36;
            heroBg.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          }
        };
        window.addEventListener(
          "pointermove",
          (e) => {
            lastX = e.clientX;
            lastY = e.clientY;
            if (!rafId) rafId = requestAnimationFrame(apply);
          },
          { passive: true },
        );
      }

      // --- Hero pointer spotlight (desktop, motion-on) -------------------------
      const spotlight = document.getElementById("spotlight");
      const hero = document.getElementById("hero");
      if (spotlight && hero && !reduce && window.matchMedia("(pointer: fine)").matches) {
        hero.addEventListener("pointermove", (e) => {
          const r = hero.getBoundingClientRect();
          spotlight.style.setProperty("--mx", e.clientX - r.left + "px");
          spotlight.style.setProperty("--my", e.clientY - r.top + "px");
          spotlight.style.opacity = "1";
        });
        hero.addEventListener("pointerleave", () => (spotlight.style.opacity = "0"));
      }

      // --- Magnetic buttons ----------------------------------------------------
      if (!reduce && window.matchMedia("(pointer: fine)").matches) {
        document.querySelectorAll<HTMLElement>(".magnetic").forEach((el) => {
          el.addEventListener("pointermove", (e) => {
            const r = el.getBoundingClientRect();
            const mx = e.clientX - r.left - r.width / 2;
            const my = e.clientY - r.top - r.height / 2;
            el.style.transform = `translate(${mx * 0.18}px, ${my * 0.28}px)`;
          });
          el.addEventListener("pointerleave", () => (el.style.transform = ""));
        });
      }

      // --- Theme toggle --------------------------------------------------------
      const themeBtn = document.getElementById("theme-toggle");
      const currentTheme = () => {
        const set = root.getAttribute("data-theme");
        if (set) return set;
        return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      };
      themeBtn?.addEventListener("click", () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try {
          localStorage.setItem("cb-site-theme", next);
        } catch (e) {
          /* ignore */
        }
      });

      // --- Accent picker (recolours the page; mirrors the app) -----------------
      document.querySelectorAll<HTMLButtonElement>(".swatch").forEach((sw) => {
        sw.addEventListener("click", () => {
          try {
            const c = JSON.parse(sw.dataset.accent!);
            root.style.setProperty("--accent", c[0]);
            root.style.setProperty("--accent-2", c[1]);
            root.style.setProperty("--accent-3", c[2]);
            localStorage.setItem("cb-site-accent", JSON.stringify(c));
          } catch (e) {
            /* ignore */
          }
        });
      });

      // --- Mobile nav (hamburger) ----------------------------------------------
      // ≤760px the nav links collapse into a dropdown toggled by the burger.
      const burger = document.getElementById("nav-burger");
      const navEl = document.querySelector<HTMLElement>(".nav");
      if (burger && navEl) {
        const setOpen = (open: boolean) => {
          navEl.classList.toggle("open", open);
          burger.setAttribute("aria-expanded", String(open));
        };
        burger.addEventListener("click", () => setOpen(!navEl.classList.contains("open")));
        // Close after following a link, on Escape, or once back on a wide screen.
        navEl
          .querySelectorAll<HTMLAnchorElement>("#nav-links a")
          .forEach((a) => a.addEventListener("click", () => setOpen(false)));
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape") setOpen(false);
        });
        window.addEventListener("resize", () => {
          if (window.innerWidth > 760) setOpen(false);
        });
      }
