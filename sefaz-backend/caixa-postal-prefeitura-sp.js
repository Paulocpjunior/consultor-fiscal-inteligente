// ============================================================================
// sefaz-backend/caixa-postal-prefeitura-sp.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 O CANAL "PREFEITURA SP" DIZIA "CCM NÃO CONFIGURADO" PARA A CARTEIRA
// INTEIRA — inclusive para quem tem CCM, e inclusive para quem NÃO É DE SP.
//
// 29/08, achado na sequência do caso LAV. O provider tem a assinatura
// `listarMensagensPrefeituraSP(empresaCnpj, ccmSp)` e **os dois chamadores
// passam UM argumento só**. Com `ccmSp` sempre `undefined`, o canal caía no
// early return e devolvia, para TODA empresa:
//
//     "CCM (inscrição municipal SP) não configurado — preencha em
//      Empresas → Dados Fiscais"
//
// 🔴 **São DOIS defeitos somados, e o segundo é o pior**:
//
//  1. **A frase é FALSA sobre o cadastro.** Empresa que preencheu o CCM lia
//     que não preencheu. É o custo do dia inteiro do caso LAV, de novo: o
//     colaborador vai conferir um campo que está certo.
//
//  2. **Ela manda preencher um campo que a empresa NÃO TEM E NÃO PRECISA.**
//     O CCM só existe em **SP capital**; a maioria da carteira não é de lá (a
//     medição de 22/08: 272 dos 394 municípios com sistema próprio). Para
//     essas, a NFS-e vem pelo **Padrão Nacional (ADN)** ou pelo município — e
//     mandar preencher CCM é o *"aviso que aponta um lugar que não resolve"*
//     (achado 18, 21/08), na forma mais cara: a pessoa procura, preenche, e
//     nada muda.
//
// ═══ O QUE ESTA RÉGUA FAZ ═══════════════════════════════════════════════════
//
// Responde *"este canal se aplica a esta empresa, e com qual CCM?"* — três
// situações com AÇÕES DIFERENTES, que a frase única fundia numa mentira só:
//
//  · **não se aplica** — o município dela não é a capital: o canal fica
//    NEUTRO, sem mandar preencher nada, e a frase diz por onde a NFS-e dela
//    chega de verdade.
//  · **falta o CCM** — é da capital e o campo está vazio: aí a frase antiga
//    era VERDADEIRA, e continua.
//  · **pronto** — é da capital e tem CCM: o canal consulta de fato.
//
// ⚠️ **QUEM RESPONDE PELO MUNICÍPIO É O DONO** (`caminhoNfseRecomendado`), e
// quem responde pelo CCM é `ccmSpDaEmpresa` — que lê as DUAS formas (achatada
// e aninhada) e trata a sequência de zeros como VAZIO. Escrever qualquer uma
// das duas aqui seria a segunda cópia que este projeto mais paga: em 29/08 o
// CCM tinha QUATRO cópias, e uma delas se declarava cópia no comentário.
//
// ⚠️ **SEM MUNICÍPIO CADASTRADO, O CCM DECIDE — e não vira "não se aplica".**
// Ausência não é prova (a régua da uf-desconhecida, 15/08): empresa com CCM
// preenchido e município em branco é, quase certamente, da capital — e tratá-la
// como "não se aplica" apagaria o canal de quem ele existe para servir.
// ============================================================================

import { caminhoNfseRecomendado, CAMINHO_NFSE } from './municipio-nfse-caminho.js';
import { ccmSpDaEmpresa } from './ccm-sp.js';

/**
 * O canal da Prefeitura de SP se aplica a esta empresa?
 *
 * @param {object} empresa  doc de simples_empresas/lucro_empresas
 * @returns {{aplicavel: boolean, ccm: string, situacao: string, motivo: string|null}}
 */
export function canalPrefeituraSp(empresa) {
    // O dono do CCM lê as duas formas e devolve '' para a sequência de zeros.
    const ccm = ccmSpDaEmpresa(empresa);
    const cod = String(empresa?.dadosFiscais?.codMunIBGE ?? empresa?.codMunIBGE ?? '').replace(/\D/g, '');

    // Sem município cadastrado, o CCM é o que temos — e ele só existe na
    // capital. Ausência de município não pode virar "não se aplica".
    const daCapital = cod
        ? caminhoNfseRecomendado(cod).caminho === CAMINHO_NFSE.SP_PORTAL
        : ccm !== '';

    if (!daCapital) {
        const m = cod ? caminhoNfseRecomendado(cod) : null;
        const onde = m?.nome ? `${m.nome}/${m.uf}` : 'outro município';
        return {
            aplicavel: false,
            ccm: '',
            situacao: 'nao-se-aplica',
            // 🚨 A frase NÃO manda preencher CCM: a empresa não tem e não
            // precisa de um. Ela diz por onde a NFS-e dela chega.
            motivo: `Este canal é da Prefeitura de SÃO PAULO CAPITAL e a empresa é de ${onde} — `
                + 'a NFS-e dela não passa por aqui. Ela chega pelo Padrão Nacional (ADN) ou pela '
                + 'importação do próprio município (Central de XMLs → Importar).',
        };
    }

    if (!ccm) {
        return {
            aplicavel: true,
            ccm: '',
            situacao: 'sem-ccm',
            motivo: 'CCM (inscrição municipal de SP capital) não cadastrado — preencha em '
                + 'Empresas → Dados Fiscais. Sem ele a Prefeitura não identifica o tomador.',
        };
    }

    return { aplicavel: true, ccm, situacao: 'pronto', motivo: null };
}
