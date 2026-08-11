// Coleta estatísticas de acesso do site via API do GoatCounter e atualiza
// data/estatisticas-site.json. Executado periodicamente pelo workflow
// .github/workflows/atualizar-estatisticas.yml
//
// Requer a variável de ambiente GOATCOUNTER_API_TOKEN (secret do GitHub Actions),
// com a permissão "Read statistics" no GoatCounter.

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://nevoeiro.goatcounter.com/api/v0';
const TOKEN = process.env.GOATCOUNTER_API_TOKEN;
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'estatisticas-site.json');
const ARQUIVO_PAGINA = path.join(__dirname, '..', 'estatisticas.html');

const INICIO = '2020-01-01T00:00:00Z';
const LIMITE_DIAS_GRAFICO = 60;

function agoraIso() {
  return new Date().toISOString();
}

async function chamarApi(caminho, params) {
  if (!TOKEN) throw new Error('GOATCOUNTER_API_TOKEN não definido.');
  const url = new URL(BASE_URL + caminho);
  url.searchParams.set('start', INICIO);
  url.searchParams.set('end', agoraIso());
  for (const [chave, valor] of Object.entries(params || {})) {
    url.searchParams.set(chave, String(valor));
  }
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Falha ao chamar ${caminho}: HTTP ${resp.status} ${texto}`);
  }
  return resp.json();
}

async function buscarTotal() {
  const dados = await chamarApi('/stats/total', {});
  const porDia = (dados.stats || [])
    .map((s) => ({ dia: s.day, visitantes: s.daily || 0 }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
  return {
    totalVisitantes: dados.total || 0,
    porDia: porDia.slice(-LIMITE_DIAS_GRAFICO),
  };
}

function limparTexto(texto) {
  // Cliques registrados antes de existir data-goatcounter-title chegam com o
  // HTML interno do elemento como "título" (comportamento padrão do GoatCounter).
  // Remove as tags pra pelo menos sobrar um texto legível nesses registros antigos.
  return (texto || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buscarHits() {
  const dados = await chamarApi('/stats/hits', { limit: 100 });
  const hits = dados.hits || [];

  const paginas = hits
    .filter((h) => !h.event)
    .map((h) => ({ caminho: h.path, titulo: limparTexto(h.title) || h.path, visitantes: h.count }))
    .sort((a, b) => b.visitantes - a.visitantes)
    .slice(0, 10);

  const cliques = hits
    .filter((h) => h.event)
    .map((h) => ({ nome: limparTexto(h.title) || h.path, visitantes: h.count }))
    .sort((a, b) => b.visitantes - a.visitantes)
    .slice(0, 10);

  return { paginas, cliques };
}

async function buscarLista(pagina, limite) {
  const dados = await chamarApi(`/stats/${pagina}`, { limit: limite });
  return (dados.stats || [])
    .map((s) => ({ nome: s.name, visitantes: s.count }))
    .sort((a, b) => b.visitantes - a.visitantes)
    .slice(0, limite);
}

function atualizarPaginaEmbutida(resultado) {
  if (!fs.existsSync(ARQUIVO_PAGINA)) return;
  const html = fs.readFileSync(ARQUIVO_PAGINA, 'utf8');
  const marcador = /(<script id="dados-estatisticas" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
  if (!marcador.test(html)) {
    console.warn(`Aviso: marcador "dados-estatisticas" não encontrado em ${ARQUIVO_PAGINA}, pulando.`);
    return;
  }
  const novoHtml = html.replace(marcador, (_, abre, _conteudo, fecha) => (
    abre + JSON.stringify(resultado, null, 2) + fecha
  ));
  fs.writeFileSync(ARQUIVO_PAGINA, novoHtml, 'utf8');
  console.log(`Atualizado: ${ARQUIVO_PAGINA}`);
}

async function main() {
  const [total, hits, paises, referencias] = await Promise.all([
    buscarTotal(),
    buscarHits(),
    buscarLista('locations', 10),
    buscarLista('toprefs', 10),
  ]);

  const resultado = {
    atualizadoEm: agoraIso(),
    totalVisitantes: total.totalVisitantes,
    porDia: total.porDia,
    paginasMaisVistas: hits.paginas,
    cliquesMaisFrequentes: hits.cliques,
    paises,
    referencias,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${resultado.totalVisitantes} visitantes no total)`);

  atualizarPaginaEmbutida(resultado);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
