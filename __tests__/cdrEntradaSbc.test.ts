// ============================================================================
// ☎️ A LIGAÇÃO RECEBIDA VIRA LINHA NA CONVERSA — PELO CDR DO SBC (28/09)
// 📞 E O PEDIDO DE RETORNO VIRA PENDÊNCIA DE ALGUÉM
//
// Em modo SIP a Meta NÃO manda evento de chamada no webhook (medido em 25/08):
// a ligação que o cliente faz pelo ☎️ caía na URA e o SP Connect não ficava
// sabendo. Quem sabe é o CDR do Asterisk. O agente da VM (o mesmo do
// click-to-call) passa a mandar as linhas de ENTRADA para POST /sbc/cdr, e
// elas entram pela MESMA função do webhook de chamadas.
//
// O que se prova: a interpretação da linha (puro), a leitura incremental do
// CDR pelo agente (python EXECUTADO), a régua "é entrada da Meta?" igual nos
// dois lados, e a fiação (rota, webhook, tela, pendência que fecha ao ligar
// ou encerrar).
// ============================================================================
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
    interpretarCdrDeEntrada, lerPedidoDeRetorno, resumoDoPedidoDeRetorno,
    traduzirEventoChamada, resumoDaChamada,
} from '../sefaz-backend/whatsapp-chamadas.js';

const raiz = process.cwd();
const ler = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8');
const SEM_BYTECODE = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const AGENTE = path.join(raiz, 'scripts/sbc-agente-saida.py');

const linha = (over: Record<string, string> = {}) => ({
    accountcode: '', src: '5511999990000', dst: '211', dcontext: 'de-meta',
    clid: '"5511999990000" <5511999990000>', channel: 'PJSIP/meta-00000012', dstchannel: 'PJSIP/hit-00000013',
    lastapp: 'Dial', lastdata: 'PJSIP/211@hit,60', start: '2026-09-28 13:00:00', answer: '2026-09-28 13:00:04',
    end: '2026-09-28 13:01:10', duration: '70', billsec: '66', disposition: 'ANSWERED', amaflags: 'DOCUMENTATION',
    uniqueid: '1759064400.12', ...over,
});

describe('interpretarCdrDeEntrada — só a perna que a Meta abriu, e o que dela se lê', () => {
    it('ligação atendida: número do src, evento accepted, callId do uniqueid, carimbo UTC', () => {
        const r = interpretarCdrDeEntrada(linha());
        expect(r).toEqual({
            ehEntradaDaMeta: true, numero: '5511999990000', srcCru: '5511999990000', callId: 'sbc_1759064400_12',
            evento: 'accepted', duracaoSegundos: 66, timestamp: '2026-09-28T13:00:00Z', atendida: true,
        });
    });

    it('perdida / ocupado / falha viram eventos que a linha da conversa já sabe traduzir', () => {
        expect((interpretarCdrDeEntrada(linha({ disposition: 'NO ANSWER', billsec: '0' })) as any).evento).toBe('missed');
        expect((interpretarCdrDeEntrada(linha({ disposition: 'BUSY', billsec: '0' })) as any).evento).toBe('busy');
        expect((interpretarCdrDeEntrada(linha({ disposition: 'CONGESTION', billsec: '0' })) as any).evento).toBe('failed');
        expect(traduzirEventoChamada('busy')).toBe('ocupado');
        expect(resumoDaChamada({ direcao: 'entrada', evento: 'missed', duracaoSegundos: null })).toMatch(/do cliente — perdida/);
        expect(resumoDaChamada({ direcao: 'entrada', evento: 'accepted', duracaoSegundos: 66 })).toMatch(/atendida · 1m06s/);
    });

    it('src que não é número: tenta o clid; sem nada, numero null e o src cru fica para a régua', () => {
        const doClid = interpretarCdrDeEntrada(linha({ src: 'anonymous', clid: '"WhatsApp" <+55 11 99999-0000>' })) as any;
        expect(doClid.numero).toBe('5511999990000');
        const nada = interpretarCdrDeEntrada(linha({ src: 'meta', clid: '"meta" <meta>' })) as any;
        expect(nada.ehEntradaDaMeta).toBe(true);
        expect(nada.numero).toBeNull();
        expect(nada.srcCru).toBe('meta');
    });

    it('NÃO é entrada da Meta: a perna HIT, a nossa perna de saída, o click-to-call, linha sem uniqueid', () => {
        expect(interpretarCdrDeEntrada(linha({ dcontext: 'de-hit', channel: 'PJSIP/hit-00000001' }))).toEqual({ ehEntradaDaMeta: false });
        expect(interpretarCdrDeEntrada(linha({ dcontext: 'saida-whatsapp', channel: 'PJSIP/meta-saida-00000002' }))).toEqual({ ehEntradaDaMeta: false });
        expect(interpretarCdrDeEntrada(linha({ accountcode: 'lig_5511999990000_20260928130000000' }))).toEqual({ ehEntradaDaMeta: false });
        expect(interpretarCdrDeEntrada(linha({ uniqueid: '' }))).toEqual({ ehEntradaDaMeta: false });
        expect(interpretarCdrDeEntrada(null)).toEqual({ ehEntradaDaMeta: false });
    });

    it('carimbo fora da forma do cdr_csv vira null, nunca "agora"', () => {
        expect((interpretarCdrDeEntrada(linha({ start: 'ontem' })) as any).timestamp).toBeNull();
    });
});

describe('lerPedidoDeRetorno — o mínimo sem conhecer o leiaute', () => {
    it('acha o cliente em from ou wa_id; NUNCA no display_phone_number (que é nosso)', () => {
        expect(lerPedidoDeRetorno({ entry: [{ changes: [{ value: { metadata: { display_phone_number: '551133371554', phone_number_id: '1167203206473367' }, callback: { from: '+5511999990000' } } }] }] }))
            .toEqual({ numero: '5511999990000', phoneNumberId: '1167203206473367' });
        expect(lerPedidoDeRetorno({ contacts: [{ wa_id: '5511888880000' }], callback_request: true }).numero).toBe('5511888880000');
        expect(lerPedidoDeRetorno({ metadata: { display_phone_number: '551133371554' }, callback: {} }).numero).toBeNull();
        expect(lerPedidoDeRetorno(null).numero).toBeNull();
    });

    it('a linha da conversa diz o que fazer, não só o que aconteceu', () => {
        expect(resumoDoPedidoDeRetorno()).toMatch(/RETORNO de ligação/);
        expect(resumoDoPedidoDeRetorno()).toMatch(/ligue de volta pelo ☎️/);
    });
});

describe('🐍 o agente lê o CDR de forma INCREMENTAL — executado, não lido', () => {
    const roda = (codigo: string) => execFileSync('python3', ['-c', [
        'import importlib.util, sys, json, os',
        `spec = importlib.util.spec_from_file_location("ag", ${JSON.stringify(AGENTE)})`,
        'ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)',
        codigo,
    ].join('\n')], { encoding: 'utf8', env: SEM_BYTECODE });

    it('1ª vez sem offset: começa do FIM (sem backfill); depois só devolve o que chegou, e linha pela metade espera', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-'));
        const csv = path.join(dir, 'Master.csv');
        const l1 = '"","5511999990000","211","de-meta","""x"" <5511999990000>","PJSIP/meta-00000012","PJSIP/hit-00000013","Dial","PJSIP/211@hit,60","2026-09-28 13:00:00","2026-09-28 13:00:04","2026-09-28 13:01:10",70,66,"ANSWERED","DOCUMENTATION","1759064400.12"\n';
        const l2 = '"lig_5511999990000_20260928130000000","5511999990000","5511999990000","saida-whatsapp","""WhatsApp"" <5511999990000>","PJSIP/hit-00000020","PJSIP/meta-saida-00000021","Dial","PJSIP/5511999990000@meta-saida,60","2026-09-28 14:00:00","","2026-09-28 14:00:40",40,0,"NO ANSWER","DOCUMENTATION","1759068000.20"\n';
        fs.writeFileSync(csv, 'linha velha que NÃO pode ser reenviada\n');
        const saida = roda([
            `csv = ${JSON.stringify(csv)}`,
            'a, off = ag.ler_cdr_novas(csv, None)',                 // 1ª vez: nada, offset = fim
            `open(csv, "a").write(${JSON.stringify(l1 + l2)})`,
            'b, off2 = ag.ler_cdr_novas(csv, off)',                // as duas novas
            'open(csv, "a").write(\'"","5511777770000","211","de-meta"\')',  // pela metade
            'c, off3 = ag.ler_cdr_novas(csv, off2)',               // nada, offset não anda
            'open(csv, "w").write("")',                            // rotacionou
            'd, off4 = ag.ler_cdr_novas(csv, off3)',
            'sys.stdout.write(json.dumps({"a": len(a), "b": [(x["uniqueid"], x["dcontext"], ag.eh_entrada_da_meta(x)) for x in b], "c": len(c), "off3_igual": off3 == off2, "off4": off4}))',
        ].join('\n'));
        const r = JSON.parse(saida);
        expect(r.a).toBe(0);
        expect(r.b).toEqual([['1759064400.12', 'de-meta', true], ['1759068000.20', 'saida-whatsapp', false]]);
        expect(r.c).toBe(0);
        expect(r.off3_igual).toBe(true);
        expect(r.off4).toBe(0);
    });

    it('a régua "é entrada da Meta?" é a MESMA nos dois lados (python × núcleo JS)', () => {
        const casos = [
            linha(), linha({ dcontext: 'de-hit', channel: 'PJSIP/hit-1' }),
            linha({ dcontext: 'saida-whatsapp', channel: 'PJSIP/meta-saida-2' }),
            linha({ accountcode: 'lig_5511999990000_20260928130000000' }),
            linha({ dcontext: 'outro', channel: 'PJSIP/meta-00000099' }),
        ];
        const py = JSON.parse(roda(`sys.stdout.write(json.dumps([ag.eh_entrada_da_meta(c) for c in ${JSON.stringify(casos)}]))`));
        const js = casos.map((c) => interpretarCdrDeEntrada(c).ehEntradaDaMeta);
        expect(py).toEqual(js);
    });
});

describe('fiação: rota, webhook, pendência e tela', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const webhook = ler('sefaz-backend/whatsapp-webhook-routes.js');
    const tela = ler('components/SpConnect/index.tsx');
    const agente = ler('scripts/sbc-agente-saida.py');

    it('POST /sbc/cdr exige o segredo do agente e grava pela MESMA função do webhook de chamadas', () => {
        const rota = rotas.slice(rotas.indexOf("router.post('/sbc/cdr'"), rotas.indexOf("router.get('/sbc/agente'"));
        expect(rota).toMatch(/requireSbcSecret/);
        expect(rota).toMatch(/interpretarCdrDeEntrada\(cdr\)/);
        expect(rota).toMatch(/gravarEventoChamada\(db, \{/);
        expect(webhook).toMatch(/export async function gravarEventoChamada/);
        // Linha sem número NÃO some — fica com o src cru.
        expect(rota).toMatch(/whatsapp_chamadas_sem_numero/);
        expect(rota).toMatch(/srcCru/);
    });

    it('o pedido de retorno vira linha + carimbo na conversa (conta não lida, reabre) e, sem número, é contado', () => {
        const bloco = webhook.slice(webhook.indexOf("naturezaDoEventoCru(req.body) === 'pedido-de-retorno'"));
        expect(bloco).toMatch(/lerPedidoDeRetorno\(req\.body\)/);
        expect(bloco).toMatch(/retornoDeLigacao: \{ pedidoEm: agora, atendidoEm: null/);
        expect(bloco).toMatch(/naoLidas: admin\.firestore\.FieldValue\.increment\(1\)/);
        expect(bloco).toMatch(/patchDeReabertura\(convAnterior/);
        expect(bloco).toMatch(/doc\('pedidos_retorno'\)/);
    });

    it('a pendência FECHA quando alguém liga pelo ☎️ ou encerra — e a tela mostra o chip enquanto está aberta', () => {
        expect(rotas).toMatch(/atendidoComo: 'ligacao'/);
        expect(rotas).toMatch(/atendidoComo: 'encerrado-sem-ligar'/);
        expect(rotas).toMatch(/retornoDeLigacao: x\.retornoDeLigacao \|\| null/);
        expect(tela).toMatch(/c\.retornoDeLigacao && !c\.retornoDeLigacao\.atendidoEm/);
        expect(tela).toMatch(/📞 pediu retorno/);
        // A aba ☎️ diz quantas recebidas o CDR registrou e quantas ficaram sem número.
        expect(tela).toMatch(/agenteSbc\.cdr\?\.recebidas/);
        expect(tela).toMatch(/agenteSbc\.cdr\?\.semNumero/);
    });

    it('o agente acompanha o CDR por offset, manda só ENTRADA para /sbc/cdr e não faz backfill', () => {
        expect(agente).toMatch(/def ler_cdr_novas/);
        expect(agente).toMatch(/def eh_entrada_da_meta/);
        expect(agente).toMatch(/\/api\/admin\/whatsapp\/sbc\/cdr/);
        expect(agente).toMatch(/sem backfill/);
        expect(agente).toMatch(/gravar_offset\(CDR_OFFSET_FILE/);
    });
});
