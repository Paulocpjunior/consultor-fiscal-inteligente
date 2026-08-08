// ============================================================================
// sefaz-backend/cadastro-central-certificados.js  (PURO — testável)
// ----------------------------------------------------------------------------
// FASE 3 DO TÚNEL: "DÁ PRA TRANSMITIR?" — respondido sem mover a chave.
//
// ═══ A PERGUNTA QUE O OUTRO APP FAZ ═════════════════════════════════════════
//
// O Consultor Contábil vai transmitir EFD-Reinf; o Legalização acompanha
// certificado vencendo. Os dois precisam da MESMA resposta, e nenhum dos dois
// precisa da chave para tê-la: *"este CNPJ está apto a assinar hoje, e até
// quando?"*
//
// ═══ POR QUE O CERTIFICADO NUNCA VIAJA, E ISSO NÃO É EXCESSO DE ZELO ════════
//
// Certificado A1 é CHAVE PRIVADA: ela assina documento fiscal em nome do
// cliente. Chave copiada é chave que não se controla mais — sai do Secret
// Manager, entra na memória de outro app, vira log, vira cache, e se vazar
// ninguém sabe de qual cópia veio. O desenho é levar a OPERAÇÃO, não a chave:
// quem assina é o CFI, onde a chave já mora (fase 4).
//
// Daqui sai só METADADO — titular, emissor, validade, raiz, apto —, que
// responde 100% da pergunta. `storagePath`, `passwordEnc` e o próprio arquivo
// NÃO existem na saída, e o teste tranca isso.
//
// ═══ A REGRA DA RAIZ VALE AQUI TAMBÉM (Paulo, 27/07 — caso J.N. VINATEX) ════
//
// Filial NÃO precisa de certificado próprio: usa o A1 válido da matriz (mesma
// raiz de 8 dígitos). Um túnel que respondesse só "esta empresa tem cert?"
// diria NÃO para filial apta — e o outro app deixaria de transmitir por um
// impedimento que não existe. Por isso a resposta distingue `apto-proprio` de
// `apto-pela-raiz`, e nomeia DE QUEM é o certificado emprestado: quem assina
// em nome de terceiro tem que saber que está fazendo isso.
//
// ═══ RÉGUA DE VENCIMENTO NUM LUGAR SÓ ═══════════════════════════════════════
//
// As faixas (30/15/7/3/1/expirado) vêm de `cert-vencimento-helper.js`, que já
// serve o cron de alerta e o painel admin. Escrever "≤30 dias" à mão aqui
// criaria a terceira cópia da mesma régua — foi o defeito que a
// `urgencia-vencimento.js` corrigiu do outro lado.
// ============================================================================

import { faixaDeVencimento, diasAteVencimento } from './cert-vencimento-helper.js';
import { cnpjBase, limparCnpj } from './cert-base-helper.js';

const texto = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
};

/**
 * O titular legível, tirado do subject do certificado (CN=...). O subject cru
 * é uma sopa de atributos; quem lê do outro lado quer o nome.
 */
export function titularDoSubject(subject) {
    const s = texto(subject);
    if (!s) return null;
    const m = /(?:^|,\s*)CN=([^,]+)/i.exec(s);
    return texto(m ? m[1] : s);
}

/**
 * UM certificado → metadado público. É aqui que a chave fica para trás.
 *
 * Note o que NÃO é copiado: `storagePath`, `passwordEnc`, `sizeBytes`. Não é
 * esquecimento — é o contrato.
 */
export function metadadoDoCertificado(cert, agora = new Date()) {
    if (!cert) return null;
    const cnpj = limparCnpj(cert.cnpj || cert.cnpjCert);
    const dias = diasAteVencimento(cert.notAfter, agora);
    return {
        empresaId: cert.empresaId || null,
        cnpj: cnpj || null,
        raiz: cnpjBase(cnpj) || null,
        tipo: cert.tipoCert || 'A1',
        titular: titularDoSubject(cert.subject),
        emissor: texto(cert.issuer),
        validoAte: texto(cert.notAfter),
        diasParaVencer: dias,
        faixaAlerta: faixaDeVencimento(dias),
        // Impressão digital do certificado PÚBLICO: identifica sem revelar. É
        // ela que permite ao outro app dizer "é o mesmo certificado".
        fingerprint: texto(cert.fingerprint),
        // Só a EXISTÊNCIA das partes sigilosas, nunca o conteúdo.
        temArquivo: !!(cert.storagePath || cert.hasStoragePath),
        temSenha: !!(cert.passwordEnc || cert.hasPasswordEnc),
    };
}

/** O certificado está inteiro e vivo para assinar em nuvem? */
function assinavelEmNuvem(m) {
    if (!m) return false;
    if (m.tipo !== 'A1') return false;              // A3 é token físico
    if (!m.temArquivo || !m.temSenha) return false; // cadastro pela metade
    return m.diasParaVencer !== null && m.diasParaVencer > 0;
}

/**
 * A resposta do túnel para UM CNPJ: apto ou não, e por quê.
 *
 * @param {object} p
 * @param {string} p.cnpj        o CNPJ perguntado (14 dígitos)
 * @param {Array}  p.certificados  docs de `empresas_certificados`
 * @param {Date}   [p.agora]
 */
export function aptidaoDeAssinatura({ cnpj, certificados = [], agora = new Date() } = {}) {
    const alvo = limparCnpj(cnpj);
    const raiz = cnpjBase(alvo);
    const metas = (certificados || []).map((c) => metadadoDoCertificado(c, agora)).filter(Boolean);

    const proprio = metas.find((m) => m.cnpj === alvo) || null;
    // Da MESMA RAIZ, o que vence mais tarde — mesma escolha do
    // `selecionarCertA1PorBase`, que é quem assina de verdade.
    const daRaiz = metas
        .filter((m) => m.raiz && m.raiz === raiz && m.cnpj !== alvo && assinavelEmNuvem(m))
        .sort((a, b) => String(b.validoAte).localeCompare(String(a.validoAte)))[0] || null;

    if (proprio && assinavelEmNuvem(proprio)) {
        return {
            cnpj: alvo, apto: true, situacao: 'apto-proprio',
            motivo: `Certificado A1 próprio, válido até ${proprio.validoAte} (${proprio.diasParaVencer} dia(s)).`,
            acao: proprio.faixaAlerta
                ? `Vence em ${proprio.diasParaVencer} dia(s) — providencie a renovação antes que a transmissão pare.`
                : null,
            certificado: proprio, certificadoDaRaiz: null,
        };
    }

    // FILIAL COM O CERT DA MATRIZ: apta, mas quem assina é outro CNPJ — e isso
    // tem que estar dito, não deduzido.
    if (daRaiz) {
        return {
            cnpj: alvo, apto: true, situacao: 'apto-pela-raiz',
            motivo: `Sem certificado próprio, mas a raiz ${raiz} tem A1 válido (CNPJ ${daRaiz.cnpj}, `
                + `titular ${daRaiz.titular || '—'}), válido até ${daRaiz.validoAte}. Filial usa o certificado `
                + 'da matriz — não precisa de um próprio.',
            acao: null,
            certificado: null, certificadoDaRaiz: daRaiz,
        };
    }

    if (!proprio) {
        return {
            cnpj: alvo, apto: false, situacao: 'sem-certificado',
            motivo: 'Nenhum certificado cadastrado para este CNPJ nem para a raiz dele.',
            acao: 'Suba o A1 na ficha da empresa no Consultor Fiscal. Sem certificado não há transmissão.',
            certificado: null, certificadoDaRaiz: null,
        };
    }
    if (proprio.tipo !== 'A1') {
        return {
            cnpj: alvo, apto: false, situacao: 'a3-nao-assina-em-nuvem',
            motivo: `O certificado cadastrado é ${proprio.tipo} — token físico, que não assina em servidor.`,
            acao: 'Para transmitir pelo sistema é preciso um A1 (arquivo). Enquanto não houver, a transmissão '
                + 'é manual, com o token na máquina de quem assina.',
            certificado: proprio, certificadoDaRaiz: null,
        };
    }
    if (!proprio.temArquivo || !proprio.temSenha) {
        return {
            cnpj: alvo, apto: false, situacao: 'cadastro-incompleto',
            motivo: 'O certificado está cadastrado pela metade: '
                + [!proprio.temArquivo && 'falta o arquivo', !proprio.temSenha && 'falta a senha']
                    .filter(Boolean).join(' e ') + '.',
            acao: 'Refaça o envio do A1 na ficha da empresa — cadastro incompleto não assina.',
            certificado: proprio, certificadoDaRaiz: null,
        };
    }
    return {
        cnpj: alvo, apto: false, situacao: 'vencido',
        motivo: `Certificado VENCIDO em ${proprio.validoAte}.`,
        acao: 'Renove o A1 e suba o novo na ficha da empresa. Certificado vencido para tudo de uma vez: '
            + 'SEFAZ, e-CAC, SERPRO e manifestação.',
        certificado: proprio, certificadoDaRaiz: null,
    };
}

/**
 * O panorama de todo o cadastro — quem pode transmitir hoje e quem vai parar.
 *
 * Empresa SEM certificado NÃO some: é ela que faz o outro app achar que a
 * carteira inteira está apta. Mesma regra da fase 2.
 */
export function montarCertificados({ empresas = [], certificados = [], agora = new Date() } = {}) {
    const linhas = empresas.map((e) => {
        const a = aptidaoDeAssinatura({ cnpj: e.cnpj, certificados, agora });
        return { ...a, empresaId: e.id || null, nome: e.nome || null, regime: e.regime || null };
    });

    const conta = (s) => linhas.filter((l) => l.situacao === s).length;
    const vencendo = linhas.filter((l) => l.apto && l.certificado?.faixaAlerta).length;

    return {
        linhas,
        resumo: {
            empresas: linhas.length,
            aptas: linhas.filter((l) => l.apto).length,
            aptasPelaRaiz: conta('apto-pela-raiz'),
            semCertificado: conta('sem-certificado'),
            vencidos: conta('vencido'),
            a3: conta('a3-nao-assina-em-nuvem'),
            cadastroIncompleto: conta('cadastro-incompleto'),
            vencendoEm30Dias: vencendo,
        },
        avisos: avisosDosCertificados({ linhas, vencendo, conta }),
    };
}

function avisosDosCertificados({ linhas, vencendo, conta }) {
    const out = [
        'Deste túnel sai apenas METADADO do certificado — titular, emissor, validade, raiz e aptidão. '
        + 'A chave privada NUNCA trafega: quem assina é o CFI, onde ela já mora.',
        'Filial sem certificado próprio aparece como APTA quando a raiz tem A1 válido — é a regra da matriz. '
        + 'A resposta diz de QUEM é o certificado: assinar em nome de terceiro não pode ser dedução.',
    ];
    if (conta('vencido')) {
        out.push(`${conta('vencido')} certificado(s) VENCIDO(S) — essas empresas não transmitem nada hoje.`);
    }
    if (vencendo) {
        out.push(`${vencendo} certificado(s) vencem em até 30 dias. Certificado vencido para tudo de uma vez: `
            + 'SEFAZ, e-CAC, SERPRO e manifestação.');
    }
    if (conta('cadastro-incompleto')) {
        out.push(`${conta('cadastro-incompleto')} cadastro(s) de certificado pela metade (falta arquivo ou senha) — `
            + 'aparecem como cadastrados e não assinam, que é o pior dos dois mundos.');
    }
    if (conta('a3-nao-assina-em-nuvem')) {
        out.push(`${conta('a3-nao-assina-em-nuvem')} empresa(s) com A3: token físico não assina em servidor.`);
    }
    if (!linhas.length) {
        out.push('NENHUMA empresa no cadastro. Isso não é "escritório sem clientes": é falha de leitura.');
    }
    return out;
}
