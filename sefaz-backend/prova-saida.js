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
// v2 (mesma tarde): a v1 agrupava por EMPRESA da base e misturava numerações
// de CNPJs/emitentes diferentes no mesmo balde — a S&P apareceu com 429 mil
// "faltantes" (docs de vários emitentes atribuídos ao escritório por
// importações antigas + fallback por raiz juntando filiais, e numeração de
// NF-e é POR ESTABELECIMENTO). Agora TUDO sai da própria CHAVE de 44 dígitos,
// que carrega o CNPJ do emitente (pos 6-20), a série (22-25) e o nNF (25-34):
// imune a erro de atribuição, e cobre até resumo sem campo numero.
//
// Ressalvas honestas (vão na tela e no e-mail):
//  - buraco pode ser numeração INUTILIZADA (não desce por DistDFe) —
//    "faltante ou inutilizada, confirmar antes de cobrar";
//  - nota CANCELADA não é buraco (desce normalmente e preenche a sequência);
//  - série com faixa gigante de ausências (> limiarGrandeFaixa) não é buraco
//    pontual: é captura que começou no meio da numeração (histórico não
//    coberto) — reportada à parte pra não inflar o total acionável.
//
// Limite intrínseco: a prova alcança até a MAIOR nota capturada de cada
// série. Notas depois dela ainda não são detectáveis (fronteira).
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

const norm = (c) => String(c || '').replace(/\D/g, '');

/** Decompõe a chave de acesso: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9)… */
export function decomporChave(chave) {
  const d = norm(chave);
  if (d.length !== 44) return null;
  const numero = parseInt(d.slice(25, 34), 10);
  const serie = parseInt(d.slice(22, 25), 10);
  if (!Number.isFinite(numero) || numero <= 0 || !Number.isFinite(serie)) return null;
  return {
    cnpjEmit: d.slice(6, 20),
    modelo: d.slice(20, 22),
    serie: String(serie),
    numero,
  };
}

/**
 * Analisa a sequência de numeração das saídas mod 55 POR EMITENTE (CNPJ da
 * chave) e por série. Só emitentes que são empresas CADASTRADAS entram
 * (match exato de CNPJ; senão pela raiz, exibindo o CNPJ real do emitente).
 *
 * @param {object} p
 * @param {Array<{direcao?:string, chave?:string, dhEmi?:string}>} p.docs
 * @param {Array<{empresaId:string, cnpj:string, nome?:string}>} p.empresas
 * @param {number} p.hojeMs
 * @param {number} [p.janelaDias=90]
 * @param {number} [p.maxFaltantesLista=30]
 * @param {number} [p.limiarGrandeFaixa=5000] acima disso a série é "histórico
 *   não coberto", não buraco pontual — sai do total acionável.
 */
export function analisarSequenciasSaida({ docs, empresas, hojeMs, janelaDias = 90, maxFaltantesLista = 30, limiarGrandeFaixa = 5000 }) {
  const inicioMs = hojeMs - janelaDias * DIA_MS;

  // Cadastro: CNPJ exato → empresa; raiz → empresa (pra filial sem cadastro
  // próprio aparecer com o nome do grupo, mas SEMPRE por CNPJ emitente).
  const porCnpj = new Map();
  const porRaiz = new Map();
  for (const e of empresas || []) {
    const cnpj = norm(e.cnpj);
    if (cnpj.length !== 14) continue;
    if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, { empresaId: e.empresaId || null, nome: e.nome || '—' });
    const raiz = cnpj.slice(0, 8);
    if (!porRaiz.has(raiz)) porRaiz.set(raiz, { empresaId: e.empresaId || null, nome: e.nome || '—' });
  }

  // emitente(14) → { info, series: Map(serie → Set<num>), capturadas, ultima… }
  const porEmitente = new Map();
  let docsForaCadastro = 0;
  let chavesInvalidas = 0;

  for (const d of docs || []) {
    if (String(d?.direcao) !== 'saida') continue;
    const dec = decomporChave(d.chave);
    if (!dec) { chavesInvalidas++; continue; }
    if (dec.modelo !== '55') continue;
    const t = Date.parse(d.dhEmi || '');
    if (!Number.isFinite(t) || t < inicioMs || t > hojeMs + DIA_MS) continue;

    const info = porCnpj.get(dec.cnpjEmit) || porRaiz.get(dec.cnpjEmit.slice(0, 8));
    if (!info) { docsForaCadastro++; continue; }

    let rec = porEmitente.get(dec.cnpjEmit);
    if (!rec) {
      rec = {
        cnpj: dec.cnpjEmit,
        empresaId: info.empresaId,
        nome: info.nome,
        series: new Map(),
        capturadas: 0,
        ultimaMs: null,
        ultimaSaida: null,
      };
      porEmitente.set(dec.cnpjEmit, rec);
    }
    rec.capturadas++;
    if (rec.ultimaMs === null || t > rec.ultimaMs) { rec.ultimaMs = t; rec.ultimaSaida = d.dhEmi; }
    if (!rec.series.has(dec.serie)) rec.series.set(dec.serie, new Set());
    rec.series.get(dec.serie).add(dec.numero);
  }

  const resultado = [];
  let empresasExatas = 0, empresasComBuraco = 0, notasFaltantes = 0;
  let seriesGrandeFaixa = 0, faltantesGrandeFaixa = 0;

  for (const rec of porEmitente.values()) {
    const series = [];
    let totalFaltantes = 0;
    for (const [serie, nums] of rec.series) {
      const ordenados = [...nums].sort((a, b) => a - b);
      const menor = ordenados[0];
      const maior = ordenados[ordenados.length - 1];
      const totalAusentes = (maior - menor + 1) - ordenados.length;

      if (totalAusentes > limiarGrandeFaixa) {
        // Faixa gigante = captura começou no meio da numeração (histórico não
        // coberto pela janela/importação) — informação útil, mas NÃO é buraco
        // pontual acionável. Não lista números nem infla o total.
        seriesGrandeFaixa++;
        faltantesGrandeFaixa += totalAusentes;
        series.push({
          serie, menor, maior,
          capturadas: ordenados.length,
          faltantes: [],
          totalFaltantes: totalAusentes,
          faltantesTruncado: true,
          grandeFaixa: true,
        });
        continue;
      }

      const faltantes = [];
      for (let n = menor + 1; n < maior; n++) {
        if (!nums.has(n)) {
          if (faltantes.length < maxFaltantesLista) faltantes.push(n);
        }
      }
      totalFaltantes += totalAusentes;
      series.push({
        serie, menor, maior,
        capturadas: ordenados.length,
        faltantes,
        totalFaltantes: totalAusentes,
        faltantesTruncado: totalAusentes > faltantes.length,
        grandeFaixa: false,
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
      semNumero: 0, // v2: número sai da chave — não há mais doc sem número
      totalFaltantes,
      ultimaSaida: rec.ultimaSaida,
      farol,
      series,
    });
  }

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
      seriesGrandeFaixa,
      faltantesGrandeFaixa,
      docsForaCadastro,
      chavesInvalidas,
    },
  };
}
