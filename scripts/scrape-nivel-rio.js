// Coleta o nível do Rio Negro em portodemanaus.com.br e atualiza data/nivel-rio-negro.json.
// Executado diariamente pelo workflow .github/workflows/atualizar-nivel-rio.yml

const fs = require('fs');
const path = require('path');

const URL_FONTE = 'https://portodemanaus.com.br/nivel-do-rio-negro/';
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'nivel-rio-negro.json');
const ARQUIVO_PAGINA = path.join(__dirname, '..', 'projetos', 'manaus-rio.html');

function parseNumero(str) {
  return parseFloat(str.replace(',', '.'));
}

async function buscarHtml() {
  const resp = await fetch(URL_FONTE, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NevoeiroBot/1.0)' },
  });
  if (!resp.ok) throw new Error(`Falha ao buscar página: HTTP ${resp.status}`);
  return resp.text();
}

function extrairAtual(html) {
  const mData = html.match(/jet-listing-dynamic-field__content"\s*>(\d{2})\/(\d{2})\/(\d{4})<\/div>/);
  const mCota = html.match(/data-to-value="([\d.]+)"/);
  const mSituacao = html.match(/Situa[cç][aã]o<\/h2>\s*<\/div>\s*<div[^>]*>\s*<h4 class="elementor-heading-title elementor-size-default">(.*?)<\/h4>/);
  const mVarDia = html.match(/<h5 class="elementor-heading-title elementor-size-default">(Vazou|Encheu): (-?[\d.,]+)cm<\/h5>/);
  const mVarAcum = html.match(/<h5 class="elementor-heading-title elementor-size-default">(Vazou|Encheu) at[eé] hoje<br><b>([\d.,]+)m<\/b><\/h5>/);

  if (!mData || !mCota || !mSituacao || !mVarDia || !mVarAcum) {
    throw new Error('Não foi possível localizar todos os campos do painel "Nível do Rio" na página.');
  }

  const [, dia, mes, ano] = mData;
  const sinalAcum = mVarAcum[1] === 'Vazou' ? -1 : 1;

  return {
    data: `${ano}-${mes}-${dia}`,
    cota: parseFloat(mCota[1]),
    situacao: mSituacao[1],
    variacaoDiaCm: parseNumero(mVarDia[2]), // o texto da página já vem com o sinal
    variacaoAcumuladaM: sinalAcum * parseNumero(mVarAcum[2]),
    mesAtual: parseInt(mes, 10),
    anoAtual: parseInt(ano, 10),
  };
}

function extrairHistorico(html, mesAtual, anoAtual) {
  const blocoRegex = /<span class="elementor-icon-list-text">([A-ZÇÃÁÉÍÓÚa-zçãáéíóúü]+) (\d{4})<\/span>[\s\S]{0,4000}?<table>([\s\S]*?)<\/table>/g;
  const linhaRegex = /<tr class="jet-listing-dynamic-repeater__item"><td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>(-?[\d.,]+)<\/td><\/tr>/g;

  const historico = [];
  let blocoMatch;
  let indiceBloco = 0;

  while ((blocoMatch = blocoRegex.exec(html)) !== null) {
    // A página tem digitado erroneamente o ano em alguns blocos (ex: "Abril 2023" num
    // conjunto de meses todos de 2026). Os blocos vêm em ordem cronológica decrescente
    // a partir do mês atual, então calculamos o mês/ano pela posição em vez de confiar
    // no texto do bloco.
    let mes = mesAtual - indiceBloco;
    let ano = anoAtual;
    while (mes <= 0) { mes += 12; ano -= 1; }

    const tabela = blocoMatch[3];
    let linhaMatch;
    let prevCota = null;
    let dia = 0;

    while ((linhaMatch = linhaRegex.exec(tabela)) !== null) {
      dia += 1; // usa a posição na tabela: a coluna "Dia" já teve valores duplicados/errados na fonte
      const cota = parseNumero(linhaMatch[2]);
      const variacaoCm = parseNumero(linhaMatch[3]);

      let cotaFinal = cota;
      if (prevCota !== null) {
        const esperado = Math.round((prevCota + variacaoCm / 100) * 100) / 100;
        // Corrige erros de digitação isolados na cota (ex: "20.12" em vez de "28.12")
        // usando a variação diária, que é internamente consistente.
        if (Math.abs(cota - esperado) > 0.05) cotaFinal = esperado;
      }

      const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      historico.push({ data: dataStr, cota: cotaFinal, variacaoCm });
      prevCota = cotaFinal;
    }

    indiceBloco += 1;
  }

  historico.sort((a, b) => a.data.localeCompare(b.data));
  return historico;
}

function atualizarPaginaEmbutida(resultado) {
  if (!fs.existsSync(ARQUIVO_PAGINA)) return;
  const html = fs.readFileSync(ARQUIVO_PAGINA, 'utf8');
  const marcador = /(<script id="dados-rio" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
  if (!marcador.test(html)) {
    console.warn(`Aviso: marcador "dados-rio" não encontrado em ${ARQUIVO_PAGINA}, pulando.`);
    return;
  }
  const novoHtml = html.replace(marcador, (_, abre, _conteudo, fecha) => (
    abre + JSON.stringify(resultado, null, 2) + fecha
  ));
  fs.writeFileSync(ARQUIVO_PAGINA, novoHtml, 'utf8');
  console.log(`Atualizado: ${ARQUIVO_PAGINA}`);
}

async function main() {
  const html = await buscarHtml();
  const atual = extrairAtual(html);
  const historicoNovo = extrairHistorico(html, atual.mesAtual, atual.anoAtual);

  let historicoExistente = [];
  if (fs.existsSync(ARQUIVO_DADOS)) {
    historicoExistente = JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8')).historico || [];
  }

  const porData = new Map(historicoExistente.map((h) => [h.data, h]));
  for (const h of historicoNovo) porData.set(h.data, h);
  const historico = [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: URL_FONTE,
    atual: {
      data: atual.data,
      cota: atual.cota,
      situacao: atual.situacao,
      variacaoDiaCm: atual.variacaoDiaCm,
      variacaoAcumuladaM: atual.variacaoAcumuladaM,
    },
    historico,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${historico.length} registros, cota atual ${atual.cota}m em ${atual.data})`);

  atualizarPaginaEmbutida(resultado);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
