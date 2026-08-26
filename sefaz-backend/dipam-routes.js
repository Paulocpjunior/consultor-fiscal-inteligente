// ============================================================================
// sefaz-backend/dipam-routes.js  (ESM)
// ----------------------------------------------------------------------------
// DIPAM 1.1 + FUNRURAL por sub-rogação — compra de produtor rural.
//
//   GET  /api/admin/dipam/painel?empresaId=&competencia=   um cliente, completo
//   GET  /api/admin/dipam/varredura?competencia=           quem TEM DIPAM no mês
//   GET  /api/admin/dipam/produtores                       cadastros já confirmados
//   POST /api/admin/dipam/produtor                         confirma/edita um produtor
//
// A regra vive em `dipam-produtor-rural.js` (puro, testado). Aqui é I/O.
//
// Custo de leitura: a varredura da carteira é DUAS FASES de propósito — a
// primeira lê campos leves (emitente + valor) só pra descobrir QUAIS clientes
// têm nota de produtor rural no mês; a segunda carrega os documentos inteiros
// (itens/CFOP/infAdic) apenas desses. Ler tudo de todo mundo por causa de um
// punhado de clientes rurais seria caro e lento.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from './require-admin.js';
import { podeAcessarEmpresaId, getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import {
    montarDipamCompetencia,
    identificarNaturezaFornecedor,
    normalizarParticipantesDoc,
} from './dipam-produtor-rural.js';
import {
    carregarProdutoresRurais, salvarProdutorRural, lerCondicaoRural,
    documentosDaContraparte, COLECAO_PRODUTORES, NATUREZAS, REGIMES_FUNRURAL,
} from './dipam-store.js';
// Duas perguntas, dois donos: "é nota própria de entrada?" e "de que LADO está
// a contraparte?". Juntá-las numa expressão só foi o que produziu a cópia.
import { ehNotaPropriaDeEntrada } from './xml-metadata-helper.js';
import { ladoDaContraparte } from './participante-doc-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const ehCompetencia = (c) => /^\d{4}-\d{2}$/.test(String(c || ''));

/** Empresa por id (Simples ou Lucro), pulando lápide e fundida. */
async function carregarEmpresa(db, empresaId) {
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).doc(empresaId).get();
        if (!snap.exists) continue;
        const d = snap.data() || {};
        if (d._deleted || d._merged_into) continue;
        return { id: empresaId, ...d };
    }
    return null;
}

/** Documentos completos de uma empresa na competência. */
async function carregarDocumentos(db, empresaId, competencia) {
    const snaps = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia),
        { label: `dipam ${empresaId} ${competencia}`, maxDocs: 20000 },
    );
    return snaps.map((s) => ({ id: s.id, ...(s.data() || {}) }))
        .filter((d) => !d._merged_into && !d._deleted);
}

// ─── Painel de um cliente ───────────────────────────────────────────────────

router.get('/painel', requireAuth, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const competencia = String(req.query.competencia || '').trim();
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Escolha a empresa.' });
        if (!ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const db = getDb();
        const empresa = await carregarEmpresa(db, empresaId);
        if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa não encontrada (ou excluída).' });

        const documentos = await carregarDocumentos(db, empresaId, competencia);
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
        const condicao = lerCondicaoRural(empresa);
        const painel = montarDipamCompetencia({ documentos, competencia, empresa: condicao, fornecedores });

        // O cadastro do cliente NÃO é a fonte da verdade — é a expectativa.
        // Divergência entre "o que está marcado" e "o que as notas mostram"
        // aparece na tela em vez de sumir: cliente sem a marcação e com compra
        // de produtor é justamente o que hoje passa batido no lançamento manual.
        const cadastro = {
            ...condicao,
            divergencia: divergenciaCadastro(condicao, painel),
        };

        return res.json({
            ok: true,
            ...painel,
            cadastro,
            lidos: { documentos: documentos.length, produtoresCadastrados: Object.keys(fornecedores).length },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[dipam/painel]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a DIPAM: ${e.message}` });
    }
});

function divergenciaCadastro(condicao, painel) {
    const temMovimento = painel.dipam.notas > 0 || painel.funrural.notas.length > 0;
    const temCandidato = painel.pendencias.some((p) => p.codigo === 'fornecedor-indefinido');
    if (!condicao.adquireDeProdutor && temMovimento) {
        return {
            tipo: 'nao_marcado_mas_compra',
            mensagem: 'Este cliente NÃO está marcado como "adquire de produtor rural", mas há compra de produtor na competência.',
            acao: 'Marque em Dados Fiscais → Produtor rural / DIPAM para que a obrigação apareça todo mês, mesmo em mês sem nota.',
        };
    }
    if (!condicao.adquireDeProdutor && temCandidato) {
        return {
            tipo: 'candidato',
            mensagem: 'Há fornecedor de natureza indefinida que pode ser produtor rural.',
            acao: 'Confirme a natureza no CADESP e, se for produtor, marque o cliente em Dados Fiscais → Produtor rural / DIPAM.',
        };
    }
    if (condicao.adquireDeProdutor && !temMovimento) {
        return {
            tipo: 'marcado_sem_movimento',
            mensagem: 'Cliente marcado como comprador de produtor rural, mas sem nenhuma compra de produtor nesta competência.',
            acao: 'Confira se a captura do mês está completa antes de concluir que não houve compra.',
        };
    }
    return null;
}

// ─── Varredura da carteira ──────────────────────────────────────────────────

router.get('/varredura', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin (tudo)
        const empresas = new Map();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                if (idsCarteira && !idsCarteira.includes(doc.id)) return;
                empresas.set(doc.id, {
                    id: doc.id,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: soDigitos(d.cnpj),
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    condicao: lerCondicaoRural({ id: doc.id, ...d }),
                });
            });
        }

        // ── Fase 1: quem tem candidato a produtor rural no mês? (campos leves)
        const leves = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                // tpNF + destinatario: a compra de produtor costuma ser NOTA
                // PRÓPRIA DE ENTRADA (tpNF=0, emitida pelo cliente, produtor no
                // bloco destinatário) — sem esses campos ela passaria batida.
                // Os campos CHATOS (cnpj*/xNome*/ie*/uf*) são a forma que o
                // importer PRINCIPAL grava; sem eles no projection a contraparte
                // some e todo mundo vira "indefinido" (bug 07/2026 EDUARDO GUERRA).
                .select(
                    // 🚨 `eventos`/`cStat`: sem eles `docCancelado` não vê o
                    // cancelamento por EVENTO e a nota cancelada volta a gerar
                    // FUNRURAL/DIPAM — imposto sobre nota que não existe.
                    // 🚨 `totais.vNF`/`totais.vProd`: o valor da DIPAM lê as três
                    // formas, mas sem `totais` na projeção o fallback nunca
                    // dispara — a nota importada pelo navegador (que grava SÓ
                    // `totais.vNF`) entrava valendo ZERO na base do FUNRURAL.
                    'empresaId', 'direcao', 'status', 'cStat', 'eventos', 'emitente', 'destinatario', 'tpNF',
                    'valorTotal', 'totais.vNF', 'totais.vProd',
                    'cnpjEmit', 'xNomeEmit', 'ufEmit', 'codMunEmit',
                    'cnpjDest', 'xNomeDest', 'ieDest', 'ufDest', 'codMunDest',
                ),
            { label: `dipam varredura ${competencia}`, maxDocs: 80000 },
        );
        const candidatos = new Map();
        for (const s of leves) {
            const d = normalizarParticipantesDoc(s.data() || {});
            const emp = empresas.get(d.empresaId);
            if (!emp) continue;
            // 🚨 O LADO da contraparte tem DONO (26/08, triagem das leituras
            // cruas de `direcao`). Esta cópia fazia o laço, mas
            // lia o emitente só na forma ANINHADA — a captura principal grava
            // `cnpjEmit` ACHATADO, e ali ela devolveria "não é própria".
            // ⚠️ São DUAS perguntas e cada uma tem o SEU dono — juntá-las numa
            // expressão só foi o que produziu esta cópia.
            const propriaEntrada = ehNotaPropriaDeEntrada(d, emp.cnpj).sim;
            if (d.direcao !== 'entrada' && !propriaEntrada) continue;
            const lado = ladoDaContraparte(d, emp.cnpj);
            const nat = identificarNaturezaFornecedor(
                (lado === 'destinatario' ? d.destinatario : d.emitente) || {},
            );
            const conta = nat.ehProdutorRuralPF || nat.confianca === 'indefinida';
            if (!conta) continue;
            const at = candidatos.get(d.empresaId) || { provaveis: 0, indefinidos: 0 };
            if (nat.ehProdutorRuralPF) at.provaveis += 1; else at.indefinidos += 1;
            candidatos.set(d.empresaId, at);
        }
        // Cliente MARCADO no cadastro entra na lista mesmo sem nota: mês sem
        // compra é uma informação (e pode ser falha de captura), não silêncio.
        for (const [id, e] of empresas) {
            if (e.condicao.adquireDeProdutor && !candidatos.has(id)) {
                candidatos.set(id, { provaveis: 0, indefinidos: 0 });
            }
        }

        // ── Fase 2: painel completo só dos candidatos ───────────────────────
        //
        // A ORDEM É PARTE DA CORREÇÃO (Paulo, 12/08 — JAGUAREXPORT 10463170000166
        // e VINCENZO GUERRA BANANAS 63027940000194 "não aparecem"): o corte em 60
        // acontecia ANTES da ordenação, e os clientes MARCADOS no cadastro sem
        // nota eram justamente os últimos a entrar no mapa. Ou seja, quem a
        // equipe marcou à mão — o caso que ela quer ver — era o primeiro a cair
        // fora, em silêncio de posição.
        //
        // Agora manda a CONFIRMAÇÃO HUMANA: marcado no cadastro vem primeiro e
        // nunca é cortado; depois quem tem prova no documento; por último o
        // indefinido. Cortar continua sendo possível, mas nessa ordem o que sai
        // é o menos provável, não o mais certo.
        const LIMITE = 60;
        const ids = Array.from(candidatos.keys()).sort((a, b) => {
            const ma = empresas.get(a)?.condicao?.adquireDeProdutor ? 1 : 0;
            const mb = empresas.get(b)?.condicao?.adquireDeProdutor ? 1 : 0;
            if (ma !== mb) return mb - ma;
            const ca = candidatos.get(a) || {}, cb = candidatos.get(b) || {};
            return (cb.provaveis || 0) - (ca.provaveis || 0)
                || (cb.indefinidos || 0) - (ca.indefinidos || 0);
        });
        const marcados = ids.filter((id) => empresas.get(id)?.condicao?.adquireDeProdutor);
        // Marcado no cadastro NUNCA é truncado: se houver mais marcados que o
        // limite, o limite cede — a lista existe pra mostrar exatamente eles.
        const analisados = ids.slice(0, Math.max(LIMITE, marcados.length));
        const linhas = [];
        for (const id of analisados) {
            const empresa = empresas.get(id);
            const documentos = await carregarDocumentos(db, id, competencia);
            const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
            const p = montarDipamCompetencia({
                documentos, competencia,
                empresa: { ...empresa.condicao, id, nome: empresa.nome, cnpj: empresa.cnpj },
                fornecedores,
            });
            linhas.push({
                empresaId: id, nome: empresa.nome, cnpj: empresa.cnpj, regime: empresa.regime,
                marcadoNoCadastro: empresa.condicao.adquireDeProdutor,
                dipamTotal: p.dipam.total,
                municipios: p.dipam.municipios.length,
                notasDipam: p.dipam.notas,
                funruralTotal: p.funrural.total,
                notasFunrural: p.funrural.notas.length,
                pendencias: p.pendencias.length,
                farol: p.farol,
            });
        }
        linhas.sort((a, b) => (b.pendencias - a.pendencias) || (b.dipamTotal - a.dipamTotal));

        return res.json({
            ok: true,
            competencia,
            escopo: idsCarteira ? 'carteira' : 'todas',
            linhas,
            // Nunca cortar em silêncio (regra do farol honesto, 30/07).
            total: ids.length,
            truncado: ids.length > analisados.length ? ids.length - analisados.length : 0,
            // Quem foi marcado no cadastro é contado à parte: se a equipe marcou
            // 5 e a lista mostra 3, isso é pergunta — não pode depender de alguém
            // conferir na mão.
            marcadosNoCadastro: marcados.length,
            lidos: { documentosLeves: leves.length, empresas: empresas.size },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[dipam/varredura]', e);
        return res.status(500).json({ ok: false, error: `Falha na varredura da DIPAM: ${e.message}` });
    }
});

// ─── Reler o município dos XMLs (mata a pendência em massa) ─────────────────
//
// "nota sem código IBGE do município de origem" NÃO é erro de cadastro: o
// município está no XML guardado no Storage, e o campo é que não foi gravado
// (o backfill de endereço só varria SAÍDAS, e compra de produtor é ENTRADA).
// Reler a FONTE é recuperação — mandar digitar 323 municípios seria pedir
// trabalho por um dado que já está no arquivo.
router.post('/reler-municipios', requireAdmin, async (req, res) => {
    try {
        const empresaId = String(req.body?.empresaId || req.query?.empresaId || '').trim();
        const competencia = String(req.body?.competencia || req.query?.competencia || '').trim();
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Escolha a empresa.' });
        if (!ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const { preencherEnderecoParticipantes } = await import('./xml-importer.js');
        // AS DUAS DIREÇÕES. A compra de produtor é entrada, mas a NOTA PRÓPRIA
        // de entrada (tpNF=0, RICMS/SP art. 136) ainda pode estar gravada como
        // 'saida' no banco — o backfill de direção conserta aos poucos, e a aba
        // 🌾 lê pela direção EFETIVA. Varrer só 'entrada' deixaria justamente
        // essas de fora, que é o mesmo defeito de varrer só 'saida' (12/08).
        const entrada = await preencherEnderecoParticipantes({ empresaId, competencia, direcao: 'entrada' });
        const saida = await preencherEnderecoParticipantes({ empresaId, competencia, direcao: 'saida' });
        const soma = (campo) => (Number(entrada[campo]) || 0) + (Number(saida[campo]) || 0);
        const total = {
            examinadas: soma('examinadas'), preenchidas: soma('preenchidas'),
            semXml: soma('semXml'), jaTinham: soma('jaTinham'),
            ganharamMunicipio: soma('ganharamMunicipio'),
            ganharamFornecedor: soma('ganharamFornecedor'),
            semDadoNoXml: soma('semDadoNoXml'),
        };

        // A AÇÃO SEGUE A CAUSA. "0 recuperadas" sozinho não responde nada — e
        // era pior que isso: o texto antigo dizia "já tinham" para documentos
        // que o backfill nem tinha aberto (o sentinela olhava a UF).
        const partes = [];
        if (total.semXml) {
            partes.push(`${total.semXml} documento(s) não têm o XML guardado — nesses o município e o fornecedor `
                + 'só entram pelo cadastro do produtor.');
        }
        if (total.semDadoNoXml) {
            partes.push(`${total.semDadoNoXml} foram relidos e o XML REALMENTE não traz o dado — aí não é releitura `
                + 'que resolve, é o cadastro do produtor (ou conferir a nota na origem).');
        }
        if (total.jaTinham && !total.preenchidas && !total.semXml && !total.semDadoNoXml) {
            partes.push('Nada mudou porque todos já haviam sido relidos nesta versão do leitor.');
        }
        return res.json({ ok: true, ...total, acao: partes.join(' ') || null });
    } catch (e) {
        console.error('[dipam/reler-municipios]', e);
        return res.status(500).json({ ok: false, error: `Falha ao reler os XMLs: ${e.message}` });
    }
});

// ─── Cadastro do produtor (fornecedor) ──────────────────────────────────────

router.get('/produtores', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const snap = await db.collection(COLECAO_PRODUTORES).limit(2000).get();
        const produtores = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() || {}) }))
            .filter((p) => !p._deleted)
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        return res.json({ ok: true, produtores, naturezas: NATUREZAS, regimesFunrural: REGIMES_FUNRURAL });
    } catch (e) {
        console.error('[dipam/produtores]', e);
        return res.status(500).json({ ok: false, error: `Falha ao ler os produtores: ${e.message}` });
    }
});

router.post('/produtor', requireAdmin, async (req, res) => {
    try {
        const { doc, ...dados } = req.body || {};
        const registro = await salvarProdutorRural(doc, dados, req.user);
        return res.json({ ok: true, produtor: registro });
    } catch (e) {
        if (e.code) return res.status(400).json({ ok: false, error: e.message });
        console.error('[dipam/produtor]', e);
        return res.status(500).json({ ok: false, error: `Falha ao gravar o produtor: ${e.message}` });
    }
});

export default router;
