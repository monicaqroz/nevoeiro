// Coleta o perfil do eleitorado do Amazonas via dados abertos do TSE e gera
// data/eleitorado-am.json. Executado periodicamente pelo workflow
// .github/workflows/atualizar-eleitorado.yml
//
// O TSE só publica isso como um ZIP com um CSV por seção eleitoral (não tem
// API de consulta), então o workflow baixa e descompacta o ZIP antes de
// chamar este script — aqui a gente só lê o CSV já extraído.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = process.argv[2] || path.join(__dirname, '..', 'tmp-eleitorado', 'perfil_eleitor_secao_ATUAL_AM.csv');
const URL_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/13/municipios';
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'eleitorado-am.json');
const PAGINA_EMBUTIDA = path.join(__dirname, '..', 'projetos', 'eleitorado-am.html');

// Índices das colunas no CSV do TSE (perfil_eleitor_secao)
const COL = {
  CD_MUNICIPIO: 4, NM_MUNICIPIO: 5, NR_ZONA: 6,
  DS_GENERO: 11, DS_FAIXA_ETARIA: 15, DS_GRAU_INSTRUCAO: 17, DS_COR_RACA: 19,
  QT_ELEITORES: 27, QT_ELEITORES_BIOMETRIA: 28, QT_ELEITORES_DEFICIENCIA: 29,
};

function novoAcumulador() {
  return { total: 0, homens: 0, mulheres: 0, deficiencia: 0, biometria: 0, somaIdade: 0, grau: {}, cor: {}, zonas: new Set() };
}

function midpointFaixa(desc) {
  let m = desc.match(/^(\d+) a (\d+) anos$/);
  if (m) return (Number(m[1]) + Number(m[2])) / 2;
  m = desc.match(/^(\d+) anos$/);
  if (m) return Number(m[1]);
  m = desc.match(/^(\d+) anos ou mais$/);
  if (m) return Number(m[1]) + 2;
  return null;
}

const REGEX_MARCA_COMBINANTE = new RegExp('[̀-ͯ]', 'g');

function normalizarNome(s) {
  return s.normalize('NFD').replace(REGEX_MARCA_COMBINANTE, '').toUpperCase().trim();
}

function parseLinhaCsv(linha) {
  return linha.split(';').map((v) => v.replace(/^"|"$/g, ''));
}

async function buscarJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao buscar ${url}: HTTP ${resp.status}`);
  return resp.json();
}

async function processarCsv() {
  const municipios = new Map(); // CD_MUNICIPIO -> acumulador
  const estado = novoAcumulador();

  const stream = fs.createReadStream(CSV_PATH, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let primeira = true;
  for await (const linha of rl) {
    if (primeira) { primeira = false; continue; } // pula cabeçalho
    if (!linha.trim()) continue;

    const f = parseLinhaCsv(linha);
    const cdMun = f[COL.CD_MUNICIPIO];
    const nmMun = f[COL.NM_MUNICIPIO];
    const nrZona = f[COL.NR_ZONA];
    const genero = f[COL.DS_GENERO];
    const faixa = f[COL.DS_FAIXA_ETARIA];
    const grau = f[COL.DS_GRAU_INSTRUCAO];
    const cor = f[COL.DS_COR_RACA];
    const qt = Number(f[COL.QT_ELEITORES]) || 0;
    const qtBio = Number(f[COL.QT_ELEITORES_BIOMETRIA]) || 0;
    const qtDef = Number(f[COL.QT_ELEITORES_DEFICIENCIA]) || 0;

    if (!municipios.has(cdMun)) municipios.set(cdMun, { nome: nmMun, ...novoAcumulador() });
    const m = municipios.get(cdMun);
    const mid = midpointFaixa(faixa);

    for (const alvo of [m, estado]) {
      alvo.total += qt;
      if (genero === 'MASCULINO') alvo.homens += qt;
      else if (genero === 'FEMININO') alvo.mulheres += qt;
      alvo.deficiencia += qtDef;
      alvo.biometria += qtBio;
      if (mid !== null) alvo.somaIdade += mid * qt;
      alvo.grau[grau] = (alvo.grau[grau] || 0) + qt;
      alvo.cor[cor] = (alvo.cor[cor] || 0) + qt;
    }
    m.zonas.add(nrZona);
    estado.zonas.add(nrZona); // números de zona são únicos no estado (podem servir + de 1 município)
  }

  return { municipios, estado };
}

function grauPredominante(grauObj) {
  return Object.entries(grauObj).sort((a, b) => b[1] - a[1])[0][0];
}

function ordenarCorRaca(corObj) {
  return Object.fromEntries(Object.entries(corObj).sort((a, b) => b[1] - a[1]));
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV não encontrado em ${CSV_PATH}`);

  const [{ municipios, estado }, municipiosIbge] = await Promise.all([
    processarCsv(),
    buscarJson(URL_MUNICIPIOS),
  ]);

  const porNomeIbge = new Map(municipiosIbge.map((m) => [normalizarNome(m.nome), m.id]));

  const listaMunicipios = [...municipios.values()].map((m) => ({
    ibge: String(porNomeIbge.get(normalizarNome(m.nome)) || ''),
    nome: m.nome,
    total: m.total,
    homens: m.homens,
    mulheres: m.mulheres,
    deficiencia: m.deficiencia,
    biometria: m.biometria,
    idadeMedia: Math.round((m.somaIdade / m.total) * 10) / 10,
    escolaridadePredominante: grauPredominante(m.grau),
    zonas: m.zonas.size,
    corRaca: ordenarCorRaca(m.cor),
  })).sort((a, b) => b.total - a.total)
    .map((m, i) => ({ ...m, rank: i + 1 }));

  const semIbge = listaMunicipios.filter((m) => !m.ibge);
  if (semIbge.length) console.warn(`Aviso: municípios sem código IBGE casado: ${semIbge.map((m) => m.nome).join(', ')}`);

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'https://dadosabertos.tse.jus.br/dataset/eleitorado-atual',
    referencia: 'Eleitorado atual, seção eleitoral, AM — TSE',
    estado: {
      total: estado.total,
      homens: estado.homens,
      mulheres: estado.mulheres,
      deficiencia: estado.deficiencia,
      biometria: estado.biometria,
      idadeMedia: Math.round((estado.somaIdade / estado.total) * 10) / 10,
      escolaridadePredominante: grauPredominante(estado.grau),
      zonas: estado.zonas.size,
      corRaca: ordenarCorRaca(estado.cor),
    },
    municipios: listaMunicipios,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${listaMunicipios.length} municípios, ${resultado.estado.total} eleitores no estado)`);

  if (fs.existsSync(PAGINA_EMBUTIDA)) {
    const html = fs.readFileSync(PAGINA_EMBUTIDA, 'utf8');
    const marcador = /(<script id="dados-eleitorado" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
    if (marcador.test(html)) {
      fs.writeFileSync(PAGINA_EMBUTIDA, html.replace(marcador, (_, abre, _c, fecha) => abre + JSON.stringify(resultado, null, 2) + fecha), 'utf8');
      console.log(`Atualizado: ${PAGINA_EMBUTIDA}`);
    } else {
      console.warn(`Aviso: marcador "dados-eleitorado" não encontrado em ${PAGINA_EMBUTIDA}, pulando.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
