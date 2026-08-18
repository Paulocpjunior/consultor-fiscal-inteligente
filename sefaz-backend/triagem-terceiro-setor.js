/**
 * triagem-terceiro-setor — quem PARECE imune, isenta ou entidade sem fins
 * lucrativos, para que o pedido ao colaborador seja pequeno.
 *
 * ═══ POR QUE ESTE MÓDULO EXISTE ═════════════════════════════════════════════
 *
 * Paulo, 18/08, depois de ver uma IGREJA cadastrada como Lucro Presumido: *"é
 * uma falta grave, como um sistema de apuração e tributos não tem campo de
 * regime de tributação — o que eu tenho que pedir p colaborador?"*
 *
 * A resposta errada seria "preencham o regime das ~390 empresas". Isso é fila de
 * trabalho manual do tamanho da carteira, e Paulo já recusou esse desenho uma vez
 * (16/08, calendário municipal: *"eu não vou fazer nada manual"*).
 *
 * A resposta certa é: **o regime deduzido acerta na esmagadora maioria** —
 * Simples, Presumido e Real já saem certos da coleção e do `regimePadrao`. O que
 * o app NÃO tem como saber é quem é **imune, isenta ou terceiro setor**, e essas
 * são POUCAS. Então o pedido vira "confirme esta lista de N", não "preencha 390".
 *
 * ═══ O QUE ELE É, E O QUE ELE NÃO É ═════════════════════════════════════════
 *
 * É **SUGESTÃO CARIMBADA COM A ORIGEM** — a mesma figura do `tipoSocietarioNoNome`
 * no FUNRURAL (13/08): o app aponta, a pessoa confirma, e o valor só passa a
 * valer depois disso. Ele **NÃO grava regime nenhum** e **não tira ninguém de
 * apuração**: enquanto ninguém confirmar, a empresa segue exatamente como está.
 *
 * ⚠️ E o sinal é fraco de propósito no que é fraco: CNAE de ESCOLA ou de CLÍNICA
 * não diz nada sobre imunidade (há escola e clínica com fins lucrativos aos
 * montes). Só entram os sinais que apontam a NATUREZA da entidade.
 */

import { tipoSocietarioNoNome } from './dipam-produtor-rural.js';

/** Sem acento, caixa alta, espaços colapsados — para casar por palavra. */
function normalizar(txt) {
    return String(txt == null ? '' : txt)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * TERMOS QUE APONTAM A NATUREZA DA ENTIDADE NA RAZÃO SOCIAL.
 *
 * Casam por FRONTEIRA de palavra: sem isso "INSTITUTO" pegaria "INSTITUTOS" e,
 * pior, "PARÓQUIA" dentro de outra palavra. É a mesma régua de fronteira que a
 * família do Gemini e a do domínio oficial já usam.
 */
export const TERMOS_TERCEIRO_SETOR = [
    { re: /\bIGREJA\b/, rotulo: 'Igreja', peso: 'forte' },
    { re: /\bPAROQUIA\b/, rotulo: 'Paróquia', peso: 'forte' },
    { re: /\bMITRA\b/, rotulo: 'Mitra', peso: 'forte' },
    { re: /\bTEMPLO\b/, rotulo: 'Templo', peso: 'forte' },
    { re: /\bCENTRO ESPIRITA\b/, rotulo: 'Centro espírita', peso: 'forte' },
    { re: /\bCOMUNIDADE (EVANGELICA|CRISTA|RELIGIOSA)\b/, rotulo: 'Comunidade religiosa', peso: 'forte' },
    { re: /\bASSOCIACAO\b/, rotulo: 'Associação', peso: 'forte' },
    { re: /\bFUNDACAO\b/, rotulo: 'Fundação', peso: 'forte' },
    { re: /\bSINDICATO\b/, rotulo: 'Sindicato', peso: 'forte' },
    { re: /\bFEDERACAO\b/, rotulo: 'Federação', peso: 'forte' },
    { re: /\bCONFEDERACAO\b/, rotulo: 'Confederação', peso: 'forte' },
    { re: /\bOSCIP\b/, rotulo: 'OSCIP', peso: 'forte' },
    { re: /\bPARTIDO\b/, rotulo: 'Partido político', peso: 'forte' },
    // ⚠️ FRACOS: aparecem MUITO em empresa com fins lucrativos
    // ("INSTITUTO DE BELEZA", "CASA DE REPOUSO LTDA"). Entram porque errar para
    // MENOS aqui é deixar a entidade apurando imposto que não existe — mas
    // entram MARCADOS, e sozinhos não bastam para virar candidato.
    { re: /\bINSTITUTO\b/, rotulo: 'Instituto', peso: 'fraco' },
    { re: /\bSOCIEDADE BENEFICENTE\b/, rotulo: 'Sociedade beneficente', peso: 'forte' },
    { re: /\bSANTA CASA\b/, rotulo: 'Santa Casa', peso: 'forte' },
    { re: /\bLAR\b/, rotulo: 'Lar (assistencial)', peso: 'fraco' },
    { re: /\bCASA DE\b/, rotulo: 'Casa de…', peso: 'fraco' },
];

/**
 * CNAEs que descrevem a NATUREZA da entidade.
 *
 * Só a divisão 94 (organizações associativas) e a religiosa entram. Educação e
 * saúde ficam de FORA: elas dizem o que a entidade FAZ, não o que ela É, e há
 * escola e hospital com fins lucrativos em quantidade — usá-los encheria a fila
 * de falso positivo, que é o jeito de a equipe parar de olhar a fila.
 */
export const CNAES_TERCEIRO_SETOR = [
    { prefixo: '9491', rotulo: 'Atividades de organizações religiosas' },
    { prefixo: '9492', rotulo: 'Atividades de organizações políticas' },
    { prefixo: '9493', rotulo: 'Atividades de organizações associativas ligadas à cultura e à arte' },
    { prefixo: '9411', rotulo: 'Atividades de organizações associativas patronais e empresariais' },
    { prefixo: '9412', rotulo: 'Atividades de organizações associativas profissionais' },
    { prefixo: '9420', rotulo: 'Atividades de organizações sindicais' },
    { prefixo: '9430', rotulo: 'Atividades de associações de defesa de direitos sociais' },
    { prefixo: '9499', rotulo: 'Outras atividades associativas' },
];

/** Sinais achados na razão social. */
export function sinaisDoNome(nome) {
    const n = normalizar(nome);
    if (!n) return [];
    return TERMOS_TERCEIRO_SETOR
        .filter(t => t.re.test(n))
        .map(t => ({ tipo: 'nome', rotulo: t.rotulo, peso: t.peso }));
}

/** Sinal achado no CNAE (só dígitos, casa por prefixo). */
export function sinalDoCnae(cnae) {
    const d = String(cnae == null ? '' : cnae).replace(/\D/g, '');
    if (d.length < 4) return null;
    const achado = CNAES_TERCEIRO_SETOR.find(c => d.startsWith(c.prefixo));
    return achado ? { tipo: 'cnae', rotulo: achado.rotulo, peso: 'forte' } : null;
}

/**
 * A empresa é candidata? E por quê?
 *
 * 🚨 O SINAL NEGATIVO É TÃO IMPORTANTE QUANTO O POSITIVO: razão social com tipo
 * societário empresarial (LTDA, S.A., EIRELI) é SOCIEDADE — e sociedade
 * empresária não é entidade sem fins lucrativos. É a mesma leitura que já
 * resolveu metade das pendências do FUNRURAL em 13/08: **a razão social diz o
 * que a empresa é**. Sem essa trava, todo "INSTITUTO DE BELEZA LTDA" cairia na
 * fila e a fila deixaria de ser lida.
 *
 * ⚠️ ME e EPP NÃO contam como tipo societário — são PORTE. A régua de
 * `tipoSocietarioNoNome` já trata isso, e por isso ela é reusada em vez de
 * reescrita.
 */
export function triarEmpresa(empresa) {
    const nome = empresa?.nome || empresa?.razaoSocial || '';
    const jaClassificada = String(empresa?.regimeTributario || '').trim();

    const sinais = sinaisDoNome(nome);
    const cnae = sinalDoCnae(empresa?.cnae);
    if (cnae) sinais.push(cnae);

    const societario = tipoSocietarioNoNome(nome);
    const fortes = sinais.filter(s => s.peso === 'forte');

    if (!sinais.length) {
        return { candidata: false, motivo: 'nenhum-sinal', sinais: [], societario };
    }
    if (societario) {
        return {
            candidata: false,
            motivo: 'sociedade-empresaria',
            sinais,
            societario,
            explicacao: `A razão social diz ${societario} — sociedade empresária não é entidade sem fins `
                + 'lucrativos. Se esta empresa for imune ou isenta mesmo assim, marque na mão: o app não '
                + 'contraria a razão social sozinho.',
        };
    }
    // Sinal FRACO sozinho não vira candidato: "INSTITUTO" e "CASA DE" aparecem
    // em empresa comum, e fila com falso positivo é fila que ninguém abre.
    if (!fortes.length) {
        return { candidata: false, motivo: 'so-sinal-fraco', sinais, societario };
    }
    return {
        candidata: true,
        motivo: jaClassificada ? 'ja-classificada' : 'a-confirmar',
        sinais,
        societario,
        jaClassificada: jaClassificada || null,
        explicacao: `Razão social/CNAE aponta ${fortes.map(s => s.rotulo).join(', ')}. `
            + 'É SUGESTÃO, não decisão: o regime só muda quando alguém confirmar no cadastro.',
    };
}

/**
 * A fila para a equipe: quem confirmar, e em que ordem.
 *
 * Ordena por NOME (a lista é curta e a busca é visual). O que já foi
 * classificado NÃO some — vem em `jaClassificadas`, porque some da tela é o que
 * faz alguém achar que a fila acabou quando ela só ficou invisível.
 */
export function triarCarteira(empresas = []) {
    const aConfirmar = [];
    const jaClassificadas = [];
    const barradasPorSociedade = [];

    for (const e of empresas || []) {
        const r = triarEmpresa(e);
        const linha = {
            id: e?.id || null,
            cnpj: e?.cnpj || null,
            nome: e?.nome || e?.razaoSocial || '(sem nome)',
            regimeTributario: e?.regimeTributario || null,
            sinais: r.sinais.map(s => s.rotulo),
            explicacao: r.explicacao || null,
        };
        if (r.candidata && r.motivo === 'a-confirmar') aConfirmar.push(linha);
        else if (r.candidata) jaClassificadas.push(linha);
        else if (r.motivo === 'sociedade-empresaria') barradasPorSociedade.push({ ...linha, societario: r.societario });
    }

    const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    aConfirmar.sort(porNome);
    jaClassificadas.sort(porNome);
    barradasPorSociedade.sort(porNome);

    return {
        aConfirmar,
        jaClassificadas,
        // Não é lixo: é o que o app DEIXOU de sugerir e por quê. Sem isso,
        // ninguém descobre que a régua barrou uma entidade que era candidata.
        barradasPorSociedade,
        resumo: {
            total: (empresas || []).length,
            aConfirmar: aConfirmar.length,
            jaClassificadas: jaClassificadas.length,
            barradasPorSociedade: barradasPorSociedade.length,
        },
    };
}
