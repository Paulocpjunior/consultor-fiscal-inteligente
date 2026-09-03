// ============================================================================
// 🔍 AUDITORIA COMPLETA DE 03/09 — SEGUNDA PASSADA (Paulo: "Roda novamente a
// auditoria completa"). Cada bloco aqui é a TRAVA de uma correção: parte é
// comportamento (o módulo responde certo), parte é varredura de fonte (a
// correção não pode ser desfeita em silêncio por um refactor).
//
// 🚨 A segunda passada achou TRÊS REGRESSÕES da primeira — guarda que subiu
// "admin OU irmão" onde a guarda local era `requireAuth` (o atendente do
// Connect e o colaborador do R-2010 ficaram de fora), e uma rota que ganhou
// `requireAuth` sem o frontend mandar o header. Corrigir uma classe pode
// abrir outra; por isso a trava de cada ponto é sobre o COMPORTAMENTO.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import { statusDoCstatProtocolo, extrairTomadorCte, extrairParticipantesNfe } from '../sefaz-backend/xml-metadata-helper.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';
import { CATALOGO } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { OBRIGACOES } from '../sefaz-backend/calendario-obrigacoes.js';
// @ts-expect-error módulo JS puro sem tipos
import { acharEmpresaPorCnpj, soDigitosCnpj } from '../sefaz-backend/empresa-por-cnpj.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { acharEmpresaCadastrada, limparCacheCadastro } from '../sefaz-backend/empresa-cadastro-lookup.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { gravarCancelamentoConfirmado } from '../sefaz-backend/cancelamento-gravacao.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { gravarCoberturaDeclarada } from '../sefaz-backend/cobertura-declarada-store.js';
import { chavesParaLimpar } from '../services/sessaoLocal';
import { fmtBRL, fmtComp } from '../services/formatos';

const raiz = path.resolve(__dirname, '..');
const ler = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8');
const semComentarios = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ─── 1. Prazo do SPED: UMA data, nos dois catálogos ────────────────────────
describe('SPED vence no mês SUBSEQUENTE — catálogo e calendario legado concordam', () => {
    it('mesesApos é 1 nos dois (CAT 147/2009 art. 10)', () => {
        const sped = CATALOGO.LUCRO_REAL.find((r: any) => r.obrigacao === 'SPED')!;
        expect(sped.mesesApos).toBe(1);
        expect(OBRIGACOES.SPED_FISCAL.mesesApos).toBe(1);
    });
});

// ─── 2. cStat do protocolo tem UM tradutor ─────────────────────────────────
describe('statusDoCstatProtocolo — dono único (importer e auto-sync liam tabelas próprias)', () => {
    it.each([
        ['100', 'autorizado'], ['150', 'autorizado'],
        ['101', 'cancelado'], ['151', 'cancelado'],
        ['110', 'denegado'], ['301', 'denegado'], ['302', 'denegado'], ['303', 'denegado'],
        ['102', 'inutilizado'],
        ['', 'desconhecido'], [null, 'desconhecido'],
        ['204', 'rejeitado'], ['999', 'rejeitado'],
    ])('cStat %s ⇒ %s', (cStat, esperado) => {
        expect(statusDoCstatProtocolo(cStat as any)).toBe(esperado);
    });

    it('importer e auto-sync DELEGAM (nenhuma tabela própria de cStat sobreviveu)', () => {
        for (const arq of ['sefaz-backend/xml-importer.js', 'sefaz-backend/sharepoint-auto-sync.js']) {
            const src = semComentarios(ler(arq));
            expect(src).toMatch(/statusDoCstatProtocolo\(/);
            expect(src).not.toMatch(/['"]100['"]\s*:\s*['"]autorizado['"]/);
        }
    });
});

// ─── 3. Formato do SPED: caractere fora da tabela e `|` no campo ──────────
describe('sped-fiscal-format — o arquivo não pode carregar o que o PVA recusa', () => {
    it('translitera pontuação tipográfica e derruba o que não cabe em latin1', () => {
        const s = fmt.sanitizeString('“Aço” – 10 kg… − 5 中', 60);
        expect(s).not.toMatch(/[“”–… −中]/);
        expect(s).toContain('"Aço"'); // ç é latin1 e FICA — só o que não cabe cai
        expect(s).toContain('- 10 kg');
    });

    it('buildLine tira `|`, CR e LF de DENTRO do campo — senão a linha vira duas e a contagem quebra', () => {
        const linha = fmt.buildLine(['0200', 'ITEM|1', 'Desc\r\nquebrada']);
        expect(linha.match(/\|/g)!.length).toBe(4); // |0200|ITEM1|Descquebrada|
        expect(linha.slice(0, -2)).not.toMatch(/[\r\n]/);
        expect(linha.endsWith('\r\n')).toBe(true);
    });
});

// ─── 4. CT-e: quem TOMA o frete é a contraparte ────────────────────────────
describe('extrairTomadorCte — toma3/toma4 no backend (o frontend já sabia desde 19/08)', () => {
    const cte = (ide: string, extra = '') => `<cteProc><CTe><infCte Id="CTe1"><ide>${ide}</ide>
        <emit><CNPJ>11111111000191</CNPJ><xNome>TRANSP</xNome></emit>
        <rem><CNPJ>22222222000191</CNPJ><xNome>REMETENTE</xNome><enderReme><UF>SP</UF></enderReme></rem>
        <dest><CNPJ>33333333000191</CNPJ><xNome>DESTINO FINAL</xNome></dest>${extra}</infCte></CTe></cteProc>`;

    it('toma3=0 aponta o REMETENTE — e o importer usa o tomador como cnpjDest', () => {
        const t = extrairTomadorCte(cte('<toma3><toma>0</toma></toma3>'));
        expect(t).toEqual({ cnpj: '22222222000191', nome: 'REMETENTE', uf: 'SP', origem: 'rem' });
        expect(extrairParticipantesNfe(cte('<toma3><toma>0</toma></toma3>')).tomador?.cnpj).toBe('22222222000191');
        const imp = semComentarios(ler('sefaz-backend/xml-importer.js'));
        expect(imp).toContain('participantes.tomador?.cnpj || participantes.destinatario.cnpj');
    });

    it('toma4 (outro) vence, e toma3=3 devolve o destinatário', () => {
        const t4 = extrairTomadorCte(cte('<toma4><CNPJ>44444444000191</CNPJ><xNome>OUTRO</xNome></toma4>'));
        expect(t4?.origem).toBe('toma4');
        expect(t4?.cnpj).toBe('44444444000191');
        expect(extrairTomadorCte(cte('<toma3><toma>3</toma></toma3>'))?.origem).toBe('dest');
    });

    it('NF-e não tem tomador: null, e nada muda para ela', () => {
        expect(extrairTomadorCte('<nfeProc><NFe><infNFe><emit><CNPJ>1</CNPJ></emit></infNFe></NFe></nfeProc>')).toBeNull();
        expect(extrairParticipantesNfe('<NFe><infNFe><emit><CNPJ>11111111000191</CNPJ></emit><dest><CNPJ>22222222000191</CNPJ></dest></infNFe></NFe>').tomador).toBeNull();
    });
});

// ─── 5. CNPJ alfanumérico não vira "curto" ─────────────────────────────────
describe('CNPJ alfanumérico (IN RFB 2.229/2024) — `\\D` apagava as letras', () => {
    const alfa = '12.ABC.345/0001-90';
    it('a normalização preserva letras e casa com o cadastro', () => {
        expect(soDigitosCnpj(alfa)).toHaveLength(14);
        expect(acharEmpresaPorCnpj([{ id: 'x', cnpj: '12ABC345000190' }], alfa)?.id).toBe('x');
    });

    it('os quatro leitores delegam ao dono (`limparCnpj`) em vez de `replace(/\\D/g, "")`', () => {
        for (const arq of ['sefaz-backend/empresa-por-cnpj.js', 'sefaz-backend/empresa-cadastro-lookup.js',
            'sefaz-backend/cadastro-central.js', 'sefaz-backend/reinf-servicos-tomados.js']) {
            const src = semComentarios(ler(arq));
            expect(src).toMatch(/import \{ limparCnpj \} from '\.\/documento-dv\.js'/);
            expect(src).toMatch(/const soDigitos(Cnpj)? = \(v\) => limparCnpj\(v\)/);
        }
    });
});

// ─── 6. Lookup: negativo expira RÁPIDO; envio-imposto não varre a coleção ──
function dbLookupFake(encontra: () => { id: string; data: any } | null) {
    const scan = () => { throw new Error('varredura da coleção inteira'); };
    return {
        collection: (col: string) => ({
            get: scan,
            where: () => ({ limit: () => ({ get: async () => {
                const d = encontra();
                return d ? { empty: false, docs: [{ id: d.id, data: () => d.data }] } : { empty: true, docs: [] };
            } }) }),
            select: () => ({ get: async () => ({ forEach: () => {} }) }),
            doc: (id: string) => ({ get: async () => {
                const d = encontra();
                return d && d.id === id ? { exists: true, id, data: () => d.data } : { exists: false };
            } }),
            _col: col,
        }),
    };
}

describe('empresa-cadastro-lookup — "não é cliente" expira em 1 min, "é cliente" continua 5 min', () => {
    it('cliente cadastrado logo depois da primeira pergunta passa a ser achado sem esperar 5 min', async () => {
        limparCacheCadastro();
        let doc: any = null;
        const db = dbLookupFake(() => doc);
        expect(await acharEmpresaCadastrada(db, '51227692000146', { agoraMs: 0 })).toBeNull();
        doc = { id: 'e1', data: { cnpj: '51227692000146' } };
        expect(await acharEmpresaCadastrada(db, '51227692000146', { agoraMs: 30_000 })).toBeNull(); // ainda no cache negativo
        expect((await acharEmpresaCadastrada(db, '51227692000146', { agoraMs: 70_000 }))?.empresaId).toBe('e1');
        limparCacheCadastro();
    });
});

describe('envio-imposto.resolverEmpresa — pelo dono do lookup, nunca varrendo ~400 documentos', () => {
    it('resolve por CNPJ sem chamar `.collection(col).get()`', async () => {
        limparCacheCadastro();
        // @ts-expect-error — módulo backend .js sem .d.ts
        const { resolverEmpresa } = await import('../sefaz-backend/envio-imposto.js');
        const db = dbLookupFake(() => ({ id: 'emp9', data: { cnpj: '51227692000146', nome: 'X' } }));
        const r = await resolverEmpresa(db, { empresaCnpj: '51.227.692/0001-46' });
        expect(r?.id).toBe('emp9');
        const src = semComentarios(ler('sefaz-backend/envio-imposto.js'));
        expect(src).toMatch(/acharEmpresaCadastrada\(db, cnpjAlvo\)/);
        expect(src).not.toMatch(/for \(const col of \['simples_empresas', 'lucro_empresas'\]\) \{\s*const snap = await db\.collection\(col\)\.get\(\)/);
        limparCacheCadastro();
    });
});

// ─── 7. Cancelamento: reconferir duas vezes não empilha o mesmo evento ─────
function dbTransacaoFake(inicial: any) {
    let dados: any = inicial;
    const ref = { _ref: true };
    const db = {
        collection: () => ({ doc: () => ref }),
        runTransaction: async (fn: any) => fn({
            get: async () => ({ exists: dados != null, data: () => dados }),
            set: (_r: any, patch: any) => {
                const atual = dados ? { ...dados } : {};
                for (const [k, v] of Object.entries(patch)) {
                    if (v && (v as any).__arrayUnion) atual[k] = [...(atual[k] || []), ...(v as any).__arrayUnion];
                    else atual[k] = v;
                }
                dados = atual;
            },
        }),
        _dados: () => dados,
    };
    return db;
}
const FieldValueFake = { arrayUnion: (...xs: any[]) => ({ __arrayUnion: xs }) };

describe('gravarCancelamentoConfirmado — identidade do evento é tpEvento + nProt + cStat', () => {
    it('a segunda gravação do MESMO evento não duplica; um evento DIFERENTE entra', async () => {
        const db = dbTransacaoFake({ status: 'autorizado', eventos: [] });
        const ev = { tpEvento: '110111', cStat: '135', nProt: '135260000000001' };
        await gravarCancelamentoConfirmado({ db, FieldValue: FieldValueFake, docId: 'k', evento: ev, origem: 'reconferencia', usuario: 'a' });
        await gravarCancelamentoConfirmado({ db, FieldValue: FieldValueFake, docId: 'k', evento: ev, origem: 'consulta-chave', usuario: 'b' });
        expect(db._dados().eventos).toHaveLength(1);
        expect(db._dados().status).toBe('cancelado');
        await gravarCancelamentoConfirmado({ db, FieldValue: FieldValueFake, docId: 'k', evento: { ...ev, nProt: '135260000000002' }, origem: 'reconferencia', usuario: 'a' });
        expect(db._dados().eventos).toHaveLength(2);
    });
});

// ─── 8. Cobertura declarada: quem declarou ANTES não some ──────────────────
describe('gravarCoberturaDeclarada — a declaração nova vale, a anterior fica no histórico', () => {
    it('preserva primeiraDeclaracaoEm e empilha declaracoesAnteriores (teto 10)', async () => {
        let dados: any = null;
        const db = { collection: () => ({ doc: () => ({
            get: async () => ({ exists: dados != null, data: () => dados }),
            set: async (d: any) => { dados = d; },
        }) }) };
        const base = { empresaId: 'e1', empresaCnpj: '51227692000146', competencia: '2026-07' };
        await gravarCoberturaDeclarada(db, { ...base, declaracao: { autor: 'ana', obrigacoes: ['ISS'], texto: 'entregue no portal', data: '2026-08-10' } });
        const primeira = dados.gravadoEm;
        expect(dados.declaracoesAnteriores).toEqual([]);
        await gravarCoberturaDeclarada(db, { ...base, declaracao: { autor: 'bia', obrigacoes: ['ISS', 'INSS_CPP'], texto: 'entregue e folha paga', data: '2026-08-12' } });
        expect(dados.autor).toBe('bia');
        expect(dados.obrigacoes).toEqual(['ISS', 'INSS_CPP']);
        expect(dados.primeiraDeclaracaoEm).toBe(primeira);
        expect(dados.declaracoesAnteriores).toHaveLength(1);
        expect(dados.declaracoesAnteriores[0].autor).toBe('ana');
    });
});

// ─── 9. Fim de mês: gravação em transação, com a versão lida ───────────────
describe('fim-de-mes /fechar — relê o carimbo na transação e recusa com 409 se ele mudou', () => {
    it('a gravação passa por runTransaction comparando versão e estado', () => {
        const src = semComentarios(ler('sefaz-backend/fim-de-mes-routes.js'));
        expect(src).toMatch(/db\.runTransaction\(async \(tx\) =>/);
        expect(src).toMatch(/versaoAtual !== versaoLida \|\| estadoAtual !== estadoLido/);
        expect(src).toMatch(/status\(409\)/);
        expect(src).not.toMatch(/await db\.collection\(COLECAO\)\.doc\(idDoFechamento\(r\.empresa\.id, r\.competencia\)\)\s*\.set\(montado\.fechamento/);
    });
});

// ─── 10. Backend — regressões da 1ª passada e endurecimentos ───────────────
describe('as três regressões da 1ª passada não voltam', () => {
    it('/conversas/iniciar aceita o ATENDENTE (requireAuth) ou app irmão — nunca só admin', () => {
        const src = semComentarios(ler('sefaz-backend/whatsapp-routes.js'));
        expect(src).toMatch(/const autorizarAtendente = guardaLocalOuIrmao\(\s*\(req, res, next\) => requireAuth\(/);
        expect(src).toMatch(/router\.post\('\/conversas\/iniciar', autorizarAtendente,/);
    });
    it('/servicos-tomados e irmãs aceitam o COLABORADOR (requireAuth) ou o Contábil', () => {
        const src = semComentarios(ler('sefaz-backend/reinf-retencoes-pj-routes.js'));
        expect(src).toMatch(/const autorizarColaborador = guardaLocalOuIrmao\(requireAuth, \[PROJETO\.contabil\]\)/);
        for (const rota of ['retencoes-pj', 'servicos-tomados', 'movimento-fiscal', 'aquisicao-rural']) {
            expect(src).toMatch(new RegExp(`router\\.get\\('/${rota}', autorizarColaborador,`));
        }
    });
    it('/nbs ganhou requireAuth E o frontend manda o header', () => {
        expect(semComentarios(ler('sefaz-backend/nfse-nacional-routes.js'))).toMatch(/router\.get\('\/nbs', requireAuth,/);
        expect(semComentarios(ler('services/nfseNacionalService.ts'))).toMatch(/fetch\(`\$\{BASE\}\/nbs`, \{ headers: await authHeaders\(user\) \}\)/);
    });
});

describe('endurecimentos do backend (2ª passada)', () => {
    it('nenhum `express.json(` por rota — o parser global do server.js é o ÚNICO que roda', () => {
        const dir = path.join(raiz, 'sefaz-backend');
        const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('-routes.js')).concat(['sharepoint-auto-sync.js']);
        expect(arquivos.length).toBeGreaterThan(30);
        for (const f of arquivos) {
            expect({ f, tem: /express\.json\(/.test(semComentarios(ler(`sefaz-backend/${f}`))) }).toEqual({ f, tem: false });
        }
        expect(semComentarios(ler('server.js'))).toMatch(/req\.originalUrl \|\| ''\)\.startsWith\('\/api\/whatsapp\/webhook'\)\) req\.rawBody = buf/);
    });

    it('zip e gzip têm teto de saída (bomba de descompressão)', () => {
        expect(semComentarios(ler('sefaz-backend/zip-reader.js'))).toMatch(/inflateRawSync\(dados, \{ maxOutputLength: maxBytesPorArquivo \}\)/);
        for (const f of ['agent-routes.js', 'nfse-nacional-dfe-importer.js', 'sefaz-client.js', 'cte-client.js']) {
            const src = semComentarios(ler(`sefaz-backend/${f}`));
            expect(src).toMatch(/gunzipSync\([^)]*\{ maxOutputLength: 64 \* 1024 \* 1024 \}\)/);
            expect(src).not.toMatch(/gunzipSync\(\w+\)/);
        }
    });

    it('webhook do WhatsApp: replay curto-circuita e diagnóstico é limitado por janela', () => {
        const src = semComentarios(ler('sefaz-backend/whatsapp-webhook-routes.js'));
        expect(src).toMatch(/if \(\(await evRef\.get\(\)\)\.exists\) return res\.sendStatus\(200\)/);
        expect(src).toMatch(/function podeGravarDiagnostico\(chave, janelaMs = 60_000\)/);
        expect(src).toMatch(/podeGravarDiagnostico\('webhook_verificacao'\)/);
        expect(src).toMatch(/podeGravarDiagnostico\('webhook_post_recusado'\)/);
    });

    it('segredo nunca vai ao log em claro — só a impressão sha256', () => {
        const src = semComentarios(ler('sefaz-backend/sync-routes.js'));
        expect(src).toMatch(/createHash\('sha256'\)/);
        expect(src).not.toMatch(/SECRET[^\n]*\.slice\(0, ?4\)/i);
    });

    it('CORS: localhost só fora de produção (app e proxy) e o regex do Cloud Run é fechado', () => {
        expect(semComentarios(ler('server.js'))).toMatch(/NODE_ENV === 'production' \? \[\] : \['http:\/\/localhost:3000'/);
        const proxy = semComentarios(ler('proxy-backend/server.js'));
        expect(proxy).toMatch(/NODE_ENV === 'production' \? \[\] : \['http:\/\/localhost:3000'/);
        expect(proxy).toMatch(/consultor-fiscal-inteligente-\(631239634290\|\[a-z0-9\]\{10\}-uw\)/);
        expect(proxy).toMatch(/function mensagemSegura\(err, padrao\)/);
        expect(proxy).not.toMatch(/error: err\?\.message \|\|/);
    });

    it('dp-integration: só DP e Contábil pelo túnel; fila de imagem do WhatsApp grava em transação', () => {
        expect(semComentarios(ler('sefaz-backend/dp-integration-routes.js'))).toMatch(/const requireIrmao = crossProjectAuth\(\[PROJETO\.dpFolha, PROJETO\.contabil\]\)/);
        expect((semComentarios(ler('sefaz-backend/whatsapp-routes.js')).match(/db\.runTransaction\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

// ─── 11. Frontend — o que a 2ª passada ligou ───────────────────────────────
describe('frontend (2ª passada)', () => {
    it('logout apaga o dado de cliente/usuário do navegador e mantém preferência de UI', () => {
        const chaves = ['app_users', 'app_access_logs', 'simples_nacional_notas', 'cfi_empresa_ativa:u1', 'cfi_banner_fechado', 'theme'];
        expect(chavesParaLimpar(chaves).sort()).toEqual(['app_access_logs', 'app_users', 'cfi_empresa_ativa:u1', 'simples_nacional_notas']);
        expect(semComentarios(ler('services/authService.ts'))).toMatch(/limparDadosLocaisDaSessao\(\)/);
    });

    it('formatos.ts é o dono de fmtBRL/fmtComp — ausência vira "—", nunca "R$ 0,00"', () => {
        expect(fmtBRL(1234.5)).toBe('R$ 1.234,50');
        expect(fmtBRL(null)).toBe('—');
        expect(fmtBRL('abc')).toBe('—');
        expect(fmtComp('2026-07')).toBe('07/2026');
        expect(fmtComp('')).toBe('');
    });

    it('os leitores de SPED da tela decodificam latin1 pelo dono; o SAGE lê o CST pelo dono do backend', () => {
        for (const f of ['components/SpedFiscal/ConciliarFaturamento.tsx', 'components/SpedFiscal/CruzarObrigacoes.tsx', 'components/SpedFiscal/EditarViaExcel.tsx']) {
            expect(semComentarios(ler(f))).toMatch(/lerTextoLatin1OuUtf8/);
        }
        expect(semComentarios(ler('services/iobSageExportService.ts'))).toMatch(/import \{ cstDoLancamento \} from '\.\.\/sefaz-backend\/cst-correlacao\.js'/);
    });

    it('sanitizePayload do Simples delega ao dono (NaN recusado NOMEADO, não virado em null)', () => {
        const src = semComentarios(ler('services/simplesNacionalService.ts'));
        expect(src).toMatch(/const sanitizePayload = \(obj: any\) => sanitizeForFirestore\(obj\)/);
        expect(src).not.toMatch(/JSON\.parse\(JSON\.stringify\(obj\)\)/);
    });

    it('Vencimentos tem a aba do rito e a NFS-e Nacional lê o valor digitado pelo dono', () => {
        expect(semComentarios(ler('components/Vencimentos/VencimentosHub.tsx'))).toMatch(/label: '📤 Envios \(rito\)'/);
        expect(semComentarios(ler('components/NfseNacional/EmitirModal.tsx'))).toMatch(/parseValorMoeda\(valor\)/);
    });
});
