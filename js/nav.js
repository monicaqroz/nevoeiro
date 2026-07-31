// Abre/fecha os submenus (Artigos, Projetos) do menu lateral.
(function () {
  var toggles = document.querySelectorAll('.nav-caret');
  if (!toggles.length) return;

  function fechar(exceto) {
    toggles.forEach(function (btn) {
      if (btn === exceto) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.closest('.nav-item').classList.remove('open');
    });
  }

  toggles.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var item = btn.closest('.nav-item');
      var aberto = item.classList.contains('open');
      fechar(aberto ? null : btn);
      item.classList.toggle('open', !aberto);
      btn.setAttribute('aria-expanded', String(!aberto));
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-item')) fechar();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') fechar();
  });
})();
