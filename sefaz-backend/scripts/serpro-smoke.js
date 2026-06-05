#!/usr/bin/env node
// ============================================================================
// serpro-smoke.js
//
// Smoke test honesto do Integra Contador SERPRO. Chama APENAS endpoints de
// CONSULTA (nao Emite/Declara — nao gera DAS/DARF/declaracao real). Salva
// cada response BRUTO em /tmp/serpro-smoke-<sistema>-<cnpj>-<ts>.json e
// imprime um sumario.
//
// Por que existe: dois providers tem TODO[SERPRO_REAL] (das-provider:237,
// darf-provider:162) — os nomes de campo do response sao SUPOSTOS. Em prod
// MODE='serpro' eh o default. Esse smoke captura o payload real pra mapear
// os parsers SEM ADIVINHAR.
//
// Uso:
//   # 1) Configure as envs (ou Secret Manager ja faz isso em prod):
//   export SERPRO_CONSUMER_KEY=...
//   export SERPRO_CONSUMER_SECRET=...
//   export SERPRO_CONTRATANTE_CNPJ=44388152000189
//   # 2) Rode com o CNPJ-cliente alvo (precisa ter procuracao e-CAC pra SP):
//   node sefaz-backend/scripts/serpro-smoke.js <cnpj-cliente> [pa]
//
// Exemplo:
//   node sefaz-backend/scripts/serpro-smoke.js 11222333000144 202604
//
// O PA (periodo de apuracao) default = mes anterior. Se passar, usa o seu.
//
// Sem credenciais reais NAO roda — sai com codigo 2 (sem fingir nada).
// SERPRO_DRY_RUN=1 funciona, mas o smoke avisa que e simulado.
// ============================================================================

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { invokeIntegraContador, getAccessToken, getSerproConfig } from '../serpro-client.js';

const cnpjClienteArg = process.argv[2];
const paArg = process.argv[3];

if (!cnpjClienteArg) {
    console.error('uso: node sefaz-backend/scripts/serpro-smoke.js <cnpj-cliente> [pa-YYYYMM]');
    console.error('     CNPJ-cliente: empresa-cliente alvo (precisa ter procuracao e-CAC pra SP Contabil).');
    console.error('     PA opcional:  YYYYMM. Default = mes anterior.');
    process.exit(1);
}

const cnpj = String(cnpjClienteArg).replace(/\D/g, '');
if (cnpj.length !== 14) {
    console.error(`CNPJ inválido (esperado 14 digitos, veio ${cnpj.length}): ${cnpjClienteArg}`);
    process.exit(1);
}

// PA padrao = mes anterior (geralmente o ultimo fechado)
function paPadrao() {
    const hoje = new Date();
    hoje.setMonth(hoje.getMonth() - 1);
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    return `${ano}${mes}`;
}
const pa = paArg ? String(paArg).replace(/\D/g, '').slice(0, 6) : paPadrao();
if (pa.length !== 6) {
    console.error(`PA inválido (esperado YYYYMM): ${paArg}`);
    process.exit(1);
}

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = join(tmpdir(), `serpro-smoke-${cnpj}-${TS}`);

// ─── Servicos a chamar (so CONSULTA — nao Emite/Declara) ────────────────
// Honestidade: NFSe Nacional nao tem integracao SERPRO ainda (so mock no
// nfse-nacional-provider). DARF so tem idServico de EMISSAO documentado,
// nao adiciono aqui pra nao gerar DARF real. DET e Caixa Postal alternativa.
const SERVICOS = [
    {
        rotulo: 'PGDASD — consulta declaracao',
        idSistema: 'PGDASD',
        idServico: 'CONSULTIMADECREC14',
        acao: 'Consultar',
        dados: { periodoApuracao: Number(pa) },
        nota: 'Consulta declaracao Simples do PA. Se nao houver, SERPRO retorna 4xx — eh esperado.',
    },
    {
        rotulo: 'DCTFWEB — consulta declaracao',
        idSistema: 'DCTFWEB',
        idServico: 'CONSDECCOMPLETA33',
        acao: 'Consultar',
        dados: {
            categoria: '41', // 41 = Mensal Geral
            anoPA: Number(pa.slice(0, 4)),
            mesPA: Number(pa.slice(4, 6)),
        },
        nota: 'Consulta DCTFWeb mensal do PA. Empresa Lucro/Real tipica.',
    },
    {
        rotulo: 'DCTFWEB MIT — apuracao (tributos discriminados p/ cruzamento)',
        idSistema: 'DCTFWEB',
        idServico: 'CONSAPURACAOMIT',
        acao: 'Consultar',
        dados: { anoPA: String(pa.slice(0, 4)), mesPA: String(pa.slice(4, 6)) },
        nota: 'CRITICO p/ cruzamento DCTFWeb x apuracao. O shape deste response '
            + 'define o dctfweb-mit-normalizer.js — confirme os campos de '
            + 'codigo/valor/descricao dos debitos com este JSON.',
    },
    {
        rotulo: 'CAIXAPOSTAL — lista mensagens',
        idSistema: 'CAIXAPOSTAL',
        idServico: 'OBTERLISTAMSGS53',
        acao: 'Consultar',
        dados: { statusLeitura: 0, indicadorPagina: 0 }, // 0 = nao lidas
        nota: 'NAO marca mensagens como lidas — soh lista.',
    },
    {
        rotulo: 'DET — consulta mensagens (alternativa)',
        idSistema: 'DET',
        idServico: 'CONSULTARMENSAGENS',
        acao: 'Consultar',
        dados: {},
        nota: 'Caixa postal DET — caminho alternativo. Pode falhar se empresa nao tiver DET.',
    },
];

// ─── Sumarizador honesto: ecoa o que veio, nao parseia ───────────────────
function sumarizarResponse(r) {
    if (!r || typeof r !== 'object') return { tipo: typeof r, valor: r };
    const out = {
        statusHttp: r.status,
        mensagens: Array.isArray(r.mensagens) ? r.mensagens.slice(0, 5) : r.mensagens,
        dadosTopLevel: null,
        dadosTamanho: null,
    };
    if (r.dados == null) {
        out.dadosTopLevel = 'null';
    } else if (typeof r.dados === 'string') {
        out.dadosTopLevel = 'string';
        out.dadosTamanho = r.dados.length;
    } else if (Array.isArray(r.dados)) {
        out.dadosTopLevel = `array[${r.dados.length}]`;
        if (r.dados[0] && typeof r.dados[0] === 'object') {
            out.dadosTopLevel += ' de objeto com chaves: ' + Object.keys(r.dados[0]).join(', ');
        }
    } else if (typeof r.dados === 'object') {
        out.dadosTopLevel = 'objeto com chaves: ' + Object.keys(r.dados).join(', ');
    }
    return out;
}

async function rodarUm(idx, svc) {
    const inicio = Date.now();
    console.log(`\n[${idx}/${SERVICOS.length}] ${svc.rotulo}`);
    console.log(`         ${svc.idSistema}/${svc.idServico} (${svc.acao})`);
    if (svc.nota) console.log(`         nota: ${svc.nota}`);

    try {
        const r = await invokeIntegraContador({
            idSistema: svc.idSistema,
            idServico: svc.idServico,
            contribuinteCnpj: cnpj,
            acao: svc.acao,
            dados: svc.dados,
        });
        const dur = Date.now() - inicio;
        const sumario = sumarizarResponse(r);
        console.log(`         ✓ ok em ${dur}ms — ${JSON.stringify(sumario)}`);

        const file = join(OUT_DIR, `${idx.toString().padStart(2, '0')}-${svc.idSistema}-${svc.idServico}.json`);
        await writeFile(file, JSON.stringify({
            requisicao: {
                idSistema: svc.idSistema, idServico: svc.idServico,
                acao: svc.acao, contribuinteCnpj: cnpj, dados: svc.dados,
            },
            duracaoMs: dur,
            responseBruto: r,
        }, null, 2));
        console.log(`         → ${file}`);
        return { svc, ok: true, sumario, file };
    } catch (err) {
        const dur = Date.now() - inicio;
        console.log(`         ✗ erro em ${dur}ms: ${err.name || 'Error'}: ${err.message}`);
        if (err.serproBody) console.log(`         body: ${String(err.serproBody).slice(0, 500)}`);

        const file = join(OUT_DIR, `${idx.toString().padStart(2, '0')}-${svc.idSistema}-${svc.idServico}.ERROR.json`);
        await writeFile(file, JSON.stringify({
            requisicao: { idSistema: svc.idSistema, idServico: svc.idServico, acao: svc.acao, contribuinteCnpj: cnpj, dados: svc.dados },
            duracaoMs: dur,
            erro: { name: err.name, message: err.message, status: err.status, body: err.serproBody },
        }, null, 2));
        console.log(`         → ${file}`);
        return { svc, ok: false, erro: err.message, file };
    }
}

async function main() {
    const cfg = getSerproConfig();
    console.log('===== SERPRO smoke test =====');
    console.log(`Base URL:           ${cfg.baseUrl}`);
    console.log(`Modo:               ${cfg.dryRun ? 'DRY_RUN (simulado)' : 'REAL'}`);
    console.log(`Credenciais:        ${cfg.hasCredentials ? 'configuradas' : 'AUSENTES'}`);
    console.log(`Contratante:        ${cfg.contratanteCnpj}`);
    console.log(`CNPJ-cliente alvo:  ${cnpj}`);
    console.log(`Periodo apuracao:   ${pa}`);
    console.log(`Diretorio output:   ${OUT_DIR}`);

    if (!cfg.dryRun && !cfg.hasCredentials) {
        console.error('\nABORTANDO: sem credenciais reais (SERPRO_CONSUMER_KEY/SECRET).');
        console.error('Pra rodar simulacao local: SERPRO_DRY_RUN=1 node sefaz-backend/scripts/serpro-smoke.js ...');
        process.exit(2);
    }

    await mkdir(OUT_DIR, { recursive: true });

    // Step 1: OAuth isolado — se isso falhar, eh credencial/cert, nao payload
    console.log('\n[step 1] Obtendo access token (OAuth)...');
    try {
        const t0 = Date.now();
        const token = await getAccessToken();
        const dur = Date.now() - t0;
        console.log(`         ✓ token obtido em ${dur}ms (len=${(token || '').length})`);
    } catch (err) {
        console.error(`         ✗ FALHA OAuth: ${err.message}`);
        console.error('         Stop: sem token nao tem como chamar nada. Verifique credenciais e cert mTLS.');
        process.exit(3);
    }

    // Step 2: chamar cada servico de consulta
    console.log('\n[step 2] Chamando endpoints de CONSULTA (nada destrutivo)...');
    const resultados = [];
    for (let i = 0; i < SERVICOS.length; i++) {
        resultados.push(await rodarUm(i + 1, SERVICOS[i]));
    }

    // Step 3: sumario final
    console.log('\n===== SUMARIO =====');
    const ok = resultados.filter(r => r.ok).length;
    const erro = resultados.filter(r => !r.ok).length;
    console.log(`${ok} sucesso(s), ${erro} erro(s). Arquivos em ${OUT_DIR}`);
    console.log('');
    console.log('Proximo passo: envie os JSONs gerados pra mapear os parsers reais');
    console.log('(das-provider, dctfweb-provider, caixa-postal-orchestrator) sem ADIVINHAR campos.');
    console.log('');
    console.log('NAO INTEGRADOS aqui (sem suporte SERPRO real ainda):');
    console.log('  - NFSe Nacional Padrao: nfse-nacional-provider so tem mock');
    console.log('  - DARF: so existe idServico de EMISSAO (nao adicionei pra nao gerar DARF real)');

    process.exit(erro > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Erro inesperado:', err);
    process.exit(99);
});
