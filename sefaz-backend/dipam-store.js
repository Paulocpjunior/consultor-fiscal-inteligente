// ============================================================================
// sefaz-backend/dipam-store.js  (I/O — leitura/gravação do cadastro do produtor)
// ----------------------------------------------------------------------------
// A regra fica no módulo puro (`dipam-produtor-rural.js`); aqui só tem Firestore.
//
// Coleção `produtores_rurais` — id = CPF/CNPJ só dígitos. É a MEMÓRIA da
// conferência que hoje a equipe refaz nota a nota: quem já foi olhado no CADESP,
// de que município é a produção e se optou por recolher sobre a folha (aí não
// há sub-rogação e a nota NÃO pode gerar FUNRURAL). O cadastro é do FORNECEDOR,
// não do cliente: o mesmo produtor vende para vários clientes da carteira.
// ============================================================================

import admin from 'firebase-admin';
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
import { validarCpf, formatarCpf } from './documento-dv.js';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

export const COLECAO_PRODUTORES = 'produtores_rurais';

/** Naturezas aceitas — 'produtor_rural_pf' é a única que gera DIPAM 1.1. */
export const NATUREZAS = ['produtor_rural_pf', 'pessoa_juridica', 'cooperativa'];
/** Regime do FUNRURAL do produtor. */
export const REGIMES_FUNRURAL = ['sub_rogacao', 'folha', 'nao_aplica'];

/**
 * Carrega os cadastros dos fornecedores citados nos documentos.
 * Devolve um mapa { [cpfCnpj]: cadastro } — do jeito que o módulo puro espera.
 *
 * Lê em lotes de 10 (limite do `in` do Firestore) e só dos documentos que
 * apareceram no período: nada de varrer a coleção inteira por empresa.
 */
export async function carregarProdutoresRurais(docsCpfCnpj = []) {
    const ids = Array.from(new Set(docsCpfCnpj.map(soDigitos).filter(Boolean)));
    if (ids.length === 0) return {};
    const db = getDb();
    const mapa = {};
    for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10);
        const snap = await db.collection(COLECAO_PRODUTORES)
            .where(admin.firestore.FieldPath.documentId(), 'in', lote)
            .get();
        snap.forEach((d) => {
            const data = d.data() || {};
            if (data._deleted) return;
            mapa[d.id] = { id: d.id, ...data };
        });
    }
    return mapa;
}

/** Grava/atualiza o cadastro de um produtor (upsert com auditoria de quem). */
export async function salvarProdutorRural(doc, dados, usuario) {
    const id = soDigitos(doc);
    if (id.length !== 11 && id.length !== 14) {
        const err = new Error('Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do produtor.');
        err.code = 'DOC_INVALIDO';
        throw err;
    }
    if (dados.natureza && !NATUREZAS.includes(dados.natureza)) {
        const err = new Error(`Natureza inválida: "${dados.natureza}". Use uma de: ${NATUREZAS.join(', ')}.`);
        err.code = 'NATUREZA_INVALIDA';
        throw err;
    }
    if (dados.funrural && !REGIMES_FUNRURAL.includes(dados.funrural)) {
        const err = new Error(`Regime de FUNRURAL inválido: "${dados.funrural}". Use um de: ${REGIMES_FUNRURAL.join(', ')}.`);
        err.code = 'FUNRURAL_INVALIDO';
        throw err;
    }
    const codMun = soDigitos(dados.codMunIBGE);
    if (codMun && codMun.length !== 7) {
        const err = new Error(`Código IBGE do município deve ter 7 dígitos (recebido "${dados.codMunIBGE}").`);
        err.code = 'MUNICIPIO_INVALIDO';
        throw err;
    }

    // ── CPF DO TITULAR: o que destrava o R-2055 do produtor inscrito por CNPJ ──
    //
    // Caso VINCENZO × ANTONIO DIAS DA SILVA (12/08). O produtor rural PF pode
    // ter inscrição de CNPJ (o estabelecimento rural) — CNPJ não descaracteriza
    // PF, Comunicado CAT 45/2008 —, mas o `ideProdutor` do R-2055 identifica a
    // PESSOA, e a única forma provada contra evento aceito é tpInscProd=2 (CPF).
    //
    // Isto NÃO é contorno: é o cadastro trazendo o que a NOTA não traz, igual
    // ao `seguradoEspecial` e à opção pela folha. E não se deduz nada — alguém
    // digita olhando o CADESP, e fica gravado quem foi (`confirmadoPor`).
    const cpfTitular = soDigitos(dados.cpfTitular);
    if (cpfTitular && cpfTitular.length !== 11) {
        const err = new Error(`CPF do titular deve ter 11 dígitos (recebido "${dados.cpfTitular}").`);
        err.code = 'CPF_TITULAR_INVALIDO';
        throw err;
    }
    // O DV é a ÚNICA rede que existe antes da declaração. Conferir só o
    // comprimento aceitaria dígito trocado ou transposto — e o R-2055 sairia
    // no `ideProdutor` de outra pessoa, sem nada depois para perceber.
    if (cpfTitular && !validarCpf(cpfTitular)) {
        const err = new Error(`CPF do titular inválido: ${formatarCpf(cpfTitular)} não passa no `
            + 'dígito verificador. Confira o número no CADESP — o R-2055 declara a AQUISIÇÃO em nome '
            + 'desta pessoa, e entrega ao Reinf não se desfaz.');
        err.code = 'CPF_TITULAR_INVALIDO';
        throw err;
    }
    if (cpfTitular && id.length === 11 && cpfTitular !== id) {
        // Produtor já inscrito por CPF não tem "outro" CPF. Aceitar aqui faria o
        // R-2055 declarar em nome de pessoa diferente da que está na nota.
        const err = new Error('Este produtor já está inscrito por CPF. O "CPF do titular" só existe para '
            + 'produtor inscrito por CNPJ — e ele não pode divergir do CPF da própria inscrição.');
        err.code = 'CPF_TITULAR_CONFLITA';
        throw err;
    }

    const registro = {
        doc: id,
        nome: String(dados.nome || '').trim(),
        ie: String(dados.ie || '').trim().toUpperCase(),
        uf: String(dados.uf || '').trim().toUpperCase(),
        codMunIBGE: codMun,
        municipio: String(dados.municipio || '').trim(),
        natureza: dados.natureza || null,
        funrural: dados.funrural || null,
        // Segurado especial (agricultura familiar) ficou em 1,5% quando a
        // LC 224/2025 subiu o geral para 1,63% — e essa condição não está na
        // nota, só no cadastro.
        seguradoEspecial: !!dados.seguradoEspecial,
        // Só faz sentido no produtor inscrito por CNPJ — ver a validação acima.
        cpfTitular: id.length === 14 ? (cpfTitular || null) : null,
        observacao: String(dados.observacao || '').trim(),
        confirmadoPor: usuario?.email || usuario?.uid || 'desconhecido',
        confirmadoEm: Date.now(),
    };
    await getDb().collection(COLECAO_PRODUTORES).doc(id).set(registro, { merge: true });
    return registro;
}

/**
 * Condição rural do CLIENTE, lida do cadastro (dadosFiscais.condicaoRural).
 * É o que diz se este cliente compra de produtor (DIPAM 1.1 + sub-rogação), se
 * ele MESMO é produtor PF (aí entrega DIPAM-A e não lança 1.1) ou se é
 * cooperativa (código 1.3).
 */
export function lerCondicaoRural(empresa) {
    const c = empresa?.dadosFiscais?.condicaoRural || {};
    return {
        id: empresa?.id || null,
        nome: empresa?.razaoSocial || empresa?.nome || null,
        cnpj: soDigitos(empresa?.cnpj),
        adquireDeProdutor: !!c.adquireDeProdutor,
        ehProdutorRuralPF: !!c.ehProdutorRuralPF,
        ehCooperativa: !!c.ehCooperativa,
        funruralSubRogacao: c.funruralSubRogacao === 'nao_aplica' ? 'nao_aplica' : 'automatico',
        observacao: c.observacao || '',
    };
}

/**
 * CPF/CNPJ da contraparte de cada documento: emitente na entrada normal,
 * destinatário na devolução E na nota própria de entrada (tpNF=0 — o cliente
 * emite a nota da compra e o produtor fica no bloco destinatário/remetente).
 */
export function documentosDaContraparte(notas = []) {
    const out = [];
    for (const raw of notas) {
        // Mesma armadilha do painel: doc do importer principal vem com os
        // participantes em campos chatos. Normaliza antes de ler a contraparte,
        // senão o mapa de fornecedores sai vazio e o cadastro nunca é achado.
        const n = normalizarParticipantesDoc(raw);
        const usaDestinatario = n?.direcao === 'saida' || String(n?.tpNF ?? '') === '0';
        const p = usaDestinatario
            ? (n.destinatario || n.tomador)
            : (n.emitente || n.prestador);
        const d = soDigitos(p?.cnpjCpf || p?.cnpj || p?.cpf);
        if (d) out.push(d);
    }
    return out;
}
