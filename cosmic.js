// ============================================================
//  COSMIC RAYS — Animated Background Canvas
//  Shoots gentle light streaks across a dark sky with
//  drifting star particles and subtle nebula pulses.
// ============================================================
(function () {
  const canvas = document.getElementById('cosmic-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H;
  const ACCENT = { r: 61, g: 92, b: 255 };   // digital blue
  const TEAL   = { r: 0,  g: 230, b: 153 };   // green accent
  const WARM   = { r: 255, g: 184, b: 0 };    // yellow accent

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── STAR FIELD ───────────────────────────────────
  const STAR_COUNT = 90;
  const stars = [];

  function spawnStar() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.3,
      alpha: Math.random() * 0.5 + 0.2,
      pulse: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.003 + 0.001,
    };
  }
  for (let i = 0; i < STAR_COUNT; i++) stars.push(spawnStar());

  function drawStars(t) {
    stars.forEach(s => {
      const a = s.alpha + Math.sin(t * s.speed + s.pulse) * 0.2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, a)})`;
      ctx.fill();
    });
  }

  // ─── COSMIC RAYS (SHOOTING STREAKS) ──────────────
  const MAX_RAYS = 4;
  const rays = [];

  function randomColor() {
    const colors = [ACCENT, TEAL, WARM];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function spawnRay() {
    const c = randomColor();
    const angle = (Math.random() * 40 + 10) * (Math.PI / 180) * (Math.random() < 0.5 ? 1 : -1);
    const side = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
    let x, y;
    if (side === 0)      { x = Math.random() * W; y = -20; }
    else if (side === 1) { x = W + 20;  y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + 20; }
    else                 { x = -20;     y = Math.random() * H; }

    const speed = Math.random() * 3 + 2;
    const dx = Math.cos(angle) * speed * (side === 1 || side === 0 ? -1 : 1);
    const dy = Math.sin(angle) * speed * (side === 0 || side === 3 ? 1 : -1);

    return {
      x, y, dx, dy, c,
      len: Math.random() * 180 + 120,
      alpha: Math.random() * 0.18 + 0.05,
      width: Math.random() * 1.5 + 0.5,
      life: 0,
      maxLife: Math.random() * 300 + 200,
    };
  }

  function updateRays() {
    if (rays.length < MAX_RAYS && Math.random() < 0.008) {
      rays.push(spawnRay());
    }
    for (let i = rays.length - 1; i >= 0; i--) {
      const r = rays[i];
      r.x += r.dx;
      r.y += r.dy;
      r.life++;
      if (r.life > r.maxLife || r.x < -300 || r.x > W + 300 || r.y < -300 || r.y > H + 300) {
        rays.splice(i, 1);
      }
    }
  }

  function drawRays() {
    rays.forEach(r => {
      const fadeIn  = Math.min(1, r.life / 30);
      const fadeOut = Math.min(1, (r.maxLife - r.life) / 60);
      const a = r.alpha * fadeIn * fadeOut;

      const ex = r.x - (r.dx / Math.hypot(r.dx, r.dy)) * r.len;
      const ey = r.y - (r.dy / Math.hypot(r.dx, r.dy)) * r.len;

      const grad = ctx.createLinearGradient(r.x, r.y, ex, ey);
      grad.addColorStop(0, `rgba(${r.c.r}, ${r.c.g}, ${r.c.b}, ${a})`);
      grad.addColorStop(1, `rgba(${r.c.r}, ${r.c.g}, ${r.c.b}, 0)`);

      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = grad;
      ctx.lineWidth = r.width;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Glow halo at head
      const glow = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 8);
      glow.addColorStop(0, `rgba(${r.c.r}, ${r.c.g}, ${r.c.b}, ${a * 1.8})`);
      glow.addColorStop(1, `rgba(${r.c.r}, ${r.c.g}, ${r.c.b}, 0)`);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    });
  }

  // ─── NEBULA CLOUDS (slow drifting orbs) ──────────
  const nebulae = [
    { x: 0.15, y: 0.2,  r: 250, c: ACCENT, alpha: 0.03, phase: 0 },
    { x: 0.85, y: 0.8,  r: 300, c: TEAL,   alpha: 0.025, phase: 2 },
    { x: 0.5,  y: 0.5,  r: 350, c: ACCENT, alpha: 0.02,  phase: 4 },
  ];

  function drawNebulae(t) {
    nebulae.forEach(n => {
      const cx = n.x * W + Math.sin(t * 0.0003 + n.phase) * 40;
      const cy = n.y * H + Math.cos(t * 0.0002 + n.phase) * 30;
      const pulse = n.alpha + Math.sin(t * 0.0008 + n.phase) * 0.008;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, n.r);
      grad.addColorStop(0, `rgba(${n.c.r}, ${n.c.g}, ${n.c.b}, ${pulse})`);
      grad.addColorStop(1, `rgba(${n.c.r}, ${n.c.g}, ${n.c.b}, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, n.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });
  }

  // ─── MOUSE INTERACTION ───────────────────────────
  let mouse = { x: -9999, y: -9999 };
  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

  function drawMouseGlow() {
    if (mouse.x < 0) return;
    const grad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 180);
    grad.addColorStop(0, `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.06)`);
    grad.addColorStop(1, `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0)`);
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 180, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ─── MAIN LOOP ───────────────────────────────────
  let frame = 0;
  function animate() {
    frame++;
    ctx.clearRect(0, 0, W, H);

    drawNebulae(frame);
    drawStars(frame);
    updateRays();
    drawRays();
    drawMouseGlow();

    requestAnimationFrame(animate);
  }

  // Reduce activity when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resize();
  });

  animate();
})();
