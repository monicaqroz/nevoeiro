// Educação básica no Amazonas: escolas, matrículas e docentes (Censo Escolar/INEP)
// e IDEB por município (INEP). Executado pelo workflow
// .github/workflows/atualizar-educacao.yml
//
// O INEP não tem API — só ZIPs. O Censo Escolar vem como CSV (';'), mas o
// IDEB por município só existe em planilha (.ods/.xlsx), por isso usamos o
// pacote "xlsx" para ler esses arquivos.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const XLSX = require('xlsx');

const CSV_CENSO = process.argv[2] || path.join(__dirname, '..', 'tmp-educacao', 'microdados_ed_basica_2024.csv');
const DIR_IDEB = process.argv[3] || path.join(__dirname, '..', 'tmp-educacao', 'ideb');
const URL_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/13/municipios';
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'educacao-am.json');
const PAGINA_EMBUTIDA = path.join(__dirname, '..', 'projetos', 'amazonas-educacao.html');

const CO_UF_AM = '13';

// Índices das colunas usadas no CSV do Censo Escolar (microdados_ed_basica)
const COL = {
  CO_MUNICIPIO: 7, NO_MUNICIPIO: 6, TP_DEPENDENCIA: 20, TP_LOCALIZACAO: 22,
  QT_MAT_BAS: 303, QT_MAT_INF: 304, QT_MAT_FUND: 307, QT_MAT_MED: 319,
  QT_MAT_EJA: 342, QT_MAT_ESP: 351,
  QT_MAT_ZR_URB: 378, QT_MAT_ZR_RUR: 379,
  QT_DOC_BAS: 384, QT_DOC_INF: 385, QT_DOC_FUND: 388, QT_DOC_MED: 391,
};

const REDE_PUBLICA = new Set(['1', '2', '3']); // Federal, Estadual, Municipal (4 = Privada)

function novoAcumuladorEscolas() {
  return {
    escolas: 0, escolasPublicas: 0, escolasPrivadas: 0,
    matriculaBas: 0, matriculaInf: 0, matriculaFund: 0, matriculaMed: 0, matriculaEja: 0, matriculaEsp: 0,
    matriculaUrbana: 0, matriculaRural: 0,
    docentesBas: 0, docentesInf: 0, docentesFund: 0, docentesMed: 0,
  };
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function agregarCensoEscolar() {
  const municipios = new Map(); // CO_MUNICIPIO -> { nome, ...acumulador }
  const estado = novoAcumuladorEscolas();

  const rl = readline.createInterface({ input: fs.createReadStream(CSV_CENSO, { encoding: 'latin1' }), crlfDelay: Infinity });
  let primeira = true;
  for await (const linha of rl) {
    if (primeira) { primeira = false; continue; }
    if (!linha.trim()) continue;
    const f = linha.split(';');
    if (f[5] !== CO_UF_AM) continue; // CO_UF

    const cdMun = f[COL.CO_MUNICIPIO];
    const nmMun = f[COL.NO_MUNICIPIO];
    if (!municipios.has(cdMun)) municipios.set(cdMun, { nome: nmMun, ...novoAcumuladorEscolas() });
    const m = municipios.get(cdMun);

    const publica = REDE_PUBLICA.has(f[COL.TP_DEPENDENCIA]);

    for (const alvo of [m, estado]) {
      alvo.escolas += 1;
      if (publica) alvo.escolasPublicas += 1; else alvo.escolasPrivadas += 1;
      alvo.matriculaBas += numero(f[COL.QT_MAT_BAS]);
      alvo.matriculaInf += numero(f[COL.QT_MAT_INF]);
      alvo.matriculaFund += numero(f[COL.QT_MAT_FUND]);
      alvo.matriculaMed += numero(f[COL.QT_MAT_MED]);
      alvo.matriculaEja += numero(f[COL.QT_MAT_EJA]);
      alvo.matriculaEsp += numero(f[COL.QT_MAT_ESP]);
      alvo.matriculaUrbana += numero(f[COL.QT_MAT_ZR_URB]);
      alvo.matriculaRural += numero(f[COL.QT_MAT_ZR_RUR]);
      alvo.docentesBas += numero(f[COL.QT_DOC_BAS]);
      alvo.docentesInf += numero(f[COL.QT_DOC_INF]);
      alvo.docentesFund += numero(f[COL.QT_DOC_FUND]);
      alvo.docentesMed += numero(f[COL.QT_DOC_MED]);
    }
  }

  return { municipios, estado };
}

async function buscarJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao buscar ${url}: HTTP ${resp.status}`);
  return resp.json();
}

function normalizarNome(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

// As planilhas do IDEB por município (INEP) não têm um layout de colunas
// documentado de forma estável (o número de edições históricas varia por
// etapa), então em vez de fixar índices de coluna, detectamos a posição dos
// dados pelo padrão dos valores: cada edição tem um par de notas brutas de
// Matemática/Português (SAEB, escala 0-500, sempre > 120 nos dados reais),
// seguido da Nota Média Padronizada (N, escala ~0-10). Logo após o bloco de
// notas vem o bloco do IDEB (N x P) propriamente dito, uma célula por edição,
// na mesma ordem cronológica — a última é sempre a edição mais recente.
function paraNumeroPtBr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s === '-' || s.toUpperCase() === 'ND') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extrairIdebDeLinha(cells, anoMaisRecente) {
  const rede = String(cells[3] || '').trim();
  const resto = cells.slice(4).map(paraNumeroPtBr);

  const indicesN = [];
  for (let i = 0; i < resto.length - 2; i++) {
    if (resto[i] !== null && resto[i] > 120 && resto[i + 1] !== null && resto[i + 1] > 120) {
      indicesN.push(i + 2);
      i += 2;
    }
  }
  if (indicesN.length === 0) return null;

  const totalEdicoes = indicesN.length;
  const inicioIdeb = indicesN[indicesN.length - 1] + 1;
  const idebValores = resto.slice(inicioIdeb, inicioIdeb + totalEdicoes);
  if (idebValores.length !== totalEdicoes || idebValores.some((v) => v === null)) return null;

  const anos = Array.from({ length: totalEdicoes }, (_, i) => anoMaisRecente - (totalEdicoes - 1 - i) * 2);
  return {
    rede,
    atual: idebValores[idebValores.length - 1],
    historico: anos.map((ano, i) => ({ ano, valor: idebValores[i] })),
  };
}

const ORDEM_REDE_PREFERIDA = ['Pública', 'Estadual', 'Municipal', 'Federal'];

function lerPlanilhaIdeb(caminhoArquivo, anoMaisRecente) {
  if (!fs.existsSync(caminhoArquivo)) {
    console.warn(`Aviso: planilha de IDEB não encontrada em ${caminhoArquivo}, pulando.`);
    return new Map();
  }
  const workbook = XLSX.readFile(caminhoArquivo);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const porMunicipio = new Map(); // codigo -> { rede -> {atual, historico} }
  for (const linha of linhas) {
    if (!linha || String(linha[0]).trim() !== 'AM') continue;
    const codigo = String(linha[1] || '').trim();
    if (!/^\d{7}$/.test(codigo)) continue;
    const extraido = extrairIdebDeLinha(linha, anoMaisRecente);
    if (!extraido) continue;
    if (!porMunicipio.has(codigo)) porMunicipio.set(codigo, {});
    porMunicipio.get(codigo)[extraido.rede] = { atual: extraido.atual, historico: extraido.historico };
  }

  const porMelhorRede = new Map();
  for (const [codigo, porRede] of porMunicipio) {
    const rede = ORDEM_REDE_PREFERIDA.find((r) => porRede[r]);
    if (rede) porMelhorRede.set(codigo, { rede, ...porRede[rede] });
  }
  return porMelhorRede;
}

function mediaPonderada(pares) {
  let somaPeso = 0;
  let somaValor = 0;
  for (const { peso, valor } of pares) {
    if (valor === null || valor === undefined || !peso) continue;
    somaPeso += peso;
    somaValor += peso * valor;
  }
  return somaPeso ? Math.round((somaValor / somaPeso) * 100) / 100 : null;
}

function agregarIdeb(dirIdeb, listaMunicipios) {
  const anosIniciais = lerPlanilhaIdeb(path.join(dirIdeb, 'divulgacao_anos_iniciais_municipios_2023.ods'), 2023);
  const anosFinais = lerPlanilhaIdeb(path.join(dirIdeb, 'divulgacao_anos_finais_municipios_2023.ods'), 2023);
  const ensinoMedio = lerPlanilhaIdeb(path.join(dirIdeb, 'divulgacao_ensino_medio_municipios_2023.ods'), 2023);

  const municipios = {};
  for (const m of listaMunicipios) {
    const codigo = m.ibge;
    const entrada = {
      anosIniciais: anosIniciais.get(codigo) || null,
      anosFinais: anosFinais.get(codigo) || null,
      ensinoMedio: ensinoMedio.get(codigo) || null,
    };
    if (entrada.anosIniciais || entrada.anosFinais || entrada.ensinoMedio) municipios[codigo] = entrada;
  }

  // O INEP não publica um agregado estadual pronto neste recorte por
  // município — a "média estadual" aqui é uma média ponderada pelas
  // matrículas da etapa correspondente, uma aproximação, não o valor oficial.
  const estado = {
    anosIniciais: mediaPonderada(listaMunicipios.map((m) => ({ peso: m.matriculaFund, valor: municipios[m.ibge]?.anosIniciais?.atual ?? null }))),
    anosFinais: mediaPonderada(listaMunicipios.map((m) => ({ peso: m.matriculaFund, valor: municipios[m.ibge]?.anosFinais?.atual ?? null }))),
    ensinoMedio: mediaPonderada(listaMunicipios.map((m) => ({ peso: m.matriculaMed, valor: municipios[m.ibge]?.ensinoMedio?.atual ?? null }))),
    aproximado: true,
  };

  return { estado, municipios };
}

async function main() {
  if (!fs.existsSync(CSV_CENSO)) throw new Error(`CSV do Censo Escolar não encontrado em ${CSV_CENSO}`);

  const [{ municipios, estado }, municipiosIbge] = await Promise.all([
    agregarCensoEscolar(),
    buscarJson(URL_MUNICIPIOS),
  ]);

  const porNomeIbge = new Map(municipiosIbge.map((m) => [normalizarNome(m.nome), m.id]));

  const listaMunicipios = [...municipios.entries()].map(([codigo, m]) => ({
    ibge: codigo,
    nome: m.nome,
    escolas: m.escolas,
    escolasPublicas: m.escolasPublicas,
    escolasPrivadas: m.escolasPrivadas,
    matriculaBas: m.matriculaBas,
    matriculaInf: m.matriculaInf,
    matriculaFund: m.matriculaFund,
    matriculaMed: m.matriculaMed,
    matriculaEja: m.matriculaEja,
    matriculaEsp: m.matriculaEsp,
    matriculaUrbana: m.matriculaUrbana,
    matriculaRural: m.matriculaRural,
    docentesBas: m.docentesBas,
    docentesInf: m.docentesInf,
    docentesFund: m.docentesFund,
    docentesMed: m.docentesMed,
  })).sort((a, b) => b.matriculaBas - a.matriculaBas)
    .map((m, i) => ({ ...m, rank: i + 1 }));

  const semIbge = listaMunicipios.filter((m) => !porNomeIbge.has(normalizarNome(m.nome)));
  if (semIbge.length) console.warn(`Aviso: municípios do censo escolar sem código IBGE casado (usando código do INEP): ${semIbge.map((m) => m.nome).join(', ')}`);

  const ideb = agregarIdeb(DIR_IDEB, listaMunicipios);

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar e /ideb',
    referencia: 'Censo Escolar 2024 (escolas, matrículas, docentes) e IDEB 2023 (última edição disponível) — Amazonas',
    // Resultado nacional do IDEB 2023, publicado pelo INEP na "Nota informativa | Ideb 2023"
    // (download.inep.gov.br/ideb/nota_informativa_ideb_2023.pdf) — usado só como referência de
    // comparação na página; não muda a cada edição do robô, só quando o INEP divulga uma nova.
    idebBrasil2023: { anosIniciais: 6.0, anosFinais: 5.0, ensinoMedio: 4.3 },
    estado: {
      ...estado,
      ideb: ideb.estado,
    },
    municipios: listaMunicipios.map((m) => ({ ...m, ideb: ideb.municipios[m.ibge] || null })),
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${listaMunicipios.length} municípios, ${resultado.estado.escolas} escolas, ${resultado.estado.matriculaBas} matrículas no estado)`);

  if (fs.existsSync(PAGINA_EMBUTIDA)) {
    const html = fs.readFileSync(PAGINA_EMBUTIDA, 'utf8');
    const marcador = /(<script id="dados-educacao" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
    if (marcador.test(html)) {
      fs.writeFileSync(PAGINA_EMBUTIDA, html.replace(marcador, (_, abre, _c, fecha) => abre + JSON.stringify(resultado, null, 2) + fecha), 'utf8');
      console.log(`Atualizado: ${PAGINA_EMBUTIDA}`);
    } else {
      console.warn(`Aviso: marcador "dados-educacao" não encontrado em ${PAGINA_EMBUTIDA}, pulando.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
