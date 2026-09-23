// ============================================================================
// sefaz-backend/sharepoint-pastas.js
// ----------------------------------------------------------------------------
// 🔒 "QUAL É A PASTA DESTA EMPRESA NO SHAREPOINT?" — dono único da resposta.
//
// 02/09. A pasta da empresa é achada pelo CÓDIGO (`caminho-sharepoint.js`), e
// isso exige LISTAR `Empresas` no Graph. Quatro trilhos precisam disso — o
// auto-sync, o envio da guia, o arquivo do cofre de e-mail e os recibos da
// REINF — e eu já tinha escrito a mesma resolução duas vezes quando percebi:
// **a segunda cópia estava nascendo na minha frente.**
//
// ⚠️ O que se repete NÃO é só o `fetch`: são as TRÊS MENSAGENS. "não achei",
// "achei duas" e "o cadastro não tem código" pedem ações OPOSTAS, e a frase de
// cada uma é régua — quatro cópias divergiriam no primeiro ajuste, e o
// colaborador leria instruções diferentes para o mesmo problema.
// ============================================================================

import { PASTA_RAIZ, acharPastaDaEmpresa } from './caminho-sharepoint.js';

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
    || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';

/**
 * As pastas de empresa que existem no SharePoint.
 *
 * ⚠️ Quem chama em LOTE (o auto-sync) chama UMA vez por rodada e passa a lista
 * adiante: ~400 leituras seriam o HTTP 429 de 27/08 com outra roupa.
 */
export async function listarPastasDeEmpresas() {
    const resp = await fetch(`${PROXY_URL}/api/sharepoint/explorar`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}),
        },
        body: JSON.stringify({ caminho: PASTA_RAIZ }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Proxy explorar ${resp.status}`);
    }
    const d = await resp.json();
    return (d?.pastas || []).map(p => p?.nome).filter(Boolean);
}

/** O Cod.Cliente, nas duas formas em que o cadastro o guarda. */
export function codClienteDoCadastro(dados) {
    const d = dados || {};
    const df = d.dadosFiscais || {};
    return String(df.codCliente ?? d.codCliente ?? '').trim();
}

/**
 * A frase de cada situação — com a AÇÃO dela.
 *
 * 🚨 Um balde só faria as três parecerem o mesmo problema. E a de
 * `nao-encontrada` diz o que o app **NÃO** faz: criar a pasta da empresa
 * criaria uma duplicada com o nome errado ao lado da que existe.
 */
export function motivoDaResolucao(achado, codCliente) {
    switch (achado?.situacao) {
        case 'codigo-ausente':
            return 'Empresa sem Cod.Cliente no cadastro — é por ele que a pasta do SharePoint é '
                + 'encontrada (preencha em Empresas → Dados Fiscais).';
        case 'ambigua':
            return `Há MAIS DE UMA pasta com o código ${codCliente} em ${PASTA_RAIZ}: `
                + `${achado.candidatas.join(' · ')}. O app não escolhe — deixe uma só no SharePoint.`;
        case 'nao-encontrada':
            return `Nenhuma pasta com o código ${codCliente} em ${PASTA_RAIZ}. O app NÃO cria a pasta `
                + 'da empresa (criaria uma duplicada com o nome errado): crie-a no SharePoint começando '
                + 'pelo código.';
        default:
            return null;
    }
}

/**
 * Resolve a pasta de UMA empresa. Para lote, passe `pastas` já lidas.
 *
 * @returns {Promise<{ ok: boolean, pasta: string|null, motivo: string|null, codCliente: string }>}
 */
export async function resolverPastaDaEmpresa(dados, pastas) {
    const codCliente = codClienteDoCadastro(dados);
    let lista = pastas;
    if (!lista) {
        try {
            lista = await listarPastasDeEmpresas();
        } catch (e) {
            // ⚠️ Falha de LEITURA não é "pasta não existe": dizer isso mandaria
            // criar uma pasta que provavelmente já está lá.
            return {
                ok: false,
                pasta: null,
                codCliente,
                motivo: `Não foi possível listar ${PASTA_RAIZ} no SharePoint: ${e.message}`,
            };
        }
    }
    const achado = acharPastaDaEmpresa(lista, codCliente);
    return {
        ok: achado.situacao === 'ok',
        pasta: achado.pasta,
        codCliente,
        motivo: motivoDaResolucao(achado, codCliente),
    };
}
