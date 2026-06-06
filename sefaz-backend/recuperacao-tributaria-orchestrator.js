import admin from 'firebase-admin';
import { fetchAllDocs } from './firestore-paginate.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ─── Catálogo de Teses ───────────────────────────────────────────────────

const TESES = [
    {
        id: 'pis_cofins_monofasico',
        nome: 'PIS/COFINS Monofásico no Simples Nacional',
        descricao: 'Produtos com tributação monofásica (combustíveis, bebidas, autopeças, cosméticos, medicamentos) incluídos indevidamente na base do DAS.',
        regimesAplicaveis: ['Simples'],
        prazoDecadencial: 5,
        fundamentoLegal: 'Lei Complementar 123/2006, art. 18, §4º-A, inciso I; Resolução CGSN 140/2018, art. 25-A',
    },
    {
        id: 'icms_base_pis_cofins',
        nome: 'Exclusão do ICMS da base PIS/COFINS',
        descricao: 'ICMS destacado nas notas incluído indevidamente na base de cálculo do PIS e COFINS (Tema 69 STF — RE 574.706).',
        regimesAplicaveis: ['Presumido', 'Real'],
        prazoDecadencial: 5,
        fundamentoLegal: 'RE 574.706/PR (Tema 69 STF); Lei 12.973/2014',
    },
    {
        id: 'icms_st_mva_excedente',
        nome: 'ICMS-ST com MVA Excedente',
        descricao: 'ICMS-ST recolhido sobre MVA presumida superior à margem real de valor agregado — possível restituição do excedente.',
        regimesAplicaveis: ['Simples', 'Presumido', 'Real'],
        prazoDecadencial: 5,
        fundamentoLegal: 'RE 593.849 (Tema 201 STF); Convênio ICMS 142/2018',
    },
    {
        id: 'das_segregacao_incorreta',
        nome: 'DAS com Segregação Incorreta de Receitas',
        descricao: 'Receitas classificadas no Anexo incorreto do Simples Nacional, gerando alíquota efetiva maior que a devida (ex: Fator R não aplicado).',
        regimesAplicaveis: ['Simples'],
        prazoDecadencial: 5,
        fundamentoLegal: 'Resolução CGSN 140/2018, arts. 25 a 27 e Anexo V, §5º-J',
    },
    {
        id: 'iss_local_incorreto',
        nome: 'ISS Recolhido no Município Incorreto',
        descricao: 'ISS recolhido ao município do tomador quando deveria ser do prestador (ou vice-versa), conforme LC 116/2003 alterada pela LC 175/2020.',
        regimesAplicaveis: ['Simples', 'Presumido', 'Real'],
        prazoDecadencial: 5,
        fundamentoLegal: 'LC 116/2003, art. 3º; LC 175/2020',
    },
    {
        id: 'inss_verbas_indenizatorias',
        nome: 'INSS sobre Verbas Indenizatórias',
        descricao: 'Contribuição previdenciária indevidamente cobrada sobre verbas de natureza indenizatória (terço constitucional de férias, aviso prévio indenizado, etc).',
        regimesAplicaveis: ['Simples', 'Presumido', 'Real'],
        prazoDecadencial: 5,
        fundamentoLegal: 'Tema 985 STJ; RE 1.072.485 (Tema 163 STF)',
    },
];

export function getCatalogoTeses() {
    return TESES;
}

// ─── NCMs Monofásicos (principais grupos) ────────────────────────────────
const NCM_MONOFASICO_PREFIXOS = [
    '2710',  // combustíveis
    '2201', '2202', '2203', '2204', '2205', '2206', '2207', '2208', // bebidas
    '8408', '8409', '8483', '8511', '8708', '8714', // autopeças
    '3301', '3302', '3303', '3304', '3305', '3306', '3307', // cosméticos/higiene
    '3003', '3004', // medicamentos
    '4011', '4012', '4013', // pneus
];

function isNcmMonofasico(ncm) {
    if (!ncm) return false;
    const clean = ncm.replace(/\D/g, '');
    return NCM_MONOFASICO_PREFIXOS.some(p => clean.startsWith(p));
}

// ─── Análise: PIS/COFINS Monofásico ─────────────────────────────────────
async function analisarMonofasico(empresaId, empresa) {
    const db = fa().firestore();
    const docsSnap = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('direcao', '==', 'entrada'),
        { label: 'recuperacao/monofasico' },
    );

    const itensMonofasicos = [];
    let totalRecuperavel = 0;
    const porCompetencia = {};

    docsSnap.forEach(d => {
        const doc = d.data();
        if (doc._merged_into) return; // ignora docs marcados como duplicata
        const itens = doc.itens || [];
        itens.forEach(item => {
            if (isNcmMonofasico(item.ncm)) {
                const comp = doc.competencia || 'N/I';
                const valorItem = item.vProd || 0;
                // No Simples, PIS+COFINS representam ~3.65% do DAS médio sobre esses itens
                const aliqEfetiva = empresa.historicoCalculos?.length > 0
                    ? (empresa.historicoCalculos[empresa.historicoCalculos.length - 1].aliq_eff || 4) / 100
                    : 0.04;
                // Parcela PIS+COFINS no Simples = ~35% da alíquota efetiva (varia por anexo)
                const parcelaPisCofins = aliqEfetiva * 0.35;
                const recuperavel = valorItem * parcelaPisCofins;

                if (!porCompetencia[comp]) {
                    porCompetencia[comp] = { valor: 0, recuperavel: 0, count: 0 };
                }
                porCompetencia[comp].valor += valorItem;
                porCompetencia[comp].recuperavel += recuperavel;
                porCompetencia[comp].count++;
                totalRecuperavel += recuperavel;
            }
        });
    });

    const itens = Object.entries(porCompetencia).map(([comp, data]) => ({
        competencia: comp,
        descricao: `${data.count} itens monofásicos (NCMs combustíveis, bebidas, autopeças, cosméticos, medicamentos)`,
        valorOriginal: +data.valor.toFixed(2),
        valorRecuperavel: +data.recuperavel.toFixed(2),
        detalhes: { qtdItens: data.count },
    }));

    const agora = new Date();
    const cincoAnosAtras = new Date(agora);
    cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);

    return {
        teseId: 'pis_cofins_monofasico',
        status: totalRecuperavel > 0 ? 'oportunidade' : 'sem_oportunidade',
        valorEstimado: +totalRecuperavel.toFixed(2),
        periodoAnalisado: {
            inicio: cincoAnosAtras.toISOString().slice(0, 7),
            fim: agora.toISOString().slice(0, 7),
        },
        itens,
        analisadoEm: agora.toISOString(),
    };
}

// ─── Análise: ICMS na base PIS/COFINS (Tema 69) ─────────────────────────
async function analisarIcmsBasePisCofins(empresaId, empresa) {
    const fichaFinanceira = empresa.fichaFinanceira || [];
    const itens = [];
    let totalRecuperavel = 0;

    for (const registro of fichaFinanceira) {
        const icmsVendas = registro.icmsVendas || 0;
        if (icmsVendas <= 0) continue;

        const regime = registro.regime || empresa.regimePadrao || 'Presumido';
        let aliqPis, aliqCofins;
        if (regime === 'Real') {
            aliqPis = 0.0165;
            aliqCofins = 0.076;
        } else {
            aliqPis = 0.0065;
            aliqCofins = 0.03;
        }

        const recuperavel = icmsVendas * (aliqPis + aliqCofins);
        totalRecuperavel += recuperavel;

        itens.push({
            competencia: registro.mesReferencia || 'N/I',
            descricao: `ICMS R$ ${icmsVendas.toFixed(2)} incluído na base PIS/COFINS (${regime})`,
            valorOriginal: +icmsVendas.toFixed(2),
            valorRecuperavel: +recuperavel.toFixed(2),
            detalhes: { regime, aliqPis, aliqCofins },
        });
    }

    const agora = new Date();
    const cincoAnosAtras = new Date(agora);
    cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);

    return {
        teseId: 'icms_base_pis_cofins',
        status: totalRecuperavel > 0 ? 'oportunidade' : 'sem_oportunidade',
        valorEstimado: +totalRecuperavel.toFixed(2),
        periodoAnalisado: {
            inicio: cincoAnosAtras.toISOString().slice(0, 7),
            fim: agora.toISOString().slice(0, 7),
        },
        itens,
        analisadoEm: agora.toISOString(),
    };
}

// ─── Análise: ICMS-ST MVA Excedente ──────────────────────────────────────
async function analisarIcmsStMva(empresaId) {
    const db = fa().firestore();
    const docsSnap = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('direcao', '==', 'entrada'),
        { label: 'recuperacao/icms-st' },
    );

    const itens = [];
    let totalRecuperavel = 0;
    const porCompetencia = {};

    docsSnap.forEach(d => {
        const doc = d.data();
        if (doc._merged_into) return; // ignora docs marcados como duplicata
        (doc.itens || []).forEach(item => {
            const vICMSST = item.vICMSST || 0;
            const vBCST = item.vBCST || 0;
            const vProd = item.vProd || 0;
            if (vICMSST <= 0 || vBCST <= 0 || vProd <= 0) return;

            // MVA presumida = (vBCST / vProd - 1)
            // Se MVA > 40%, há potencial recuperação (margem real raramente > 40%)
            const mvaPresumida = (vBCST / vProd - 1);
            if (mvaPresumida > 0.40) {
                // Estimativa conservadora: 30% do ICMS-ST pode ser excedente
                const recuperavel = vICMSST * 0.30;
                const comp = doc.competencia || 'N/I';
                if (!porCompetencia[comp]) porCompetencia[comp] = { valor: 0, recuperavel: 0, count: 0 };
                porCompetencia[comp].valor += vICMSST;
                porCompetencia[comp].recuperavel += recuperavel;
                porCompetencia[comp].count++;
                totalRecuperavel += recuperavel;
            }
        });
    });

    const agora = new Date();
    const cincoAnosAtras = new Date(agora);
    cincoAnosAtras.setFullYear(cincoAnosAtras.getFullYear() - 5);

    return {
        teseId: 'icms_st_mva_excedente',
        status: totalRecuperavel > 0 ? 'oportunidade' : 'sem_oportunidade',
        valorEstimado: +totalRecuperavel.toFixed(2),
        periodoAnalisado: {
            inicio: cincoAnosAtras.toISOString().slice(0, 7),
            fim: agora.toISOString().slice(0, 7),
        },
        itens: Object.entries(porCompetencia).map(([comp, data]) => ({
            competencia: comp,
            descricao: `${data.count} itens com MVA presumida > 40%`,
            valorOriginal: +data.valor.toFixed(2),
            valorRecuperavel: +data.recuperavel.toFixed(2),
        })),
        analisadoEm: agora.toISOString(),
    };
}

// ─── Análise: DAS Segregação Incorreta ───────────────────────────────────
async function analisarDasSegregacao(empresaId, empresa) {
    const historico = empresa.historicoCalculos || [];
    const itens = [];
    let totalRecuperavel = 0;

    for (let i = 1; i < historico.length; i++) {
        const atual = historico[i];
        const anterior = historico[i - 1];

        // Detecta se Fator R >= 0.28 mas o anexo usado foi V (deveria ser III)
        if (atual.fator_r >= 0.28 && atual.anexo_efetivo === 'V') {
            // Diferença estimada entre Anexo V e III na mesma faixa
            const diferencaAliq = (atual.aliq_eff || 0) * 0.15; // ~15% a mais no V vs III
            const recuperavel = (atual.das_mensal || 0) * diferencaAliq / (atual.aliq_eff || 1);
            if (recuperavel > 0) {
                totalRecuperavel += recuperavel;
                itens.push({
                    competencia: atual.mesReferencia || 'N/I',
                    descricao: `Fator R ${(atual.fator_r * 100).toFixed(1)}% >= 28% mas Anexo V aplicado (deveria ser III)`,
                    valorOriginal: +(atual.das_mensal || 0).toFixed(2),
                    valorRecuperavel: +recuperavel.toFixed(2),
                    detalhes: { fatorR: atual.fator_r, anexoUsado: atual.anexo_efetivo },
                });
            }
        }
    }

    const agora = new Date();
    return {
        teseId: 'das_segregacao_incorreta',
        status: totalRecuperavel > 0 ? 'oportunidade' : 'sem_oportunidade',
        valorEstimado: +totalRecuperavel.toFixed(2),
        periodoAnalisado: {
            inicio: historico.length > 0 ? historico[0].mesReferencia || '' : '',
            fim: historico.length > 0 ? historico[historico.length - 1].mesReferencia || '' : '',
        },
        itens,
        analisadoEm: agora.toISOString(),
    };
}

// ─── Análise: ISS Local Incorreto ────────────────────────────────────────
async function analisarIssLocal(empresaId, empresa) {
    const db = fa().firestore();
    const nfseSnap = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('tipo', '==', 'NFSe'),
        { label: 'recuperacao/iss' },
    );

    const itens = [];
    let totalRecuperavel = 0;
    const ufEmpresa = empresa.dadosFiscais?.uf || '';

    nfseSnap.forEach(d => {
        const doc = d.data();
        if (doc._merged_into) return; // ignora docs marcados como duplicata
        const tomadorUf = doc.tomador?.uf || doc.destinatario?.uf || '';
        const prestadorUf = doc.prestador?.uf || doc.emitente?.uf || '';
        const issValor = doc.valores?.iss || 0;

        if (issValor > 0 && tomadorUf && prestadorUf && tomadorUf !== prestadorUf) {
            const recuperavel = issValor * 0.5; // Estimativa conservadora
            totalRecuperavel += recuperavel;
            itens.push({
                competencia: doc.competencia || 'N/I',
                descricao: `NFS-e ${doc.numero || ''}: ISS recolhido ${prestadorUf} vs tomador ${tomadorUf}`,
                valorOriginal: +issValor.toFixed(2),
                valorRecuperavel: +recuperavel.toFixed(2),
                detalhes: { numero: doc.numero, prestadorUf, tomadorUf },
            });
        }
    });

    const agora = new Date();
    return {
        teseId: 'iss_local_incorreto',
        status: totalRecuperavel > 0 ? 'oportunidade' : 'sem_oportunidade',
        valorEstimado: +totalRecuperavel.toFixed(2),
        periodoAnalisado: {
            inicio: new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().slice(0, 7),
            fim: agora.toISOString().slice(0, 7),
        },
        itens,
        analisadoEm: agora.toISOString(),
    };
}

// ─── Análise completa de uma empresa ─────────────────────────────────────
export async function analisarEmpresa(empresaId, regimeKind) {
    const db = fa().firestore();
    const col = regimeKind === 'simples' ? 'simples_empresas' : 'lucro_empresas';
    const snap = await db.collection(col).doc(empresaId).get();
    if (!snap.exists) throw new Error('Empresa não encontrada');
    const empresa = { id: snap.id, ...snap.data() };
    if (empresa._merged_into) throw new Error('Empresa consolidada');

    const regime = regimeKind === 'simples' ? 'Simples' : (empresa.regimePadrao || 'Presumido');
    const teses = [];

    // Executa apenas teses aplicáveis ao regime
    if (regime === 'Simples') {
        teses.push(await analisarMonofasico(empresaId, empresa));
        teses.push(await analisarDasSegregacao(empresaId, empresa));
    }
    if (regime === 'Presumido' || regime === 'Real') {
        teses.push(await analisarIcmsBasePisCofins(empresaId, empresa));
    }
    teses.push(await analisarIcmsStMva(empresaId));
    teses.push(await analisarIssLocal(empresaId, empresa));
    // INSS verbas indenizatórias requer dados de folha (não disponíveis no app ainda)
    teses.push({
        teseId: 'inss_verbas_indenizatorias',
        status: 'nao_analisada',
        valorEstimado: 0,
        periodoAnalisado: { inicio: '', fim: '' },
        itens: [],
        analisadoEm: new Date().toISOString(),
        observacoes: 'Requer dados de folha de pagamento (eSocial) não disponíveis no sistema.',
    });

    const totalRecuperavel = teses.reduce((s, t) => s + t.valorEstimado, 0);

    return {
        empresaId,
        empresaNome: empresa.nome,
        empresaCnpj: empresa.cnpj,
        regime,
        totalRecuperavel: +totalRecuperavel.toFixed(2),
        teses,
        ultimaAnalise: new Date().toISOString(),
    };
}

// ─── Análise global (todas as empresas) ──────────────────────────────────
export async function analisarTodas() {
    const db = fa().firestore();
    const resultados = [];
    const porTese = {};

    for (const [col, regimeKind] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        for (const d of snap.docs) {
            const emp = d.data();
            if (emp._merged_into) continue;
            try {
                const resultado = await analisarEmpresa(d.id, regimeKind);
                resultados.push(resultado);

                for (const tese of resultado.teses) {
                    if (!porTese[tese.teseId]) porTese[tese.teseId] = { empresas: 0, valor: 0 };
                    if (tese.valorEstimado > 0) {
                        porTese[tese.teseId].empresas++;
                        porTese[tese.teseId].valor += tese.valorEstimado;
                    }
                }
            } catch (e) {
                console.error(`[recuperacao] erro empresa ${d.id}:`, e.message);
            }
        }
    }

    resultados.sort((a, b) => b.totalRecuperavel - a.totalRecuperavel);

    return {
        geradoEm: new Date().toISOString(),
        totalEmpresas: resultados.length,
        empresasComOportunidade: resultados.filter(r => r.totalRecuperavel > 0).length,
        totalRecuperavel: +resultados.reduce((s, r) => s + r.totalRecuperavel, 0).toFixed(2),
        porTese,
        resultados,
    };
}
