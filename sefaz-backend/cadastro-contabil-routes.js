// Cadastro fiscal compartilhado com o CCI.
//
// O CFI permanece como fonte da verdade do regime tributario. Esta rota e
// estritamente de leitura e devolve apenas o minimo necessario para o modulo
// contabil parametrizar a empresa por CNPJ.
import express from 'express';
import admin from 'firebase-admin';
import { requireCrossProjectAuth } from './require-cross-project-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

export function limparCnpjCadastroContabil(value) {
    return String(value || '').replace(/\D/g, '');
}

function nomeEmpresa(data) {
    return data.nome || data.razaoSocial || data.nomeFantasia || 'Empresa sem nome';
}

export function regimeDoCadastro(colecao, data = {}) {
    if (colecao === 'simples_empresas') {
        return { codigo: 'SIMPLES_NACIONAL', nome: 'Simples Nacional' };
    }
    const regime = String(data.regimePadrao || 'Presumido').trim().toLowerCase();
    if (regime === 'real') return { codigo: 'LUCRO_REAL', nome: 'Lucro Real' };
    return { codigo: 'LUCRO_PRESUMIDO', nome: 'Lucro Presumido' };
}

export async function localizarCadastroContabilPorCnpj(cnpj, deps = {}) {
    const cnpjLimpo = limparCnpjCadastroContabil(cnpj);
    if (cnpjLimpo.length !== 14) {
        const erro = new Error('CNPJ deve conter 14 digitos.');
        erro.status = 400;
        throw erro;
    }
    const database = deps.db || fa().firestore();
    const fetchDocs = deps.fetchAllDocs || fetchAllDocs;
    const colecoes = ['simples_empresas', 'lucro_empresas'];
    const lotes = await Promise.all(colecoes.map((colecao) =>
        fetchDocs(database.collection(colecao), { label: `cadastro-contabil/${colecao}` })
    ));
    const encontrados = [];
    lotes.forEach((docs, indice) => {
        const colecao = colecoes[indice];
        docs.forEach((doc) => {
            const data = doc.data() || {};
            if (data._merged_into) return;
            if (limparCnpjCadastroContabil(data.cnpj) !== cnpjLimpo) return;
            encontrados.push({ colecao, id: doc.id, data });
        });
    });
    if (!encontrados.length) return null;
    if (encontrados.length > 1) {
        const erro = new Error('CNPJ encontrado em mais de um cadastro fiscal. Corrija a duplicidade no CFI antes de sincronizar.');
        erro.status = 409;
        throw erro;
    }
    const item = encontrados[0];
    const regime = regimeDoCadastro(item.colecao, item.data);
    return {
        id: item.id,
        cnpj: cnpjLimpo,
        nome: nomeEmpresa(item.data),
        nomeFantasia: item.data.nomeFantasia || '',
        fonte: item.colecao === 'simples_empresas' ? 'simples' : 'lucro',
        regime,
        atualizadoEm: item.data.updatedAt || item.data.atualizadoEm || item.data.updated_at || null,
    };
}

router.get('/regime/:cnpj', requireCrossProjectAuth, async (req, res) => {
    try {
        const cadastro = await localizarCadastroContabilPorCnpj(req.params.cnpj);
        if (!cadastro) {
            return res.status(404).json({
                ok: false,
                encontrada: false,
                error: 'Empresa nao encontrada no cadastro fiscal do CFI.',
            });
        }
        return res.json({ ok: true, encontrada: true, cadastro });
    } catch (e) {
        console.error('[cadastro-contabil/regime]', e.message);
        return res.status(e.status || 500).json({ ok: false, error: e.message || 'Falha ao consultar cadastro fiscal.' });
    }
});

export default router;
