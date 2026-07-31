// Coleta METAR do Aeroporto de Manaus (SBEG) via aviationweather.gov e atualiza
// data/estacao-manaus.json. Executado periodicamente pelo workflow
// .github/workflows/atualizar-estacao.yml

const fs = require('fs');
const path = require('path');

const ICAO = 'SBEG';
const URL_FONTE = `https://aviationweather.gov/api/data/metar?ids=${ICAO}&format=json&hours=72`;
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'estacao-manaus.json');
const ARQUIVO_PAGINA = path.join(__dirname, '..', 'projetos', 'manaus-estacao.html');

const COBERTURA = {
  SKC: 'Céu limpo', CLR: 'Céu limpo', CAVOK: 'Céu limpo',
  FEW: 'Poucas nuvens', SCT: 'Parcialmente nublado',
  BKN: 'Nublado', OVC: 'Encoberto', VV: 'Céu obstruído',
};

function umidadeRelativa(tempC, dewpC) {
  const magnus = (t) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.round(100 * (magnus(dewpC) / magnus(tempC)));
}

function visibilidadeKm(visib) {
  if (visib == null) return null;
  const str = String(visib).replace('+', '');
  let num;
  if (str.includes('/')) {
    const [num1, den1] = str.split('/');
    num = parseFloat(num1) / parseFloat(den1); // ex: "1/2"
  } else {
    num = parseFloat(str);
  }
  if (Number.isNaN(num)) return null;
  return Math.round(num * 1.60934 * 10) / 10; // milhas terrestres -> km
}

async function buscarObservacoes() {
  const resp = await fetch(URL_FONTE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NevoeiroBot/1.0)' } });
  if (!resp.ok) throw new Error(`Falha ao buscar METAR: HTTP ${resp.status}`);
  return resp.json();
}

function paraRegistro(obs) {
  const nuvem = obs.clouds && obs.clouds.length ? obs.clouds[obs.clouds.length - 1] : null;
  return {
    hora: new Date(obs.obsTime * 1000).toISOString(),
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
    raw: obs.rawOb,
  };
}

function atualizarPaginaEmbutida(resultado) {
  if (!fs.existsSync(ARQUIVO_PAGINA)) return;
  const html = fs.readFileSync(ARQUIVO_PAGINA, 'utf8');
  const marcador = /(<script id="dados-estacao" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
  if (!marcador.test(html)) {
    console.warn(`Aviso: marcador "dados-estacao" não encontrado em ${ARQUIVO_PAGINA}, pulando.`);
    return;
  }
  const novoHtml = html.replace(marcador, (_, abre, _conteudo, fecha) => (
    abre + JSON.stringify(resultado, null, 2) + fecha
  ));
  fs.writeFileSync(ARQUIVO_PAGINA, novoHtml, 'utf8');
  console.log(`Atualizado: ${ARQUIVO_PAGINA}`);
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

  const porHora = new Map(historicoExistente.map((h) => [h.hora, h]));
  for (const r of novosRegistros) porHora.set(r.hora, r);
  const historico = [...porHora.values()].sort((a, b) => a.hora.localeCompare(b.hora));

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'https://aviationweather.gov/data/metar',
    estacao,
    atual: historico[historico.length - 1],
    historico,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${historico.length} registros, ${resultado.atual.tempC}°C em ${resultado.atual.hora})`);

  atualizarPaginaEmbutida(resultado);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
