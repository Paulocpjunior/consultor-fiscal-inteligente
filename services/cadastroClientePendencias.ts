/**
 * O que falta no cadastro de um cliente — e o que cada falta QUEBRA.
 *
 * A correção de cadastro era caça ao tesouro: o colaborador via um trilho
 * falhando (captura, SPED, envio de guia) e tinha que adivinhar qual campo
 * estava vazio, em qual tela. Aqui a conta é invertida: a partir do cadastro,
 * dizemos o que falta, o que isso impede HOJE e onde se resolve.
 *
 * Regra: cada pendência precisa do IMPACTO real. "Falta UF" não move ninguém;
 * "sem UF a captura da SEFAZ nem é tentada e o SPED não gera" move.
 */

export type GravidadePendencia = 'bloqueia' | 'atencao';

export interface PendenciaCadastro {
    campo: string;
    /** O que deixa de funcionar enquanto estiver assim. */
    impacto: string;
    gravidade: GravidadePendencia;
    /** Onde se resolve. */
    onde: string;
}

export interface EmpresaParaConferir {
    nome?: string | null;
    cnpj?: string | null;
    regime?: 'simples' | 'lucro' | string | null;
    uf?: string | null;
    codMunIBGE?: string | number | null;
    inscricaoEstadual?: string | null;
    inscricaoMunicipal?: string | null;
    ccmSp?: string | null;
    email?: string | null;
    telefone?: string | null;
    cnae?: string | null;
    anexo?: string | null;
    dataAbertura?: string | null;
    /** Responsável LEGAL (sócio/administrador) — identificação dos relatórios. */
    respLegalNome?: string | null;
    /** Contador responsável — identificação dos relatórios. */
    contadorNome?: string | null;
    contadorCrc?: string | null;
    /** Colaboradores responsáveis (vínculos da carteira). */
    responsaveis?: Array<{ nome?: string | null; papel?: string | null }>;
}

const vazio = (v: unknown) => v == null || String(v).trim() === '';
const COD_MUN_SP_CAPITAL = '3550308';

/**
 * Lista as pendências do cadastro, das que travam para as que só merecem
 * atenção. Função pura — a tela só desenha.
 */
export function conferirCadastroCliente(e: EmpresaParaConferir): PendenciaCadastro[] {
    const p: PendenciaCadastro[] = [];
    if (!e) return p;

    // ── Responsável: é o pedido central. Cliente sem dono não entra em
    //    carteira nenhuma, some dos painéis por colaborador e ninguém é
    //    cobrado por ele.
    const temPrincipal = (e.responsaveis || []).some((r) => (r?.papel || 'principal') === 'principal' && !vazio(r?.nome));
    if (!temPrincipal) {
        p.push({
            campo: 'Responsável pela empresa',
            impacto: 'Cliente sem responsável não aparece na carteira de ninguém: some dos painéis por colaborador, e as cobranças de prazo não têm destinatário.',
            gravidade: 'bloqueia',
            onde: 'Aqui mesmo, na seção Responsável.',
        });
    }

    if (vazio(e.uf)) {
        p.push({
            campo: 'UF',
            impacto: 'Sem UF a captura da SEFAZ nem é tentada e o SPED Fiscal não gera.',
            gravidade: 'bloqueia',
            onde: 'Dados fiscais → UF.',
        });
    }

    if (vazio(e.codMunIBGE)) {
        p.push({
            campo: 'Código do município (IBGE)',
            impacto: 'É o município que decide o trilho da NFS-e: SP capital vai pelo portal, o resto pelo Padrão Nacional (ADN). Sem ele o app não escolhe caminho nenhum.',
            gravidade: 'bloqueia',
            onde: 'Dados fiscais → Código Município IBGE.',
        });
    }

    if (vazio(e.inscricaoEstadual)) {
        p.push({
            campo: 'Inscrição Estadual',
            impacto: 'Falta no SPED Fiscal e na GIA. Empresa isenta deve ficar com "ISENTO" — o campo em branco não diz se é isenta ou se ninguém preencheu.',
            gravidade: 'atencao',
            onde: 'Dados fiscais → Inscrição Estadual.',
        });
    }

    // CCM só existe em SP capital (#311). Cobrar de quem é de outro município
    // seria pedir um dado que não existe.
    const ehSpCapital = String(e.codMunIBGE || '') === COD_MUN_SP_CAPITAL;
    if (ehSpCapital && vazio(e.ccmSp)) {
        p.push({
            campo: 'CCM (Inscrição Municipal de SP capital)',
            impacto: 'Sem CCM a captura da NFS-e no portal da Prefeitura de SP não roda.',
            gravidade: 'bloqueia',
            onde: 'Dados fiscais → CCM.',
        });
    }
    if (!ehSpCapital && !vazio(e.ccmSp)) {
        p.push({
            campo: 'CCM preenchido fora de SP capital',
            impacto: 'O CCM é específico da capital. Se esse número é a inscrição municipal local, ele está no campo errado.',
            gravidade: 'atencao',
            onde: 'Dados fiscais → mova para Inscrição Municipal.',
        });
    }

    if (vazio(e.email)) {
        p.push({
            campo: 'E-mail do cliente',
            impacto: 'É para onde vão guias e comunicados. Sem ele, todo envio vira trabalho manual.',
            gravidade: 'atencao',
            onde: 'Dados fiscais → Email.',
        });
    }

    if (vazio(e.cnae)) {
        p.push({
            campo: 'CNAE principal',
            impacto: 'Define presunção, anexo e correlação de CFOP. Em branco, o cálculo usa o padrão do regime — que pode não ser o da atividade.',
            gravidade: 'atencao',
            onde: 'Cadastro da empresa → CNAE.',
        });
    }

    if (String(e.regime) === 'simples' && vazio(e.anexo)) {
        p.push({
            campo: 'Anexo do Simples',
            impacto: 'Sem anexo o DAS não é calculado.',
            gravidade: 'bloqueia',
            onde: 'Cadastro da empresa → Anexo.',
        });
    }

    // Identificação obrigatória dos relatórios (Paulo, 01/08): responsável
    // LEGAL da empresa + contador. Sem eles o PDF sai com "não cadastrado"
    // escrito — e relatório de faturamento/obrigação não deve ir assim.
    if (vazio(e.respLegalNome)) {
        p.push({
            campo: 'Responsável legal da empresa',
            impacto: 'Todo relatório emitido (faturamento, livros, obrigações) leva a identificação do responsável — sem o nome, o PDF sai com "não cadastrado" escrito.',
            gravidade: 'atencao',
            onde: 'Dados fiscais → Responsável legal e contador.',
        });
    }
    if (vazio(e.contadorNome) || vazio(e.contadorCrc)) {
        p.push({
            campo: vazio(e.contadorNome) ? 'Contador responsável' : 'CRC do contador',
            impacto: 'A identificação do contador (nome + CRC) é obrigatória nos relatórios e obrigações acessórias emitidos pelo app.',
            gravidade: 'atencao',
            onde: 'Dados fiscais → Responsável legal e contador.',
        });
    }

    if (vazio(e.dataAbertura)) {
        p.push({
            campo: 'Data de abertura',
            impacto: 'Empresa com menos de 12 meses precisa do RBT12 proporcionalizado. Sem a data, o app assume 12 meses cheios e o DAS pode sair errado.',
            gravidade: 'atencao',
            onde: 'Cadastro da empresa → Data de abertura.',
        });
    }

    const peso = { bloqueia: 0, atencao: 1 };
    return p.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}

export interface ResumoCadastro {
    total: number;
    bloqueios: number;
    atencoes: number;
    farol: 'ok' | 'atencao' | 'bloqueado';
    resumo: string;
    /**
     * O CAMPO da pendência mais grave — o motivo dominante. Farol sem motivo ao
     * lado gera exatamente a dúvida que a equipe trouxe (31/07): "o cadastro
     * está certo e mesmo assim aparece 1 revisar". Um número sozinho não diz o
     * que revisar; o nome do campo diz.
     */
    motivo: string | null;
    /** Todos os campos pendentes, do mais grave ao menos — para tooltip/lista. */
    campos: string[];
}

/** Farol do cadastro — honesto: pendência que trava nunca vira verde. */
export function resumirCadastro(pendencias: PendenciaCadastro[]): ResumoCadastro {
    const bloqueios = pendencias.filter((p) => p.gravidade === 'bloqueia').length;
    const atencoes = pendencias.length - bloqueios;
    const campos = pendencias.map((p) => p.campo);
    const motivo = campos[0] || null;
    // "e mais N" em vez de listar tudo: o card é estreito e a lista completa
    // vive no modal, com impacto e onde resolver.
    const comMotivo = (txt: string) => (motivo ? `${txt}: ${motivo}${campos.length > 1 ? ` (e mais ${campos.length - 1})` : ''}` : txt);
    return {
        total: pendencias.length,
        bloqueios,
        atencoes,
        motivo,
        campos,
        farol: bloqueios > 0 ? 'bloqueado' : atencoes > 0 ? 'atencao' : 'ok',
        resumo: bloqueios > 0
            ? `${comMotivo(`${bloqueios} pendência(s) travando trilho`)}${atencoes > 0 ? ` · ${atencoes} para revisar` : ''}.`
            : atencoes > 0
                ? `${comMotivo(`${atencoes} ponto(s) para revisar`)} — nada travando a captura.`
                : 'Cadastro completo.',
    };
}
