/* ==========================================================================
   PARTICLES.JS — optional animated backgrounds
   ========================================================================== */

const BG_STORAGE_KEY = "mc_background";
let bgCanvas = null;
let bgCtx = null;
let bgAnimId = null;
let bgParticles = [];
let bgMode = "default";

function getThemeColor(varName, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const bigint = parseInt(full, 16);
  if (isNaN(bigint)) return `rgba(27, 73, 101, ${alpha})`;
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ensureCanvas() {
  bgCanvas = document.getElementById("bgCanvas");
  if (!bgCanvas) {
    bgCanvas = document.createElement("canvas");
    bgCanvas.id = "bgCanvas";
    document.body.prepend(bgCanvas);
  }
  bgCtx = bgCanvas.getContext("2d");
  resizeCanvas();
}

function resizeCanvas() {
  if (!bgCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  bgCanvas.width = window.innerWidth * dpr;
  bgCanvas.height = window.innerHeight * dpr;
  bgCanvas.style.width = window.innerWidth + "px";
  bgCanvas.style.height = window.innerHeight + "px";
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initParticles();
}

function initParticles() {
  const area = window.innerWidth * window.innerHeight;
  const count = Math.max(20, Math.min(90, Math.round(area / 18000)));
  bgParticles = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 1.8 + 1,
  }));
}

function stepFrame() {
  if (!bgCtx) return;
  const bg = getThemeColor("--color-bg", "#f5f7f6");
  const primary = getThemeColor("--color-brand-primary", "#1b4965");
  const secondary = getThemeColor("--color-brand-secondary", "#d4a62a");

  bgCtx.fillStyle = bg;
  bgCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  bgParticles.forEach((p, i) => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
    if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;

    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = hexToRgba(i % 3 === 0 ? secondary : primary, 0.5);
    bgCtx.fill();

    if (bgMode === "lines") {
      for (let j = i + 1; j < bgParticles.length; j++) {
        const q = bgParticles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          bgCtx.beginPath();
          bgCtx.moveTo(p.x, p.y);
          bgCtx.lineTo(q.x, q.y);
          bgCtx.strokeStyle = hexToRgba(primary, 0.14 * (1 - dist / 130));
          bgCtx.lineWidth = 1;
          bgCtx.stroke();
        }
      }
    }
  });

  bgAnimId = requestAnimationFrame(stepFrame);
}

function stopAnimation() {
  if (bgAnimId) cancelAnimationFrame(bgAnimId);
  bgAnimId = null;
}

function applyBackground(mode) {
  bgMode = mode;
  document.documentElement.setAttribute("data-bg", mode);
  stopAnimation();
  window.removeEventListener("resize", resizeCanvas);
  if (mode === "default") {
    if (bgCanvas) { bgCanvas.remove(); bgCanvas = null; bgCtx = null; }
    return;
  }
  ensureCanvas();
  window.addEventListener("resize", resizeCanvas);
  stepFrame();
}

function setBackground(mode) {
  localStorage.setItem(BG_STORAGE_KEY, mode);
  applyBackground(mode);
}

function initBackground() {
  const saved = localStorage.getItem(BG_STORAGE_KEY) || "default";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  applyBackground(prefersReducedMotion ? "default" : saved);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimation();
    else if (bgMode !== "default" && bgCtx) stepFrame();
  });
}

document.addEventListener("DOMContentLoaded", initBackground);
