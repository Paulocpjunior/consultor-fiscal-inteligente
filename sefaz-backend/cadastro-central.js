// ============================================================================
// sefaz-backend/cadastro-central.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O CADASTRO É UM SÓ, e o CFI é dono dele.
//
// Ideia do Paulo (07/08), depois que a colaboradora tentou apurar o R-4020 e o
// app respondeu "CNPJ não cadastrado" para uma empresa cadastrada: *"por que
// não construir um túnel que leva ao nosso BD — cadastros em geral, empresas,
// colaboradores, certificados?"*
//
// O problema que isso resolve não é conveniência: hoje o MESMO cliente existe
// no CFI, no Consultor Contábil e no Legalização, com cadastros próprios e
// grafias próprias — e cada app descobre a divergência na hora errada, no meio
// de uma obrigação. Cadastro duplicado não fica igual; ele fica PARECIDO, que
// é pior, porque ninguém desconfia.
//
// ═══ A DECISÃO QUE CORRIGE O ERRO DE HOJE NA RAIZ ═══════════════════════════
//
// O CNPJ sai daqui SEMPRE em dígitos, e a busca compara sempre em dígitos. O
// cadastro guarda em duas formas (`51227692000146` e `51.227.692/0001-46`) e
// isso derrubou a rota do R-4020. Nenhum consumidor deve precisar saber disso —
// normalizar na saída é o serviço que um cadastro central presta.
//
// ═══ O QUE ESTE TÚNEL NÃO VAI CARREGAR, E POR QUÊ ═══════════════════════════
//
// **CERTIFICADO A1 NÃO PASSA POR AQUI.** Certificado é CHAVE PRIVADA — ela
// assina documento fiscal em nome do cliente. Chave copiada é chave que não se
// controla mais: sai do Secret Manager, entra na memória de outro app, aparece
// em log, fica em cache, e se vazar ninguém sabe de qual cópia veio.
//
// O desenho certo é levar a OPERAÇÃO, não a chave: o outro app pede "assine
// isto para o CNPJ X" e quem assina é o CFI, onde a chave já mora e onde já
// existe a regra de matriz/filial por raiz (`selecionarCertA1PorBase`). Deste
// túnel o certificado sai só como METADADO — titular, validade, raiz, apto ou
// não —, que responde 100% do que o outro lado precisa saber ("dá pra
// transmitir?") sem mover nada sigiloso.
//
// FASES: 1) empresas (aqui) · 2) colaborador responsável pela carteira ·
// 3) metadados de certificado · 4) assinatura como operação remota.
// ============================================================================

export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
};

/**
 * Um documento de cadastro → a forma canônica do cadastro central.
 *
 * Lê os DOIS lugares onde cada campo pode viver (topo do doc e `dadosFiscais`),
 * que é a armadilha que o `camposConferencia` já tratava para a tela de perfil.
 * Aqui ela é tratada uma vez, para todos os apps.
 */
export function normalizarEmpresaCadastro(doc, regime) {
    if (!doc) return null;
    const df = doc.dadosFiscais || {};
    const cnpj = soDigitos(doc.cnpj);
    if (cnpj.length !== 14) return null;

    return {
        id: doc.id || null,
        // SEMPRE dígitos. É o contrato do túnel.
        cnpj,
        raiz: cnpj.slice(0, 8),
        nome: texto(doc.razaoSocial) || texto(doc.nome) || texto(doc.fantasia) || null,
        regime: regime || null,

        codCliente: texto(df.codCliente),
        cnae: texto(doc.cnae) || texto(df.cnae),
        anexo: texto(doc.anexo),
        uf: texto(df.uf) || texto(doc.uf),
        codMunIBGE: texto(df.codMunIBGE) || texto(doc.codMunIBGE),
        // CCM só existe pra SP capital, e vazio é resposta válida (#311).
        ccmSp: soDigitos(df.ccmSp || doc.ccmSp) || null,
        inscricaoMunicipal: texto(df.inscricaoMunicipal),
        dataAbertura: texto(doc.dataAbertura) || texto(df.dataAbertura),
        email: texto(doc.email) || texto(df.email),

        respLegalNome: texto(df.respLegalNome) || texto(df.responsaveisLegais?.[0]?.nome),
        contadorNome: texto(df.contadorNome),
        contadorCrc: texto(df.contadorCrc),

        // Marcações que outros apps precisam pra decidir obrigação.
        adquireDeProdutor: df.condicaoRural?.adquireDeProdutor === true,
        ehProdutorRuralPF: df.condicaoRural?.ehProdutorRuralPF === true,
        ehCooperativa: df.condicaoRural?.ehCooperativa === true,
    };
}

/**
 * O cadastro inteiro, de todas as coleções, deduplicado por CNPJ.
 *
 * Lápide e fusão ficam de fora — empresa excluída não é cadastro (#290).
 * Duplicata pelo mesmo CNPJ NÃO é escondida: vira `duplicadas`, porque sumir
 * com ela faria o outro app achar que o cadastro está limpo quando não está.
 */
export function montarCadastroEmpresas(fontes = []) {
    const porCnpj = new Map();
    const duplicadas = [];
    let ignoradasSemCnpj = 0;

    for (const { docs, regime } of fontes) {
        for (const doc of docs || []) {
            if (!doc || doc._deleted || doc._merged_into) continue;
            const e = normalizarEmpresaCadastro(doc, regime);
            if (!e) { ignoradasSemCnpj += 1; continue; }
            if (porCnpj.has(e.cnpj)) {
                duplicadas.push({ cnpj: e.cnpj, nome: e.nome, id: e.id, regime: e.regime });
                continue;
            }
            porCnpj.set(e.cnpj, e);
        }
    }

    const empresas = [...porCnpj.values()]
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    return {
        empresas,
        resumo: {
            total: empresas.length,
            simples: empresas.filter((e) => e.regime === 'simples').length,
            lucro: empresas.filter((e) => e.regime === 'lucro').length,
            duplicadas: duplicadas.length,
            // Cadastro sem CNPJ não some em silêncio: é justamente o que faz o
            // outro app procurar um cliente que "existe" e não é encontrado.
            ignoradasSemCnpj,
        },
        duplicadas,
        avisos: avisosDoCadastro({ total: empresas.length, duplicadas, ignoradasSemCnpj }),
    };
}

function avisosDoCadastro({ total, duplicadas, ignoradasSemCnpj }) {
    const out = [
        'O CNPJ sai SEMPRE em dígitos. O cadastro guarda em duas formas, e normalizar na saída é '
        + 'o serviço que este túnel presta — nenhum consumidor precisa saber disso.',
        'Certificado A1 NÃO trafega por aqui: é chave privada que assina em nome do cliente. Deste '
        + 'túnel sai apenas metadado (titular, validade, raiz, apto); a assinatura é operação do CFI.',
    ];
    if (duplicadas.length) {
        out.push(`${duplicadas.length} cadastro(s) com CNPJ repetido — o primeiro venceu, mas a duplicata `
            + 'vem na resposta em vez de sumir: esconder faria o outro app achar que o cadastro está limpo.');
    }
    if (ignoradasSemCnpj) {
        out.push(`${ignoradasSemCnpj} cadastro(s) sem CNPJ válido ficaram de fora — é o que faz alguém `
            + 'procurar um cliente que "existe" e não é encontrado.');
    }
    if (!total) {
        out.push('NENHUMA empresa no cadastro. Isso não é "escritório sem clientes": é falha de leitura.');
    }
    return out;
}
