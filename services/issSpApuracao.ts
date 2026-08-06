/**
 * issSpApuracao — apuração do ISS próprio da NFS-e de SÃO PAULO CAPITAL.
 *
 * Paulo (05/08): *"devemos habilitar a emissão de ISS pelo CFI"* · *"somente
 * São Paulo capital"*.
 *
 * LIMITE QUE MANDA NO DESENHO: quem gera a guia é a PREFEITURA, no portal da
 * NFS-e — o próprio CSV do portal traz as colunas "nº da guia" e "data de
 * quitação da guia". O CFI NÃO inventa número de guia, pela mesma regra do
 * DARE-SP: número e código de barras são do sistema do fisco. O que o app faz
 * é apurar o que há a recolher, apontar o que já está quitado e levar a guia
 * ao cliente pelo rito #293.
 *
 * A conta em si é simples e é justamente por isso que precisa de guarda: ISS
 * RETIDO pelo tomador não é recolhido pelo prestador (Lei 13.701/03 art. 9º) —
 * somar tudo faria o cliente pagar duas vezes o mesmo imposto.
 */
import type { DocumentoFiscal, IssConfig } from '../types';

/** Código IBGE de São Paulo capital — única praça coberta (Paulo, 05/08). */
export const COD_MUN_SP_CAPITAL = '3550308';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

export interface NotaIssSp {
    id: string;
    numero: string;
    data: string;
    tomador: string;
    valorServicos: number;
    /** ISS da nota (devido pelo prestador). */
    issDevido: number;
    /** ISS retido pelo tomador — o prestador NÃO recolhe esta parte. */
    issRetido: number;
    /**
     * Código do serviço e alíquota DA NOTA. Não se deriva alíquota de ISS:
     * em SP ela varia por serviço (2%, 2,5%, 3%, 5% — médico é 2%), e supor
     * 5% pra tudo é errar o imposto de uma carteira inteira.
     */
    codigoServico: string;
    aliquota: number | null;
    /** Nº da guia da Prefeitura, quando a nota já foi vinculada a uma. */
    guia?: string | null;
    quitadaEm?: string | null;
    /** ISS não gravado no documento: ausente ≠ zero. */
    semValorGravado: boolean;
}

/**
 * ISS que a empresa retém COMO TOMADORA e recolhe no lugar do prestador.
 *
 * É OUTRA obrigação, com OUTRA guia: o ISS retido na fonte é recolhido por
 * quem contratou o serviço (Lei 13.701/03 art. 9º §1º). O painel só mostrava o
 * ISS de PRESTADOR — empresa que é tomadora com retenção simplesmente não via
 * o que devia recolher (Paulo, 06/08: "essa empresa tem ISS de tomador e
 * prestador, aqui só aparece a de prestados").
 */
export interface NotaIssTomado {
    id: string;
    numero: string;
    data: string;
    prestador: string;
    valorServicos: number;
    /** ISS retido pela empresa — é ISSO que ela recolhe. */
    issRetido: number;
    semValorGravado: boolean;
}

export interface ApuracaoIssTomado {
    notas: NotaIssTomado[];
    totalServicos: number;
    totalRetido: number;
    avisos: string[];
}

export interface ApuracaoIssSp {
    competencia: string;
    notas: NotaIssSp[];
    totalServicos: number;
    totalIssDevido: number;
    totalIssRetido: number;
    /** O que o prestador recolhe: devido − retido pelo tomador. */
    aRecolher: number;
    /** Vencimento do ISS da NFS-e paulistana: dia 10 do mês seguinte. */
    vencimento: string;
    /** Notas já vinculadas a uma guia da Prefeitura. */
    jaComGuia: number;
    /** Alíquotas distintas encontradas — serviço diferente, alíquota diferente. */
    aliquotas: number[];
    /** Empresa é ISS FIXO (sociedade uniprofissional): não se apura por receita. */
    issFixoSup: boolean;
    /**
     * CCM do PRESTADOR encontrado nas próprias notas. Serve de fallback quando
     * o cadastro está vazio — e a tela DIZ que veio da nota, porque isso não
     * substitui o cadastro (a captura do portal lê o cadastro, não a nota).
     */
    ccmDasNotas: string[];
    avisos: string[];
    /** Pode seguir para a emissão da guia? */
    apta: boolean;
    /**
     * ISS RETIDO pela empresa como TOMADORA — obrigação separada, guia
     * separada. Não se soma ao ISS próprio: são impostos de operações
     * diferentes, e juntar os dois inventaria valor.
     */
    tomado: ApuracaoIssTomado;
}

/**
 * Vencimento do ISS da NFS-e de SP capital: dia 10 do mês seguinte ao da
 * emissão. Conferido na própria nota (NFS-e 782, emitida 08/07/2026 — "Data de
 * vencimento do ISS desta NFS-e: 10/08/2026").
 */
export function vencimentoIssSp(competencia: string): string {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || '').trim());
    if (!m) return '';
    let ano = Number(m[1]);
    const mesBase = Number(m[2]);
    if (mesBase < 1 || mesBase > 12) return '';
    let mes = mesBase + 1;
    if (mes > 12) { mes = 1; ano += 1; }
    return `${ano}-${String(mes).padStart(2, '0')}-10`;
}

const primeiro = (...vs: Array<unknown>): number | undefined => {
    for (const v of vs) {
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
};

/**
 * Apura o ISS próprio da competência a partir das NFS-e EMITIDAS pela empresa.
 *
 * @param docs      documentos da competência (a função filtra o que serve)
 * @param competencia 'AAAA-MM'
 */
export function apurarIssSp(
    docs: DocumentoFiscal[],
    competencia: string,
    opts: { issConfig?: IssConfig | null } = {},
): ApuracaoIssSp {
    const avisos: string[] = [];
    const notas: NotaIssSp[] = [];
    const ccms = new Set<string>();

    for (const d of docs || []) {
        const tipo = String((d as any).tipoDoc || d.tipo || '');
        if (!/NFSe/i.test(tipo)) continue;
        if (d.direcao !== 'saida') continue;                 // ISS próprio é do que a empresa PRESTOU
        if (CANCELADOS.has(String(d.status || '').toLowerCase())) continue;

        const x: any = d as any;
        const v: any = d.valores || {};
        // DUAS FORMAS, de novo. A importação de XML grava OBJETO
        // (`valores.iss`, `tomador.nome`); o importador do PORTAL SP grava
        // ACHATADO (`issDevido`, `valorIss`, `tomadorNome`, `totais.vISS`).
        // Ler só uma zera metade da base — foi o que aconteceu no 1º teste do
        // Paulo (4 notas de 4 com "não gravado" e tomador vazio), e é a MESMA
        // armadilha que já mordeu no DIFAL e na 🚦. Aqui a régua lê as duas.
        const issDevido = primeiro(v.iss, x.valorIss, x.issDevido, (d.totais as any)?.vISS);
        const retidoFlag = v.issRetido === true || x.issRetido === true;
        const retido = primeiro(v.valorIssRetido, x.valorIssRetido)
            ?? (retidoFlag ? issDevido : 0);
        const parte: any = x.tomador || d.destinatario || {};
        const nomeTomador = parte?.nome || x.tomadorNome || x.xNomeDest || '—';

        // CCM do prestador: o CSV do portal grava `prestadorCcm`; o XML traz a
        // InscricaoPrestador. Só-zeros não é inscrição (#311).
        const ccm = String(x.prestadorCcm || x.inscricaoPrestador || '').replace(/\D/g, '');
        if (ccm && /[1-9]/.test(ccm)) ccms.add(ccm);

        notas.push({
            id: d.id,
            numero: d.numero || '—',
            data: String(d.dhEmi || '').slice(0, 10),
            tomador: nomeTomador,
            valorServicos: r2(primeiro(v.baseCalculo, x.valorServicos, d.valorTotal) ?? 0),
            issDevido: r2(issDevido ?? 0),
            issRetido: r2(retido ?? 0),
            codigoServico: String(x.codigoServico || v.codigoServico || '').trim(),
            aliquota: primeiro(x.aliquotaServicos, v.aliquota) ?? null,
            guia: (d as any).guiaIss || null,
            quitadaEm: (d as any).guiaIssQuitadaEm || null,
            semValorGravado: issDevido === undefined,
        });
    }

    // ── ISS retido COMO TOMADORA (outra obrigação, outra guia) ─────────────
    const notasTomadas: NotaIssTomado[] = [];
    for (const d of docs || []) {
        const tipo = String((d as any).tipoDoc || d.tipo || '');
        if (!/NFSe/i.test(tipo)) continue;
        if (d.direcao !== 'entrada') continue;              // serviço TOMADO
        if (CANCELADOS.has(String(d.status || '').toLowerCase())) continue;

        const x: any = d as any;
        const v: any = d.valores || {};
        // Só entra o que foi efetivamente RETIDO: nota tomada sem retenção não
        // gera obrigação nenhuma pra tomadora, e listá-la seria ruído.
        const flag = v.issRetido === true || x.issRetido === true;
        const retido = primeiro(v.valorIssRetido, x.valorIssRetido);
        const issDaNota = primeiro(v.iss, x.valorIss, x.issDevido, (d.totais as any)?.vISS);
        const valorRetido = retido ?? (flag ? issDaNota : undefined);
        if (!valorRetido) continue;

        const parte: any = x.prestador || d.emitente || {};
        notasTomadas.push({
            id: d.id,
            numero: d.numero || '—',
            data: String(d.dhEmi || '').slice(0, 10),
            prestador: parte?.nome || x.prestadorNome || x.xNomeEmit || '—',
            valorServicos: r2(primeiro(v.baseCalculo, x.valorServicos, d.valorTotal) ?? 0),
            issRetido: r2(valorRetido),
            semValorGravado: retido === undefined && flag && issDaNota === undefined,
        });
    }
    notasTomadas.sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));

    const avisosTomado: string[] = [];
    const totalRetido = r2(notasTomadas.reduce((t, n) => t + n.issRetido, 0));
    const tomadoSemValor = notasTomadas.filter((n) => n.semValorGravado).length;
    if (tomadoSemValor) {
        avisosTomado.push(
            `${tomadoSemValor} nota tomada está marcada como RETIDA mas sem o valor gravado — ausência não é zero. `
            + 'Reimporte antes de recolher.',
        );
    }
    if (totalRetido > 0) {
        avisosTomado.push(
            'Este valor é de OUTRA guia: quem recolhe o ISS retido na fonte é a empresa, no lugar do prestador. '
            + 'Não some com o ISS próprio.',
        );
    }
    const tomado: ApuracaoIssTomado = {
        notas: notasTomadas,
        totalServicos: r2(notasTomadas.reduce((t, n) => t + n.valorServicos, 0)),
        totalRetido,
        avisos: avisosTomado,
    };

    notas.sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));

    const totalServicos = r2(notas.reduce((t, n) => t + n.valorServicos, 0));
    const totalIssDevido = r2(notas.reduce((t, n) => t + n.issDevido, 0));
    const totalIssRetido = r2(notas.reduce((t, n) => t + n.issRetido, 0));
    // Retido pelo tomador não é recolhido pelo prestador — somar os dois faria
    // o cliente pagar duas vezes o mesmo imposto.
    const aRecolher = r2(Math.max(0, totalIssDevido - totalIssRetido));
    const jaComGuia = notas.filter((n) => !!n.guia).length;

    const aliquotas = [...new Set(notas.map((n) => n.aliquota).filter((a): a is number => a !== null && a > 0))]
        .sort((a, b) => a - b);

    // ISS FIXO (sociedade uniprofissional): a guia é qtde de profissionais ×
    // valor por profissional, NÃO o ISS das notas (Paulo, 06/08). Apurar por
    // faturamento aqui cobraria do cliente um imposto que ele não deve daquele
    // jeito — e o valor sairia MAIOR, o que ninguém devolve depois.
    const issFixoSup = opts.issConfig?.tipo === 'sup_fixo';

    const semValor = notas.filter((n) => n.semValorGravado).length;
    if (semValor) {
        avisos.push(
            `${semValor} de ${notas.length} nota(s) sem o ISS gravado no documento — ausência NÃO é zero. `
            + 'Reimporte o CSV/XML da competência antes de emitir a guia.',
        );
    }
    if (totalIssRetido > 0) {
        avisos.push(
            `R$ ${totalIssRetido.toFixed(2)} de ISS foi RETIDO pelo tomador e não entra nesta guia — `
            + 'quem recolhe essa parte é quem contratou o serviço.',
        );
    }
    if (jaComGuia) {
        avisos.push(`${jaComGuia} nota(s) já vinculada(s) a uma guia da Prefeitura — confira antes de emitir outra.`);
    }
    if (notas.length === 0) {
        avisos.push('Nenhuma NFS-e emitida nesta competência. Sem nota não há ISS a recolher — confirme se a captura do mês já rodou.');
    }
    if (tomado.totalRetido > 0) {
        avisos.push(
            `Esta empresa TAMBÉM é tomadora com retenção: R$ ${tomado.totalRetido.toFixed(2)} de ISS retido de `
            + `${tomado.notas.length} prestador(es), que ELA recolhe — é outra guia, mostrada abaixo.`,
        );
    }
    if (issFixoSup) {
        const q = opts.issConfig?.qtdeSocios || 0;
        const vp = opts.issConfig?.valorPorSocio || 0;
        avisos.push(
            'Esta empresa é ISS FIXO (sociedade uniprofissional): a guia NÃO sai do faturamento — é '
            + `${q || '—'} profissional(is) × ${vp ? `R$ ${vp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'valor por profissional'} `
            + 'conforme a legislação do município. O ISS das notas abaixo é informativo.',
        );
    }
    if (aliquotas.length > 1) {
        avisos.push(
            `Alíquotas diferentes no mês (${aliquotas.map((a) => `${a}%`).join(', ')}) — normal quando há `
            + 'códigos de serviço distintos. Confira se cada nota saiu com a alíquota do serviço certo.',
        );
    }
    if (notas.length > 0 && aliquotas.length === 0 && totalIssDevido === 0) {
        avisos.push(
            'Todas as notas do mês estão com ISS e alíquota ZERADOS. Isso pode ser ISS fixo (SUP), isenção, '
            + 'imunidade ou retenção integral — confira antes de concluir que não há imposto a pagar.',
        );
    }

    return {
        competencia,
        notas,
        totalServicos,
        totalIssDevido,
        totalIssRetido,
        aRecolher,
        vencimento: vencimentoIssSp(competencia),
        jaComGuia,
        aliquotas,
        issFixoSup,
        ccmDasNotas: [...ccms].sort(),
        avisos,
        // Emissão só faz sentido com valor a recolher E sem buraco de dado:
        // guia a menor é o erro que a Prefeitura cobra com multa depois.
        // ISS fixo nunca libera guia por faturamento — o valor correto não
        // está nestas notas.
        apta: !issFixoSup && notas.length > 0 && semValor === 0 && aRecolher > 0,
        tomado,
    };
}

/** A empresa está na praça coberta (SP capital)? */
export function empresaEhSpCapital(dadosFiscais: { codMunIBGE?: string | null } | null | undefined): boolean {
    return String(dadosFiscais?.codMunIBGE || '').trim() === COD_MUN_SP_CAPITAL;
}
