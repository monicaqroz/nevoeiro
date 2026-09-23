// Coleta METAR do Aeroporto de Pelotas (SBPK) via aviationweather.gov e atualiza
// data/estacao-pelotas.json. Executado periodicamente pelo workflow
// .github/workflows/atualizar-estacao-pelotas.yml
//
// Espelha scripts/scrape-estacao.js (Manaus/SBEG) — ver ali os comentários
// sobre a lógica de interpretação do METAR.

const fs = require('fs');
const path = require('path');

const ICAO = 'SBPK';
const URL_FONTE = `https://aviationweather.gov/api/data/metar?ids=${ICAO}&format=json&hours=72`;
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'estacao-pelotas.json');
const PAGINAS_EMBUTIDAS = [
  path.join(__dirname, '..', 'projetos', 'pelotas-estacao.html'),
];

function umidadeRelativa(tempC, dewpC) {
  const magnus = (t) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.round(100 * (magnus(dewpC) / magnus(tempC)));
}

const REGEX_GRUPO_TEMPO = /^[-+]?(VC)?((MI|BC|PR|DR|BL|SH|TS|FZ)+(DZ|RA|SN|SG|IC|PL|GR|GS|UP)*|(DZ|RA|SN|SG|IC|PL|GR|GS|UP)+)$/;

function condicaoClima(raw) {
  if (!raw) return { chovendo: false, chuvaNaEstacao: false, condicao: null };
  const grupo = raw.split(' ').find((t) => REGEX_GRUPO_TEMPO.test(t));
  if (!grupo) return { chovendo: false, chuvaNaEstacao: false, condicao: null };

  const naVizinhanca = grupo.includes('VC');
  const intensidade = grupo.startsWith('+') ? 'forte' : grupo.startsWith('-') ? 'fraca' : 'moderada';
  const proximidades = naVizinhanca ? ' nas proximidades' : '';
  let condicao;
  if (grupo.includes('TS')) condicao = `Trovoada com chuva ${intensidade}${proximidades}`;
  else if (grupo.includes('SH')) condicao = `Pancadas de chuva ${intensidade}${proximidades}`;
  else if (grupo.includes('DZ')) condicao = `Garoa ${intensidade}${proximidades}`;
  else condicao = `Chuva ${intensidade}${proximidades}`;

  return { chovendo: true, chuvaNaEstacao: !naVizinhanca, condicao };
}

// Pelotas está em UTC-3 (America/Sao_Paulo, sem horário de verão desde 2019).
function calcularDiasSemChuva(historico) {
  const porDia = new Map();
  for (const r of historico) {
    if (r.chuvaNaEstacao == null) continue;
    const dataLocal = new Date(new Date(r.hora).getTime() - 3 * 60 * 60 * 1000);
    const chave = dataLocal.toISOString().slice(0, 10);
    porDia.set(chave, (porDia.get(chave) || false) || r.chuvaNaEstacao);
  }
  if (!porDia.size) return null;

  const diasOrdenados = [...porDia.keys()].sort();
  const cursor = new Date(`${diasOrdenados[diasOrdenados.length - 1]}T00:00:00Z`);
  let streak = 0;
  while (true) {
    const chave = cursor.toISOString().slice(0, 10);
    if (!porDia.has(chave) || porDia.get(chave)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function visibilidadeKm(visib) {
  if (visib == null) return null;
  const str = String(visib).replace('+', '');
  let num;
  if (str.includes('/')) {
    const [num1, den1] = str.split('/');
    num = parseFloat(num1) / parseFloat(den1);
  } else {
    num = parseFloat(str);
  }
  if (Number.isNaN(num)) return null;
  return Math.round(num * 1.60934 * 10) / 10;
}

async function buscarObservacoes() {
  const resp = await fetch(URL_FONTE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NevoeiroBot/1.0)' } });
  if (!resp.ok) throw new Error(`Falha ao buscar METAR: HTTP ${resp.status}`);
  return resp.json();
}

function paraRegistro(obs) {
  const nuvem = obs.clouds && obs.clouds.length ? obs.clouds[obs.clouds.length - 1] : null;
  const { chovendo, chuvaNaEstacao, condicao } = condicaoClima(obs.rawOb);
  return {
    hora: new Date(obs.obsTime * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tempC: obs.temp,
    orvalhoC: obs.dewp,
    umidade: (obs.temp != null && obs.dewp != null) ? umidadeRelativa(obs.temp, obs.dewp) : null,
    ventoGraus: obs.wdir ?? null,
    ventoKmh: obs.wspd != null ? Math.round(obs.wspd * 1.852) : null,
    pressaoHpa: obs.altim ?? null,
    visibilidadeKm: visibilidadeKm(obs.visib),
    cobertura: obs.cover || null,
    tetoM: nuvem && nuvem.base != null ? Math.round(nuvem.base * 0.3048) : null,
    categoriaVoo: obs.fltCat || null,
    chovendo,
    chuvaNaEstacao,
    condicao,
    raw: obs.rawOb,
  };
}

function atualizarPaginaEmbutida(caminhoPagina, resultado) {
  if (!fs.existsSync(caminhoPagina)) return;
  const html = fs.readFileSync(caminhoPagina, 'utf8');
  const marcador = /(<script id="dados-estacao" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
  if (!marcador.test(html)) {
    console.warn(`Aviso: marcador "dados-estacao" não encontrado em ${caminhoPagina}, pulando.`);
    return;
  }
  const novoHtml = html.replace(marcador, (_, abre, _conteudo, fecha) => (
    abre + JSON.stringify(resultado, null, 2) + fecha
  ));
  fs.writeFileSync(caminhoPagina, novoHtml, 'utf8');
  console.log(`Atualizado: ${caminhoPagina}`);
}

async function main() {
  const observacoes = await buscarObservacoes();
  if (!observacoes.length) throw new Error('Nenhuma observação retornada pela API.');

  const primeira = observacoes[0];
  const estacao = {
    icao: primeira.icaoId,
    nome: primeira.name,
    lat: primeira.lat,
    lon: primeira.lon,
    elevacaoM: primeira.elev,
  };

  const novosRegistros = observacoes.map(paraRegistro);

  let historicoExistente = [];
  if (fs.existsSync(ARQUIVO_DADOS)) {
    historicoExistente = JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8')).historico || [];
  }

  for (const r of historicoExistente) {
    if (r.chuvaNaEstacao == null && r.raw) {
      r.chuvaNaEstacao = condicaoClima(r.raw).chuvaNaEstacao;
    }
  }

  const porHora = new Map(historicoExistente.map((h) => [h.hora, h]));
  for (const r of novosRegistros) porHora.set(r.hora, r);
  const historico = [...porHora.values()].sort((a, b) => a.hora.localeCompare(b.hora));

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'https://aviationweather.gov/data/metar',
    estacao,
    atual: historico[historico.length - 1],
    diasSemChuva: calcularDiasSemChuva(historico),
    historico,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${historico.length} registros, ${resultado.atual.tempC}°C em ${resultado.atual.hora})`);

  for (const pagina of PAGINAS_EMBUTIDAS) atualizarPaginaEmbutida(pagina, resultado);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
