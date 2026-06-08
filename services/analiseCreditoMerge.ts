/**
 * services/analiseCreditoMerge.ts
 *
 * Logica PURA de merge entre o PDF E-Fiscal e as invoices manuais cadastradas
 * pelo usuario, mais filtragem por ocultos (fornecedor inteiro ou NF individual).
 *
 * Extraida de components/AnaliseCreditoExtrato.tsx (que tinha 2152 linhas)
 * pra ficar testavel sem render de React. Documentacao das regras de negocio
 * vive aqui agora.
 *
 * Fluxo:
 *   1) Separa invoicesManuais em SEM categoria (agregam por CNPJ junto com PDF)
 *      vs COM categoria (cada uma vira "fornecedor sintetico" isolado).
 *      Chave sintetica: `${cnpjDigits}__inv__${id.slice(-8)}` — preserva o
 *      CNPJ original visualmente mas garante unicidade no fornMap/catPorCnpj.
 *   2) Converte invoices manuais em EfiscalNf e mescla com efiscal.notas.
 *   3) Reagrupa fornecedores (PDF + invoices SEM categoria agregam por CNPJ;
 *      invoices COM categoria entram como fornecedores individuais).
 *   4) Aplica filtros de ocultos:
 *      - FORNECEDOR oculto (CNPJ inteiro): some todas NFs do CNPJ
 *      - NF INDIVIDUAL oculta (cnpj+numero+serie): some so essa NF, descontando
 *        seus valores dos agregados do fornecedor
 *      - Se o fornecedor ficar com 0 NFs apos exclusao, ele tambem some
 *
 * Saida pronta pra `calcularCreditoEfiscal(fornFiltrados, regCalc,
 * notasFiltradas, overridesSinteticos, categoriasNaoCreditaveis)`.
 */

import type { EfiscalNf, EfiscalFornecedorAgrupado, EfiscalPdfParsed } from './efiscalPdfParserService';
import type { InvoiceManual } from './invoicesManuaisService';
import { nfChave } from './notasOcultasService';

export interface AnaliseCreditoMergeInput {
    efiscal: EfiscalPdfParsed;
    invoicesManuais: InvoiceManual[];
    overrides: Map<string, string>;
    fornecedoresOcultos: Set<string>;  // valores ja em `cnpjKey` (so digitos)
    notasOcultas: Set<string>;          // valores ja em `nfChave(cnpj, numero, serie)`
}

export interface AnaliseCreditoMergeOutput {
    notasMescladas: EfiscalNf[];
    fornFiltrados: EfiscalFornecedorAgrupado[];
    notasFiltradas: EfiscalNf[];
    overridesSinteticos: Map<string, string>;
}

const cnpjKey = (c: string): string => (c || '').replace(/\D+/g, '');

/**
 * Gera a chave sintetica usada pra invoices COM categoria.
 * Preserva o CNPJ original visualmente (8 primeiros digitos sao do CNPJ),
 * mas garante unicidade ao prefixar com `__inv__<id-suffix>`.
 */
export function chaveSinteticaInvoice(im: { cnpjCpf: string; id: string }): string {
    return `${cnpjKey(im.cnpjCpf)}__inv__${im.id.slice(-8)}`;
}

/**
 * Mescla invoices manuais com o PDF e-fiscal e aplica filtros de ocultos.
 * NAO calcula credito — devolve estrutura pronta pra calcularCreditoEfiscal.
 */
export function mesclarInvoicesEFiltrarOcultos(
    input: AnaliseCreditoMergeInput,
): AnaliseCreditoMergeOutput {
    const { efiscal, invoicesManuais, overrides, fornecedoresOcultos, notasOcultas } = input;

    // 1) Separa invoices em DOIS grupos
    const invoicesSemCat = invoicesManuais.filter(im => !im.categoria);
    const invoicesComCat = invoicesManuais.filter(im => im.categoria);

    // 2) Constroi overrides incluindo as invoices com categoria fixa
    const overridesSinteticos = new Map<string, string>(overrides);
    for (const im of invoicesComCat) {
        const k = chaveSinteticaInvoice(im);
        overridesSinteticos.set(k, im.categoria as string);
    }

    // 3) Converte invoices em EfiscalNf
    const notasManuaisSemCat: EfiscalNf[] = invoicesSemCat.map(im => ({
        emissao: im.emissao || '',
        numero: im.numero || '',
        serie: im.serie || '',
        cnpjCpf: im.cnpjCpf,
        razaoSocial: im.razaoSocial,
        valorNf: Number(im.valorNf) || 0,
        baseCalculo: Number(im.baseCalculo) || 0,
        aliquota: Number(im.aliquota) || 0,
        valorIss: Number(im.valorIss) || 0,
        issRetido: Number(im.issRetido) || 0,
        pagina: 0,
    }));
    const notasManuaisComCat: EfiscalNf[] = invoicesComCat.map(im => ({
        emissao: im.emissao || '',
        numero: im.numero || '',
        serie: im.serie || '',
        cnpjCpf: chaveSinteticaInvoice(im),
        razaoSocial: im.razaoSocial,
        valorNf: Number(im.valorNf) || 0,
        baseCalculo: Number(im.baseCalculo) || 0,
        aliquota: Number(im.aliquota) || 0,
        valorIss: Number(im.valorIss) || 0,
        issRetido: Number(im.issRetido) || 0,
        pagina: 0,
    }));

    const notasMescladas: EfiscalNf[] = [
        ...efiscal.notas,
        ...notasManuaisSemCat,
        ...notasManuaisComCat,
    ];

    // 4) Reagrupa fornecedores
    const fornMap = new Map<string, EfiscalFornecedorAgrupado>();
    for (const f of efiscal.fornecedores) {
        fornMap.set(cnpjKey(f.cnpjCpf), { ...f });
    }
    for (const im of invoicesSemCat) {
        const k = cnpjKey(im.cnpjCpf);
        const existente = fornMap.get(k);
        if (existente) {
            existente.qtdNotas += 1;
            existente.somaValorNf += Number(im.valorNf) || 0;
            existente.somaBaseCalculo += Number(im.baseCalculo) || 0;
            existente.somaValorIss += Number(im.valorIss) || 0;
            existente.somaIssRetido += Number(im.issRetido) || 0;
        } else {
            fornMap.set(k, {
                cnpjCpf: im.cnpjCpf,
                razaoSocial: im.razaoSocial,
                qtdNotas: 1,
                somaValorNf: Number(im.valorNf) || 0,
                somaBaseCalculo: Number(im.baseCalculo) || 0,
                somaValorIss: Number(im.valorIss) || 0,
                somaIssRetido: Number(im.issRetido) || 0,
            });
        }
    }
    for (const im of invoicesComCat) {
        const cnpjSint = chaveSinteticaInvoice(im);
        fornMap.set(cnpjSint, {
            cnpjCpf: cnpjSint,
            razaoSocial: im.razaoSocial,
            qtdNotas: 1,
            somaValorNf: Number(im.valorNf) || 0,
            somaBaseCalculo: Number(im.baseCalculo) || 0,
            somaValorIss: Number(im.valorIss) || 0,
            somaIssRetido: Number(im.issRetido) || 0,
        });
    }

    const fornMesclados = Array.from(fornMap.values());

    // 5) Aplica filtro de ocultos (UNIAO local + persistido ja resolvida nos
    //    Sets de entrada).
    //
    // IMPORTANTE: calcularCreditoEfiscal soma a base por FORNECEDOR
    // (f.somaValorNf agregado), nao iterando NFs. Entao quando excluimos
    // UMA NF individual, precisamos DESCONTAR seus valores dos totais
    // agregados do fornecedor afetado — senao a base nao muda (so o contador
    // de NFs muda visualmente, dando impressao de bug).
    const fornFiltrados = fornMesclados
        .filter(f => !fornecedoresOcultos.has(cnpjKey(f.cnpjCpf)))
        .map(f => {
            if (notasOcultas.size === 0) return f;
            const ocultasDoForn = notasMescladas.filter(n =>
                cnpjKey(n.cnpjCpf) === cnpjKey(f.cnpjCpf) &&
                notasOcultas.has(nfChave(n.cnpjCpf, n.numero, n.serie || ''))
            );
            if (ocultasDoForn.length === 0) return f;
            let dValorNf = 0, dBaseCalc = 0, dValorIss = 0, dIssRet = 0;
            for (const n of ocultasDoForn) {
                dValorNf  += Number(n.valorNf)    || 0;
                dBaseCalc += Number(n.baseCalculo)|| 0;
                dValorIss += Number(n.valorIss)   || 0;
                dIssRet   += Number(n.issRetido)  || 0;
            }
            return {
                ...f,
                qtdNotas:        Math.max(0, f.qtdNotas        - ocultasDoForn.length),
                somaValorNf:     Math.max(0, f.somaValorNf     - dValorNf),
                somaBaseCalculo: Math.max(0, f.somaBaseCalculo - dBaseCalc),
                somaValorIss:    Math.max(0, f.somaValorIss    - dValorIss),
                somaIssRetido:   Math.max(0, f.somaIssRetido   - dIssRet),
            };
        })
        .filter(f => f.qtdNotas > 0);

    const notasFiltradas = notasMescladas.filter(n =>
        !fornecedoresOcultos.has(cnpjKey(n.cnpjCpf)) &&
        !notasOcultas.has(nfChave(n.cnpjCpf, n.numero, n.serie || ''))
    );

    return {
        notasMescladas,
        fornFiltrados,
        notasFiltradas,
        overridesSinteticos,
    };
}
