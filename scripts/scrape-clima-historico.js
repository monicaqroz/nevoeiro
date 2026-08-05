// Clima de Manaus — História em Dados: climatologia diária, série anual e
// recordes a partir dos dados horários da estação automática do INMET
// (A101, fundada em 09/05/2000). Executado pelo workflow
// .github/workflows/atualizar-clima-historico.yml
//
// O INMET não tem API — só ZIPs anuais (todo o Brasil, um CSV por estação).
// O workflow baixa os ZIPs e extrai só o CSV da estação de Manaus antes de
// chamar este script; aqui a gente só lê os CSVs já extraídos de um diretório.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DIR_CSVS = process.argv[2] || path.join(__dirname, '..', 'tmp-clima-historico');
const ARQUIVO_DADOS = path.join(__dirname, '..', 'data', 'clima-historico-manaus.json');
const PAGINA_EMBUTIDA = path.join(__dirname, '..', 'artigos', 'clima-manaus-historia.html');

// Colunas do CSV horário do INMET (mesma ordem desde 2001; datas e o
// separador de "sem dado" mudam de formato entre anos, tratados abaixo)
const COL = {
  PRECIPITACAO: 2, TEMP_BULBO_SECO: 7, TEMP_MAX_HORA: 9, TEMP_MIN_HORA: 10,
  UMIDADE: 15, VENTO_DIRECAO: 16, VENTO_RAJADA: 17, VENTO_VELOCIDADE: 18,
};

function paraNumero(v) {
  if (v === undefined) return null;
  const s = v.trim().replace(',', '.');
  if (s === '' || s === '-9999') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Aceita "2024/01/01" ou "2001-01-01" -> { ano, mes, dia, chaveDiaAno: "MM-DD" }
function parseData(s) {
  const partes = s.trim().split(/[/-]/);
  if (partes.length !== 3) return null;
  const [ano, mes, dia] = partes.map((p) => parseInt(p, 10));
  if (!ano || !mes || !dia) return null;
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return { ano, mes, dia, chaveDiaAno: `${mm}-${dd}` };
}

function novoAcumuladorDia() {
  return {
    temps: [], tempMaxHora: [], tempMinHora: [], chuva: 0, temChuva: false,
    umidades: [], ventoVel: [], ventoRajada: [], ventoDirecoes: [],
  };
}

async function lerArquivoAno(caminho) {
  const porDia = new Map(); // "YYYY-MM-DD" -> acumulador
  const rl = readline.createInterface({ input: fs.createReadStream(caminho, { encoding: 'latin1' }), crlfDelay: Infinity });

  let numeroLinha = 0;
  let cabecalhoPassado = false;
  for await (const linha of rl) {
    numeroLinha++;
    if (!cabecalhoPassado) {
      // as 8 primeiras linhas são metadados (REGIAO, UF, ESTACAO...), a 9ª é o cabeçalho de colunas
      if (numeroLinha >= 9) cabecalhoPassado = true;
      continue;
    }
    if (!linha.trim()) continue;
    const f = linha.split(';');
    const data = parseData(f[0]);
    if (!data) continue;
    const chave = `${data.ano}-${data.chaveDiaAno}`;

    if (!porDia.has(chave)) porDia.set(chave, { ...data, ...novoAcumuladorDia() });
    const d = porDia.get(chave);

    const temp = paraNumero(f[COL.TEMP_BULBO_SECO]);
    if (temp !== null) d.temps.push(temp);
    const tempMax = paraNumero(f[COL.TEMP_MAX_HORA]);
    if (tempMax !== null) d.tempMaxHora.push(tempMax);
    const tempMin = paraNumero(f[COL.TEMP_MIN_HORA]);
    if (tempMin !== null) d.tempMinHora.push(tempMin);
    const chuva = paraNumero(f[COL.PRECIPITACAO]);
    if (chuva !== null) { d.chuva += chuva; d.temChuva = true; }
    const umidade = paraNumero(f[COL.UMIDADE]);
    if (umidade !== null) d.umidades.push(umidade);
    const ventoVel = paraNumero(f[COL.VENTO_VELOCIDADE]);
    if (ventoVel !== null) d.ventoVel.push(ventoVel);
    const ventoRajada = paraNumero(f[COL.VENTO_RAJADA]);
    if (ventoRajada !== null) d.ventoRajada.push(ventoRajada);
    const ventoDir = paraNumero(f[COL.VENTO_DIRECAO]);
    if (ventoDir !== null) d.ventoDirecoes.push(ventoDir);
  }

  return porDia;
}

function media(lista) {
  if (!lista.length) return null;
  return lista.reduce((s, v) => s + v, 0) / lista.length;
}

function maximo(lista) {
  return lista.length ? Math.max(...lista) : null;
}

function minimo(lista) {
  return lista.length ? Math.min(...lista) : null;
}

// Direção do vento predominante: agrupa em 8 pontos cardeais (N, NE, L, SE, S, SO, O, NO)
// e pega o mais frequente, em vez de tirar média direta dos graus (que quebra perto do 0/360).
const PONTOS_CARDEAIS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
function direcaoCardeal(graus) {
  return PONTOS_CARDEAIS[Math.round(graus / 45) % 8];
}
function direcaoPredominante(listaGraus) {
  if (!listaGraus.length) return null;
  const contagem = {};
  listaGraus.forEach((g) => {
    const c = direcaoCardeal(g);
    contagem[c] = (contagem[c] || 0) + 1;
  });
  return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];
}

function resumirDia(d) {
  const HORAS_MINIMAS = 12; // dia com menos da metade das 24h de leitura entra com baixa confiança
  return {
    ano: d.ano, mes: d.mes, dia: d.dia, chaveDiaAno: d.chaveDiaAno,
    tempMedia: media(d.temps),
    tempMax: maximo(d.tempMaxHora.length ? d.tempMaxHora : d.temps),
    tempMin: minimo(d.tempMinHora.length ? d.tempMinHora : d.temps),
    chuva: d.temChuva ? Math.round(d.chuva * 10) / 10 : null,
    umidadeMedia: media(d.umidades),
    ventoVelMedia: media(d.ventoVel),
    ventoRajadaMax: maximo(d.ventoRajada),
    ventoDirPredominante: direcaoPredominante(d.ventoDirecoes),
    horasComDado: d.temps.length,
    confiavel: d.temps.length >= HORAS_MINIMAS,
  };
}

function arredonda(v, casas = 1) {
  if (v === null || v === undefined) return null;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

function construirClimatologiaDiaria(diasPorAno) {
  const porChaveDiaAno = new Map(); // "MM-DD" -> [dias resumidos confiáveis]
  for (const dias of diasPorAno.values()) {
    for (const d of dias) {
      if (!d.confiavel) continue;
      if (!porChaveDiaAno.has(d.chaveDiaAno)) porChaveDiaAno.set(d.chaveDiaAno, []);
      porChaveDiaAno.get(d.chaveDiaAno).push(d);
    }
  }

  const resultado = {};
  for (const [chave, dias] of porChaveDiaAno) {
    resultado[chave] = {
      tempMedia: arredonda(media(dias.map((d) => d.tempMedia).filter((v) => v !== null))),
      tempMaxMedia: arredonda(media(dias.map((d) => d.tempMax).filter((v) => v !== null))),
      tempMinMedia: arredonda(media(dias.map((d) => d.tempMin).filter((v) => v !== null))),
      chuvaMedia: arredonda(media(dias.map((d) => d.chuva).filter((v) => v !== null))),
      umidadeMedia: arredonda(media(dias.map((d) => d.umidadeMedia).filter((v) => v !== null))),
      ventoVelMedia: arredonda(media(dias.map((d) => d.ventoVelMedia).filter((v) => v !== null))),
      ventoDirPredominante: direcaoPredominante(dias.flatMap((d) => (d.ventoDirPredominante ? [PONTOS_CARDEAIS.indexOf(d.ventoDirPredominante) * 45] : []))),
      n: dias.length,
    };
  }
  return resultado;
}

function construirSerieAnual(diasPorAno) {
  const anos = [...diasPorAno.keys()].sort((a, b) => a - b);
  return anos.map((ano) => {
    const dias = diasPorAno.get(ano).filter((d) => d.confiavel);
    const comChuva = diasPorAno.get(ano).filter((d) => d.chuva !== null);
    return {
      ano,
      tempMedia: arredonda(media(dias.map((d) => d.tempMedia).filter((v) => v !== null))),
      tempMax: arredonda(maximo(dias.map((d) => d.tempMax).filter((v) => v !== null))),
      tempMin: arredonda(minimo(dias.map((d) => d.tempMin).filter((v) => v !== null))),
      chuvaTotal: arredonda(comChuva.reduce((s, d) => s + d.chuva, 0)),
      umidadeMedia: arredonda(media(dias.map((d) => d.umidadeMedia).filter((v) => v !== null))),
      ventoVelMedia: arredonda(media(dias.map((d) => d.ventoVelMedia).filter((v) => v !== null))),
      diasComDado: dias.length,
    };
  });
}

function construirClimatologiaMensal(diasPorAno) {
  const porMes = new Map();
  for (const dias of diasPorAno.values()) {
    for (const d of dias) {
      if (!d.confiavel) continue;
      if (!porMes.has(d.mes)) porMes.set(d.mes, []);
      porMes.get(d.mes).push(d);
    }
  }
  const resultado = [];
  for (let mes = 1; mes <= 12; mes++) {
    const dias = porMes.get(mes) || [];
    // chuva média mensal: soma da chuva de cada mês/ano, depois média entre os anos
    const porAno = new Map();
    dias.forEach((d) => {
      if (!porAno.has(d.ano)) porAno.set(d.ano, 0);
      if (d.chuva !== null) porAno.set(d.ano, porAno.get(d.ano) + d.chuva);
    });
    resultado.push({
      mes,
      tempMedia: arredonda(media(dias.map((d) => d.tempMedia).filter((v) => v !== null))),
      tempMaxMedia: arredonda(media(dias.map((d) => d.tempMax).filter((v) => v !== null))),
      tempMinMedia: arredonda(media(dias.map((d) => d.tempMin).filter((v) => v !== null))),
      chuvaMediaMensal: arredonda(media([...porAno.values()])),
      umidadeMedia: arredonda(media(dias.map((d) => d.umidadeMedia).filter((v) => v !== null))),
      ventoVelMedia: arredonda(media(dias.map((d) => d.ventoVelMedia).filter((v) => v !== null))),
    });
  }
  return resultado;
}

function construirRecordes(diasPorAno, serieAnual) {
  const todosDias = [...diasPorAno.values()].flat().filter((d) => d.confiavel);
  const maisQuente = todosDias.reduce((a, b) => (b.tempMax !== null && (!a || b.tempMax > a.tempMax) ? b : a), null);
  const maisFrio = todosDias.reduce((a, b) => (b.tempMin !== null && (!a || b.tempMin < a.tempMin) ? b : a), null);
  const maisChuvoso = todosDias.reduce((a, b) => (b.chuva !== null && (!a || b.chuva > a.chuva) ? b : a), null);

  const anosComChuva = serieAnual.filter((a) => a.chuvaTotal !== null);
  const anoMaisChuvoso = anosComChuva.reduce((a, b) => (!a || b.chuvaTotal > a.chuvaTotal ? b : a), null);
  const anoMaisSeco = anosComChuva.reduce((a, b) => (!a || b.chuvaTotal < a.chuvaTotal ? b : a), null);

  const dataDe = (d) => `${d.ano}-${d.chaveDiaAno}`;
  return {
    diaMaisQuente: maisQuente ? { data: dataDe(maisQuente), tempMax: arredonda(maisQuente.tempMax) } : null,
    diaMaisFrio: maisFrio ? { data: dataDe(maisFrio), tempMin: arredonda(maisFrio.tempMin) } : null,
    diaMaisChuvoso: maisChuvoso ? { data: dataDe(maisChuvoso), chuva: arredonda(maisChuvoso.chuva) } : null,
    anoMaisChuvoso: anoMaisChuvoso ? { ano: anoMaisChuvoso.ano, chuvaTotal: anoMaisChuvoso.chuvaTotal } : null,
    anoMaisSeco: anoMaisSeco ? { ano: anoMaisSeco.ano, chuvaTotal: anoMaisSeco.chuvaTotal } : null,
  };
}

function construirTendencia(serieAnual) {
  const completos = serieAnual.filter((a) => a.diasComDado >= 300); // exclui anos com falhas grandes (ex: 2000, ano de fundação)
  if (completos.length < 10) return null;
  const meio = Math.floor(completos.length / 2);
  const primeiraMetade = completos.slice(0, meio);
  const segundaMetade = completos.slice(completos.length - meio);

  const mediaTempPrimeira = media(primeiraMetade.map((a) => a.tempMedia).filter((v) => v !== null));
  const mediaTempSegunda = media(segundaMetade.map((a) => a.tempMedia).filter((v) => v !== null));
  const mediaChuvaPrimeira = media(primeiraMetade.map((a) => a.chuvaTotal).filter((v) => v !== null));
  const mediaChuvaSegunda = media(segundaMetade.map((a) => a.chuvaTotal).filter((v) => v !== null));

  return {
    periodoInicial: { de: primeiraMetade[0].ano, ate: primeiraMetade[primeiraMetade.length - 1].ano, tempMedia: arredonda(mediaTempPrimeira), chuvaMediaAnual: arredonda(mediaChuvaPrimeira) },
    periodoFinal: { de: segundaMetade[0].ano, ate: segundaMetade[segundaMetade.length - 1].ano, tempMedia: arredonda(mediaTempSegunda), chuvaMediaAnual: arredonda(mediaChuvaSegunda) },
    diferencaTemp: arredonda(mediaTempSegunda - mediaTempPrimeira, 2),
    diferencaChuvaPct: mediaChuvaPrimeira ? arredonda((mediaChuvaSegunda - mediaChuvaPrimeira) / mediaChuvaPrimeira * 100) : null,
  };
}

async function main() {
  if (!fs.existsSync(DIR_CSVS)) throw new Error(`Diretório de CSVs não encontrado: ${DIR_CSVS}`);
  const arquivos = fs.readdirSync(DIR_CSVS).filter((f) => f.toUpperCase().endsWith('.CSV'));
  if (!arquivos.length) throw new Error(`Nenhum CSV encontrado em ${DIR_CSVS}`);

  const diasPorAno = new Map(); // ano -> [dias resumidos]
  for (const arquivo of arquivos) {
    const porDia = await lerArquivoAno(path.join(DIR_CSVS, arquivo));
    for (const d of porDia.values()) {
      const resumo = resumirDia(d);
      if (!diasPorAno.has(resumo.ano)) diasPorAno.set(resumo.ano, []);
      diasPorAno.get(resumo.ano).push(resumo);
    }
  }

  const climatologiaDiaria = construirClimatologiaDiaria(diasPorAno);
  const serieAnual = construirSerieAnual(diasPorAno);
  const climatologiaMensal = construirClimatologiaMensal(diasPorAno);
  const recordes = construirRecordes(diasPorAno, serieAnual);
  const tendencia = construirTendencia(serieAnual);

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'https://portal.inmet.gov.br/dadoshistoricos (estação automática A101, Manaus)',
    referencia: `Dados horários da estação automática de Manaus (A101, fundada em 09/05/2000), ${serieAnual[0]?.ano}–${serieAnual[serieAnual.length - 1]?.ano}`,
    periodo: { de: serieAnual[0]?.ano, ate: serieAnual[serieAnual.length - 1]?.ano },
    climatologiaDiaria,
    serieAnual,
    climatologiaMensal,
    recordes,
    tendencia,
  };

  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
  console.log(`Atualizado: ${ARQUIVO_DADOS} (${serieAnual.length} anos, ${Object.keys(climatologiaDiaria).length} dias de climatologia)`);

  if (fs.existsSync(PAGINA_EMBUTIDA)) {
    const html = fs.readFileSync(PAGINA_EMBUTIDA, 'utf8');
    const marcador = /(<script id="dados-clima-historico" type="application\/json">\n)([\s\S]*?)(\n<\/script>)/;
    if (marcador.test(html)) {
      fs.writeFileSync(PAGINA_EMBUTIDA, html.replace(marcador, (_, abre, _c, fecha) => abre + JSON.stringify(resultado, null, 2) + fecha), 'utf8');
      console.log(`Atualizado: ${PAGINA_EMBUTIDA}`);
    } else {
      console.warn(`Aviso: marcador "dados-clima-historico" não encontrado em ${PAGINA_EMBUTIDA}, pulando.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
