// sefaz-backend/abrasf/diagnostico-routes.js
// Diagnostico: dado o CNPJ do CLIENTE (tomador), checklist de "por que
// uma NFSe que deveria ter vindo nao chegou".
//
// Cobre o caso de uso: "tomei servico da Serasa, mas a NFSe nao aparece".

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from '../require-admin.js';
import { configMunicipio, municipiosSuportados } from './config-municipios.js';
import { listarMunicipiosNfse, caminhoNfseRecomendado } from '../municipio-nfse-caminho.js';

const router = express.Router();
router.use(express.json());

// GET /municipios-caminho — guia de captura de NFS-e por município (2026).
// Orienta o colaborador: cada município usa ADN (Padrão Nacional, por CNPJ),
// SP capital usa portal próprio, e ABRASF é legado. Opcional ?cod=IBGE devolve
// a recomendação de um município específico.
router.get('/municipios-caminho', requireAdmin, (req, res) => {
    try {
        if (req.query.cod) {
            return res.json({ ok: true, item: caminhoNfseRecomendado(req.query.cod) });
        }
        return res.json({
            ok: true,
            padrao2026: 'adn',
            nota: 'LC 214/2025: em 2026 o Padrão Nacional NFS-e (ADN) é obrigatório e a captura é por CNPJ (nfse-nacional-dfe). ABRASF é legado. Habilite nfseNacionalDfeAtivo + A1 próprio nas empresas.',
            municipios: listarMunicipiosNfse(),
        });
    } catch (e) {
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

function getDb() {
    if (!admin.apps.length) admin.initializeApp();
    return admin.firestore();
}

// GET /diagnostico/:cnpj
// Devolve checklist completo para o CNPJ do CLIENTE (tomador).
router.get('/diagnostico/:cnpj', requireAdmin, async (req, res) => {
    try {
        const cnpj = String(req.params.cnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ invalido' });

        const db = getDb();

        // 1) Empresa cadastrada?
        let empresa = null;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).where('cnpj', '==', cnpj).limit(1).get();
            if (!snap.empty) {
                const d = snap.docs[0];
                empresa = { id: d.id, colecao: col, ...d.data() };
                break;
            }
        }

        const checklist = [];

        if (!empresa) {
            return res.json({
                cnpj,
                cadastrada: false,
                conclusao: 'Empresa nao esta cadastrada no sistema. Cadastre em Simples ou Lucro Presumido/Real primeiro.',
                checklist: [],
            });
        }
        checklist.push({
            ok: true,
            item: 'Empresa cadastrada',
            detalhe: `${empresa.nome || empresa.razaoSocial} (${empresa.colecao.replace('_empresas', '')})`,
        });

        // 2) Tem dadosFiscais com UF/municipio?
        const df = empresa.dadosFiscais || {};
        const codMunIBGE = df.codMunIBGE;
        const municipioNome = df.municipioNome || df.municipio || '';
        const uf = df.uf || empresa.uf;
        const temMunicipio = !!codMunIBGE;
        checklist.push({
            ok: temMunicipio,
            item: 'Dados fiscais (UF + municipio IBGE)',
            detalhe: temMunicipio
                ? `${municipioNome}/${uf} (IBGE ${codMunIBGE})`
                : 'Cadastre UF e municipio IBGE em Configurações → Dados Fiscais',
        });

        // 3) ADN ativo (Padrao Nacional)?
        const adnAtivo = empresa.nfseNacionalDfeAtivo === true;
        checklist.push({
            ok: adnAtivo,
            item: 'Captura ADN (Padrao Nacional) ativa',
            detalhe: adnAtivo
                ? 'Cron consulta DFe nacional desta empresa'
                : 'Habilitar em NFS-e Nacional → Cobertura ADN',
        });

        // 4) Tem cert A1?
        const certSnap = await db.collection('sefaz_certificados_empresa').doc(empresa.id).get();
        const temCert = certSnap.exists;
        let certInfo = null;
        if (temCert) {
            const c = certSnap.data();
            certInfo = {
                fingerprint: c.fingerprint,
                notAfter: c.notAfter,
                expirado: c.notAfter ? new Date(c.notAfter) < new Date() : false,
            };
        }
        checklist.push({
            ok: temCert && !certInfo?.expirado,
            item: 'Certificado A1 cadastrado',
            detalhe: temCert
                ? (certInfo.expirado ? `EXPIRADO em ${certInfo.notAfter}` : `Valido ate ${certInfo.notAfter}`)
                : 'Carregar .pfx em Sefaz → Certificado da Empresa',
        });

        // 5) Municipio coberto pelo adapter ABRASF?
        const configAbrasf = codMunIBGE ? configMunicipio(codMunIBGE) : null;
        const abrasfAtivo = empresa.abrasfAtivo === true;
        if (codMunIBGE) {
            if (configAbrasf) {
                checklist.push({
                    ok: abrasfAtivo,
                    item: `Adapter ABRASF para ${configAbrasf.nome}/${configAbrasf.uf}`,
                    detalhe: abrasfAtivo
                        ? `Habilitado (${configAbrasf.versao})`
                        : `Suportado mas nao habilitado. POST /api/admin/abrasf/toggle/${empresa.id} com { ativo: true }`,
                });
            } else {
                checklist.push({
                    ok: false,
                    item: `Adapter ABRASF para municipio IBGE ${codMunIBGE}`,
                    detalhe: `Municipio ainda nao suportado pelo adapter. Suportados: ${municipiosSuportados().join(', ')}. Para adicionar, ver sefaz-backend/abrasf/config-municipios.js`,
                });
            }
        }

        // 6) Tem state de sync ADN?
        const stateAdnSnap = await db.collection('nfse_nacional_dfe_state').doc(cnpj).get();
        const stateAdn = stateAdnSnap.exists ? stateAdnSnap.data() : null;
        checklist.push({
            ok: !!stateAdn?.ultimaSync,
            item: 'Sincronizacao ADN ja rodou',
            detalhe: stateAdn?.ultimaSync
                ? `Ultima: ${stateAdn.ultimaSync?.toDate?.()?.toISOString?.() || stateAdn.ultimaSync}, ultNSU=${stateAdn.ultNSU || '?'}`
                : 'Nunca rodou. Forçar via POST /api/admin/nfse-nacional-dfe/sync-cron-now',
        });

        // 7) Tem state de sync ABRASF?
        const stateAbrasfSnap = await db.collection('abrasf_state').doc(empresa.id).get();
        const stateAbrasf = stateAbrasfSnap.exists ? stateAbrasfSnap.data() : null;
        if (configAbrasf) {
            checklist.push({
                ok: !!stateAbrasf?.ultimaSync,
                item: 'Sincronizacao ABRASF ja rodou',
                detalhe: stateAbrasf?.ultimaSync
                    ? `Ultima: ${stateAbrasf.ultimaSync?.toDate?.()?.toISOString?.() || stateAbrasf.ultimaSync}`
                    : 'Nunca rodou. POST /api/admin/abrasf/sync-one',
            });
        }

        // Conclusao
        const bloqueios = checklist.filter(c => !c.ok);
        const conclusao = bloqueios.length === 0
            ? '✅ Tudo configurado. Se NFSe ainda nao apareceu, possiveis causas: latencia (24h), municipio do EMITENTE nao aderiu ao Padrao Nacional, NFSe emitida antes do ultNSU atual.'
            : `🚧 ${bloqueios.length} bloqueio(s): ${bloqueios.map(b => b.item).join(' · ')}`;

        return res.json({
            cnpj,
            cadastrada: true,
            empresa: { id: empresa.id, nome: empresa.nome || empresa.razaoSocial, colecao: empresa.colecao },
            checklist,
            conclusao,
        });
    } catch (e) {
        console.error('[abrasf/diagnostico]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
