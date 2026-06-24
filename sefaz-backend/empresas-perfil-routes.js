import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira, getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function limparCnpj(value) {
    return String(value || '').replace(/\D/g, '');
}

function nomeEmpresa(data) {
    return data.nome || data.razaoSocial || data.nomeFantasia || 'Empresa sem nome';
}

function inferirRegimeLucro(data) {
    if (data.regimePadrao === 'Real') {
        const tipos = data.tiposAtividade || {};
        if (tipos.industria) return 'LUCRO_REAL_INDUSTRIA';
        if (tipos.servico) return 'LUCRO_REAL_SERVICOS';
        if (tipos.comercio) return 'LUCRO_REAL_COMERCIO';
        return 'LUCRO_REAL_SERVICOS';
    }
    return 'LUCRO_PRESUMIDO';
}

function getUf(data) {
    return data.dadosFiscais?.uf || data.uf || undefined;
}

function getIe(data) {
    return data.dadosFiscais?.inscricaoEstadual || data.inscricaoEstadual || undefined;
}

function getCcmSp(data) {
    return data.dadosFiscais?.ccmSp || data.ccmSp || undefined;
}

function dedupEmpresasPerfil(list) {
    const map = new Map();
    for (const emp of list) {
        const key = limparCnpj(emp.cnpj) || emp.id;
        if (!map.has(key)) map.set(key, emp);
    }
    return Array.from(map.values()).sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj));
}

function montarFiltroCarteira(cnpjsCarteira, idsCarteira) {
    if (!cnpjsCarteira && !idsCarteira) return { cnpjsSet: null, idsSet: null };
    const cnpjs = (cnpjsCarteira || []).map(limparCnpj).filter(Boolean);
    const ids = (idsCarteira || []).filter(Boolean);

    // Compatibilidade com o filtro historico do frontend: usuario sem nenhum
    // vinculo explicito nao e bloqueado com lista vazia em bases legadas.
    if (cnpjs.length === 0 && ids.length === 0) return { cnpjsSet: null, idsSet: null };

    return { cnpjsSet: new Set(cnpjs), idsSet: new Set(ids) };
}

function empresaPermitida(emp, cnpjsSet, idsSet, user) {
    if (!cnpjsSet && !idsSet) return true;
    if (emp.createdBy && emp.createdBy === user?.uid) return true;
    return !!(idsSet?.has(emp.id) || cnpjsSet?.has(limparCnpj(emp.cnpj)));
}

export async function listarEmpresasPerfilCliente(user) {
    const db = fa().firestore();
    const [cnpjsCarteira, idsCarteira] = await Promise.all([
        getCnpjsDaCarteira(user),
        getEmpresaIdsDaCarteira(user),
    ]);
    const { cnpjsSet, idsSet } = montarFiltroCarteira(cnpjsCarteira, idsCarteira);

    const [simplesDocs, lucroDocs] = await Promise.all([
        fetchAllDocs(db.collection('simples_empresas'), { label: 'empresas-perfil/simples' }),
        fetchAllDocs(db.collection('lucro_empresas'), { label: 'empresas-perfil/lucro' }),
    ]);

    const simples = simplesDocs
        .map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                nome: nomeEmpresa(data),
                cnpj: limparCnpj(data.cnpj),
                fonte: 'simples',
                regimeSugerido: 'SIMPLES',
                uf: getUf(data),
                inscricaoEstadual: getIe(data),
                ccmSp: getCcmSp(data),
                createdBy: data.createdBy || undefined,
                _merged_into: data._merged_into,
            };
        })
        .filter((emp) => !emp._merged_into && emp.cnpj.length === 14)
        .filter((emp) => empresaPermitida(emp, cnpjsSet, idsSet, user));

    const lucro = lucroDocs
        .map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                nome: nomeEmpresa(data),
                cnpj: limparCnpj(data.cnpj),
                fonte: 'lucro',
                regimeSugerido: inferirRegimeLucro(data),
                uf: getUf(data),
                inscricaoEstadual: getIe(data),
                ccmSp: getCcmSp(data),
                createdBy: data.createdBy || undefined,
                _merged_into: data._merged_into,
            };
        })
        .filter((emp) => !emp._merged_into && emp.cnpj.length === 14)
        .filter((emp) => empresaPermitida(emp, cnpjsSet, idsSet, user));

    return dedupEmpresasPerfil([...simples, ...lucro]).map(({ _merged_into, ...emp }) => emp);
}

router.get('/', requireAuth, async (req, res) => {
    try {
        res.json(await listarEmpresasPerfilCliente(req.user));
    } catch (err) {
        console.error('[empresas-perfil] erro:', err);
        res.status(500).json({ error: 'Falha ao carregar empresas do perfil do cliente' });
    }
});

export default router;
