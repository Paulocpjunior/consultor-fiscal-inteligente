// ============================================================================
// sefaz-backend/prova-saida.js  (PURO — sem firebase, testável em jest)
//
// PROVA EXATA da captura de SAÍDA (mod 55) pela NUMERAÇÃO SEQUENCIAL.
//
// Pedido do Paulo (30/07): "isso não pode ser no chute, nem ficar esperando
// as NFs caírem do céu — temos que ter exatidão de quem recebeu ou não os
// XML". A fonte de exatidão já está nos nossos dados: NF-e é numerada em
// sequência POR SÉRIE. Se capturamos as notas 760, 761 e 763 da série 1, a
// 762 está FALTANDO — com número e tudo. Nenhuma fonte externa (SIEG,
// planilha, cliente) é necessária.
//
// Ressalva honesta (vai na tela e no e-mail): um buraco pode ser nota
// INUTILIZADA (numeração pulada legalmente — a inutilização não desce por
// DistDFe). Por isso o buraco é "faltante ou inutilizada — confirmar", nunca
// silenciado. Nota CANCELADA não é buraco: ela desce normalmente e preenche a
// sequência (com status cancelado).
//
// Limite intrínseco: a prova alcança até a MAIOR nota capturada. Notas
// emitidas depois dela ainda não são detectáveis por sequência (fronteira).
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

const norm = (c) => String(c || '').replace(/\D/g, '');

function modeloDaChave(chave) {
  const d = norm(chave);
  return d.length === 44 ? d.slice(20, 22) : null;
}

/**
 * Analisa a sequência de numeração das saídas mod 55 por empresa e por série.
 *
 * @param {object} p
 * @param {Array<{empresaId?:string, cnpjEmit?:string, empresaCnpj?:string,
 *   direcao?:string, chave?:string, dhEmi?:string, numero?:string|number|null,
 *   serie?:string|number|null}>} p.docs  documentos de saída da base
 * @param {Array<{empresaId:string, cnpj:string, nome?:string}>} p.empresas cadastro
 * @param {number} p.hojeMs
 * @param {number} [p.janelaDias=90]
 * @param {number} [p.maxFaltantesLista=30] corte da lista de números por série
 * @returns {{
 *   janelaDias:number,
 *   empresas: Array<{empresaId:string|null, cnpj:string, nome:string,
 *     capturadas:number, semNumero:number, totalFaltantes:number,
 *     ultimaSaida:string|null, farol:'exata'|'incompleta',
 *     series: Array<{serie:string, menor:number, maior:number, capturadas:number,
 *       faltantes:number[], totalFaltantes:number, faltantesTruncado:boolean}>}>,
 *   totais: {empresasAnalisadas:number, empresasExatas:number,
 *     empresasComBuraco:number, notasFaltantes:number}
 * }}
 */
export function analisarSequenciasSaida({ docs, empresas, hojeMs, janelaDias = 90, maxFaltantesLista = 30 }) {
  const inicioMs = hojeMs - janelaDias * DIA_MS;

  // Índices do cadastro pra atribuir doc → empresa (id primeiro, raiz depois —
  // mesmo critério da Cobertura de Saída).
  const porId = new Map();
  const porRaiz = new Map();
  for (const e of empresas || []) {
    const cnpj = norm(e.cnpj);
    const rec = {
      empresaId: e.empresaId || null,
      cnpj,
      nome: e.nome || '—',
      series: new Map(), // serie → Set<int> números capturados
      capturadas: 0,
      semNumero: 0,
      ultimaMs: null,
      ultimaSaida: null,
    };
    if (e.empresaId) porId.set(e.empresaId, rec);
    if (cnpj.length === 14 && !porRaiz.has(cnpj.slice(0, 8))) porRaiz.set(cnpj.slice(0, 8), rec);
  }

  for (const d of docs || []) {
    if (String(d?.direcao) !== 'saida') continue;
    if (modeloDaChave(d.chave) !== '55') continue;
    const t = Date.parse(d.dhEmi || '');
    if (!Number.isFinite(t) || t < inicioMs || t > hojeMs + DIA_MS) continue;

    let rec = d.empresaId ? porId.get(d.empresaId) : null;
    if (!rec) {
      const cEmit = norm(d.cnpjEmit || d.empresaCnpj);
      if (cEmit.length === 14) rec = porRaiz.get(cEmit.slice(0, 8));
    }
    if (!rec) continue;

    rec.capturadas++;
    if (rec.ultimaMs === null || t > rec.ultimaMs) { rec.ultimaMs = t; rec.ultimaSaida = d.dhEmi; }

    const num = parseInt(String(d.numero ?? '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(num) || num <= 0) { rec.semNumero++; continue; }
    const serie = String(d.serie ?? '').replace(/\D/g, '') || '1';
    if (!rec.series.has(serie)) rec.series.set(serie, new Set());
    rec.series.get(serie).add(num);
  }

  const resultado = [];
  let empresasExatas = 0, empresasComBuraco = 0, notasFaltantes = 0;

  for (const rec of new Set([...porId.values(), ...porRaiz.values()])) {
    if (rec.capturadas === 0) continue; // sem saída na janela — Cobertura de Saída cuida

    const series = [];
    let totalFaltantes = 0;
    for (const [serie, nums] of rec.series) {
      const ordenados = [...nums].sort((a, b) => a - b);
      const menor = ordenados[0];
      const maior = ordenados[ordenados.length - 1];
      const faltantes = [];
      let totalSerie = 0;
      for (let n = menor + 1; n < maior; n++) {
        if (!nums.has(n)) {
          totalSerie++;
          if (faltantes.length < maxFaltantesLista) faltantes.push(n);
        }
      }
      totalFaltantes += totalSerie;
      series.push({
        serie, menor, maior,
        capturadas: ordenados.length,
        faltantes,
        totalFaltantes: totalSerie,
        faltantesTruncado: totalSerie > faltantes.length,
      });
    }
    series.sort((a, b) => b.totalFaltantes - a.totalFaltantes || a.serie.localeCompare(b.serie));

    const farol = totalFaltantes > 0 ? 'incompleta' : 'exata';
    if (farol === 'exata') empresasExatas++; else empresasComBuraco++;
    notasFaltantes += totalFaltantes;

    resultado.push({
      empresaId: rec.empresaId,
      cnpj: rec.cnpj,
      nome: rec.nome,
      capturadas: rec.capturadas,
      semNumero: rec.semNumero,
      totalFaltantes,
      ultimaSaida: rec.ultimaSaida,
      farol,
      series,
    });
  }

  // Pior primeiro (mais faltantes); empate por nome.
  resultado.sort((a, b) => b.totalFaltantes - a.totalFaltantes
    || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  return {
    janelaDias,
    empresas: resultado,
    totais: {
      empresasAnalisadas: resultado.length,
      empresasExatas,
      empresasComBuraco,
      notasFaltantes,
    },
  };
}
