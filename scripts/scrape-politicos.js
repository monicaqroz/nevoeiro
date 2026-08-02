// Monta o "raio-x" de quem está eleito hoje no Amazonas, usando os dados
// abertos de candidatos do TSE. Executado pelo workflow
// .github/workflows/atualizar-eleitorado.yml (mesmo robô do eleitorado,
// já que os dois vêm do TSE e mudam pouco).
//
// Mandato estadual (governador, vice, senador, deputados) vem da eleição
// geral de 2022; mandato municipal (prefeito, vice, vereador) vem da
// eleição municipal de 2024 — são os mandatos vigentes hoje.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DIR_CANDIDATOS = process.argv[2] || path.join(__dirname, '..', 'tmp-politicos');
const URL_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/13/municipios';
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'politicos-am.json');
const PAGINA_EMBUTIDA = path.join(__dirname, '..', 'projetos', 'eleitorado-am.html');

const CARGOS_ESTADO = ['GOVERNADOR', 'VICE-GOVERNADOR', 'SENADOR', 'DEPUTADO FEDERAL', 'DEPUTADO ESTADUAL'];
const CARGOS_MUNICIPIO = ['PREFEITO', 'VICE-PREFEITO', 'VEREADOR'];

// Índices das colunas no CSV "consulta_cand" do TSE
const CAND = {
  NM_UE: 12, DS_CARGO: 14, SQ_CANDIDATO: 15, NM_URNA_CANDIDATO: 18,
  SG_PARTIDO: 26, DT_NASCIMENTO: 36, DS_GENERO: 39, DS_GRAU_INSTRUCAO: 41,
  DS_COR_RACA: 45, DS_OCUPACAO: 47, DS_SIT_TOT_TURNO: 49,
};
const NUM_CAMPOS_CAND = 50;

// Índices no CSV "bem_candidato"
const BEM = { SQ_CANDIDATO: 11, VR_BEM_CANDIDATO: 16 };
const NUM_CAMPOS_BEM = 19;

function normalizarNome(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

async function lerCsvFiltrado(caminho, numCampos) {
  const linhas = [];
  const rl = readline.createInterface({ input: fs.createReadStream(caminho, { encoding: 'latin1' }), crlfDelay: Infinity });
  let primeira = true;
  for await (const l of rl) {
    if (primeira) { primeira = false; continue; }
    if (!l.trim()) continue;
    const f = l.split(';');
    if (f.length !== numCampos) continue; // pula linhas quebradas por descrição de bem com quebra de linha
    linhas.push(f.map((v) => v.replace(/^"|"$/g, '')));
  }
  return linhas;
}

async function somarPatrimonio(caminho) {
  const linhas = await lerCsvFiltrado(caminho, NUM_CAMPOS_BEM);
  const porCandidato = new Map();
  for (const f of linhas) {
    const sq = f[BEM.SQ_CANDIDATO];
    const valor = parseFloat(f[BEM.VR_BEM_CANDIDATO].replace(',', '.')) || 0;
    porCandidato.set(sq, (porCandidato.get(sq) || 0) + valor);
  }
  return porCandidato;
}

function calcIdade(dtNasc, hoje) {
  if (!dtNasc || dtNasc === '#NULO') return null;
  const [dia, mes, ano] = dtNasc.split('/').map(Number);
  if (!dia || !mes || !ano) return null;
  let idade = hoje.getFullYear() - ano;
  if (hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)) idade--;
  return idade;
}

function montarPolitico(f, bens, hoje) {
  const sq = f[CAND.SQ_CANDIDATO];
  return {
    nome: f[CAND.NM_URNA_CANDIDATO],
    cargo: f[CAND.DS_CARGO],
    municipioUe: f[CAND.NM_UE],
    partido: f[CAND.SG_PARTIDO],
    idade: calcIdade(f[CAND.DT_NASCIMENTO], hoje),
    sexo: f[CAND.DS_GENERO],
    corRaca: f[CAND.DS_COR_RACA],
    escolaridade: f[CAND.DS_GRAU_INSTRUCAO],
    ocupacao: f[CAND.DS_OCUPACAO],
    situacao: f[CAND.DS_SIT_TOT_TURNO],
    patrimonio: Math.round((bens.get(sq) || 0) * 100) / 100,
  };
}

function estatisticasGrupo(lista) {
  const comIdade = lista.filter((p) => p.idade !== null);
  const idadeMedia = comIdade.length ? Math.round((comIdade.reduce((s, p) => s + p.idade, 0) / comIdade.length) * 10) / 10 : null;
  const homens = lista.filter((p) => p.sexo === 'MASCULINO').length;
  const mulheres = lista.filter((p) => p.sexo === 'FEMININO').length;
  const contagemGrau = {};
  lista.forEach((p) => { contagemGrau[p.escolaridade] = (contagemGrau[p.escolaridade] || 0) + 1; });
  const escolaridadePredominante = Object.entries(contagemGrau).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const patrimonios = lista.map((p) => p.patrimonio).sort((a, b) => a - b);
  const patrimonioMedio = patrimonios.length ? Math.round((patrimonios.reduce((s, v) => s + v, 0) / patrimonios.length) * 100) / 100 : 0;
  const patrimonioMediano = patrimonios.length ? patrimonios[Math.floor((patrimonios.length - 1) / 2)] : 0;
  const corRaca = {};
  lista.forEach((p) => { corRaca[p.corRaca] = (corRaca[p.corRaca] || 0) + 1; });
  return {
    total: lista.length, homens, mulheres, idadeMedia, escolaridadePredominante,
    patrimonioMedio, patrimonioMediano,
    corRaca: Object.fromEntries(Object.entries(corRaca).sort((a, b) => b[1] - a[1])),
  };
}

async function buscarJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao buscar ${url}: HTTP ${resp.status}`);
  return resp.json();
}

async function main() {
  const hoje = new Date();

  const [candEstadoTxt, bensEstado, candMunicipioTxt, bensMunicipio, municipiosIbge] = await Promise.all([
    lerCsvFiltrado(path.join(DIR_CANDIDATOS, 'consulta_cand_2022_AM.csv'), NUM_CAMPOS_CAND),
    somarPatrimonio(path.join(DIR_CANDIDATOS, 'bem_candidato_2022_AM.csv')),
    lerCsvFiltrado(path.join(DIR_CANDIDATOS, 'consulta_cand_2024_AM.csv'), NUM_CAMPOS_CAND),
    somarPatrimonio(path.join(DIR_CANDIDATOS, 'bem_candidato_2024_AM.csv')),
    buscarJson(URL_MUNICIPIOS),
  ]);

  const eleitosEstado = candEstadoTxt
    .filter((f) => CARGOS_ESTADO.includes(f[CAND.DS_CARGO]) && f[CAND.DS_SIT_TOT_TURNO].startsWith('ELEITO'))
    .map((f) => montarPolitico(f, bensEstado, hoje));

  const eleitosMunicipio = candMunicipioTxt
    .filter((f) => CARGOS_MUNICIPIO.includes(f[CAND.DS_CARGO]) && f[CAND.DS_SIT_TOT_TURNO].startsWith('ELEITO'))
    .map((f) => montarPolitico(f, bensMunicipio, hoje));

  const porNomeIbge = new Map(municipiosIbge.map((m) => [normalizarNome(m.nome), m.id]));

  const municipiosMap = new Map();
  for (const p of eleitosMunicipio) {
    if (!municipiosMap.has(p.municipioUe)) municipiosMap.set(p.municipioUe, []);
    municipiosMap.get(p.municipioUe).push(p);
  }

  const municipios = [...municipiosMap.entries()].map(([nomeMun, lista]) => {
    const vereadores = lista.filter((p) => p.cargo === 'VEREADOR').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return {
      ibge: String(porNomeIbge.get(normalizarNome(nomeMun)) || ''),
      nome: nomeMun,
      prefeito: lista.find((p) => p.cargo === 'PREFEITO') || null,
      vicePrefeito: lista.find((p) => p.cargo === 'VICE-PREFEITO') || null,
      vereadores,
      estatisticasCamara: estatisticasGrupo(vereadores),
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const semIbge = municipios.filter((m) => !m.ibge);
  if (semIbge.length) console.warn(`Aviso: municípios sem código IBGE casado: ${semIbge.map((m) => m.nome).join(', ')}`);

  const ordenarNome = (lista) => [...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const resultado = {
    atualizadoEm: hoje.toISOString(),
    fonte: 'https://dadosabertos.tse.jus.br/dataset/candidatos-2022 e candidatos-2024',
    referencia: 'Eleitos em 2022 (governador, vice, senador, deputados) e 2024 (prefeitos, vice-prefeitos, vereadores) — mandatos vigentes',
    estado: {
      governador: eleitosEstado.find((p) => p.cargo === 'GOVERNADOR') || null,
      viceGovernador: eleitosEstado.find((p) => p.cargo === 'VICE-GOVERNADOR') || null,
      senadores: ordenarNome(eleitosEstado.filter((p) => p.cargo === 'SENADOR')),
      deputadosFederais: ordenarNome(eleitosEstado.filter((p) => p.cargo === 'DEPUTADO FEDERAL')),
      deputadosEstaduais: ordenarNome(eleitosEstado.filter((p) => p.cargo === 'DEPUTADO ESTADUAL')),
      estatisticas: estatisticasGrupo(eleitosEstado),
    },
    municipios,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${eleitosEstado.length} eleitos estaduais, ${eleitosMunicipio.length} eleitos municipais em ${municipios.length} municípios)`);

  if (fs.existsSync(PAGINA_EMBUTIDA)) {
    const html = fs.readFileSync(PAGINA_EMBUTIDA, 'utf8');
    const marcador = /(<script id="dados-politicos" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
    if (marcador.test(html)) {
      fs.writeFileSync(PAGINA_EMBUTIDA, html.replace(marcador, (_, abre, _c, fecha) => abre + JSON.stringify(resultado, null, 2) + fecha), 'utf8');
      console.log(`Atualizado: ${PAGINA_EMBUTIDA}`);
    } else {
      console.warn(`Aviso: marcador "dados-politicos" não encontrado em ${PAGINA_EMBUTIDA}, pulando.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
