// Move as camadas de névoa lentamente, como nuvens andando pela página.
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  var layers = [
    { el: document.querySelector('.fog-1'), speed: 0.00012, ampX: 140, ampY: 30, phase: 0 },
    { el: document.querySelector('.fog-2'), speed: 0.00016, ampX: 160, ampY: 25, phase: 2.1 },
    { el: document.querySelector('.fog-3'), speed: 0.00010, ampX: 110, ampY: 20, phase: 4.2 },
    { el: document.querySelector('.fog-4'), speed: 0.00014, ampX: 120, ampY: 22, phase: 1.3 }
  ].filter(function (l) { return l.el; });

  if (!layers.length) return;

  function tick(t) {
    layers.forEach(function (l) {
      var x = Math.sin(t * l.speed + l.phase) * l.ampX;
      var y = Math.cos(t * l.speed * 0.8 + l.phase) * l.ampY;
      l.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    });
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
