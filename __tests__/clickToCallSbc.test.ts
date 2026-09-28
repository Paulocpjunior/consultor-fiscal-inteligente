// ============================================================================
// ☎️ CLICK-TO-CALL PELO SBC (28/09) — Paulo: "quanto ao cliente autorizar já
// estamos cientes e funcionamos; precisamos ativar o resto das funções".
//
// O resto: [☎️ Ligar] na conversa → pedido gravado → o agente na VM do SBC
// escreve um CALL FILE → o Asterisk toca o RAMAL do colaborador → ao atender,
// disca o cliente pela perna Meta → o CDR diz como terminou → a tela mostra.
//
// O que se prova aqui, por camada:
//  · o NÚCLEO puro (sem rede): as travas da Meta em ordem, o call file linha
//    a linha, a leitura do CDR, a expiração, as frases da tela;
//  · o AGENTE (python) monta o MESMO call file que o núcleo JS — executado de
//    verdade, não comparado por leitura;
//  · a FIAÇÃO: rota, segredo, transação, tela, setup do SBC, systemd.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
    avaliarPedidoDeLigacao, montarCallFile, lerResultadoDoCdr, traduzirResultado, estadoDoPedido,
    resumoDoPedido, situacaoDoAgente, idDoPedido, montarPedido, validarRamal, lerLinhaCdr,
    VALIDADE_PEDIDO_MS, CONTEXTO_SAIDA, ENDPOINT_HIT,
} from '../sefaz-backend/whatsapp-click-to-call.js';

const raiz = process.cwd();
const ler = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8');

const AGORA = new Date('2026-09-28T13:00:00Z');
const aceita = { permissaoLigacao: { status: 'aceita', expiraEm: '2026-10-04T00:00:00Z' } };

describe('avaliarPedidoDeLigacao — as travas da Meta são do BACKEND, em ordem', () => {
    const base = { numero: '5511999990000', eu: 'ana@sp.com', ramal: '221', agora: AGORA };

    it('sem o "Permitir" recusa e diz o que fazer; recusa do cliente NÃO vira "peça de novo"', () => {
        const semPedido = avaliarPedidoDeLigacao({ ...base, conversa: {} });
        expect(semPedido.ok).toBe(false);
        expect((semPedido as any).error).toMatch(/ainda não autorizou ligações/);
        expect((semPedido as any).permissao).toBe('sem-pedido');
        const recusada = avaliarPedidoDeLigacao({ ...base, conversa: { permissaoLigacao: { status: 'recusada' } } });
        expect((recusada as any).error).toMatch(/respeite a recusa/);
        expect((recusada as any).acao).toMatch(/bloquear o número/);
        const pendente = avaliarPedidoDeLigacao({ ...base, conversa: { permissaoLigacao: { status: 'pendente' } } });
        expect((pendente as any).error).toMatch(/ainda não respondeu/);
    });

    it('autorização EXPIRADA é recusa própria, não "sem permissão"', () => {
        const r = avaliarPedidoDeLigacao({ ...base, conversa: { permissaoLigacao: { status: 'aceita', expiraEm: '2026-09-27T00:00:00Z' } } });
        expect((r as any).permissao).toBe('expirada');
        expect((r as any).error).toMatch(/EXPIROU/);
    });

    it('condução por OUTRA pessoa recusa com o caminho (assumir); pelo próprio condutor passa', () => {
        const outro = avaliarPedidoDeLigacao({ ...base, conversa: { ...aceita, atribuidoA: 'bia@sp.com' } });
        expect((outro as any).status).toBe(409);
        expect((outro as any).emConducaoPor).toBe('bia@sp.com');
        expect((outro as any).acao).toMatch(/Assuma a conversa \(🙋\) antes de ligar/);
        const eu = avaliarPedidoDeLigacao({ ...base, conversa: { ...aceita, atribuidoA: 'ana@sp.com' } });
        expect(eu.ok).toBe(true);
    });

    it('sem RAMAL recusa dizendo ONDE cadastrar — nunca deduz o 221', () => {
        for (const ramal of [undefined, '', 'abc', '5511999990000']) {
            const r = avaliarPedidoDeLigacao({ ...base, ramal, conversa: aceita });
            expect(r.ok).toBe(false);
            expect((r as any).semRamal).toBe(true);
            expect((r as any).acao).toMatch(/👥 Atendentes/);
        }
    });

    it('sem SBC_SHARED_SECRET no Cloud Run é 503 nomeado — o agente não pegaria nada', () => {
        const r = avaliarPedidoDeLigacao({ ...base, conversa: aceita, agenteConfigurado: false });
        expect((r as any).status).toBe(503);
        expect((r as any).agenteNaoConfigurado).toBe(true);
        expect((r as any).error).toMatch(/SBC_SHARED_SECRET/);
    });

    it('Instagram não tem chamada; tudo certo devolve o ramal validado', () => {
        expect(avaliarPedidoDeLigacao({ ...base, conversa: { ...aceita, canal: 'instagram' } }).ok).toBe(false);
        const ok = avaliarPedidoDeLigacao({ ...base, ramal: ' 221 ', conversa: aceita });
        expect(ok).toEqual({ ok: true, ramal: '221' });
    });

    it('validarRamal: só dígitos, 2 a 6', () => {
        expect(validarRamal('221')).toEqual({ ok: true, ramal: '221' });
        expect(validarRamal('1').ok).toBe(false);
        expect(validarRamal('1234567').ok).toBe(false);
        expect(validarRamal('22a').ok).toBe(false);
    });
});

describe('o call file — linha a linha, porque é ele que o Asterisk executa', () => {
    it('toca o RAMAL pelo endpoint hit, cai no contexto de saída com o número do cliente e leva o pedido como accountcode', () => {
        const cf = montarCallFile({ ramal: '221', numero: '5511999990000', pedidoId: 'lig_5511999990000_20260928130000000', nomeContato: 'Maria "Silva"; x' });
        const linhas = cf.split('\n');
        expect(linhas[0]).toBe(`Channel: PJSIP/221@${ENDPOINT_HIT}`);
        // Aspas e ; do nome NÃO entram (quebrariam o arquivo); o número vai como CallerID.
        expect(linhas[1]).toBe('CallerID: "WhatsApp Maria Silva x" <5511999990000>');
        expect(cf).toContain(`Context: ${CONTEXTO_SAIDA}`);
        expect(cf).toContain('Extension: 5511999990000');
        expect(cf).toContain('Account: lig_5511999990000_20260928130000000');
        expect(cf).toContain('MaxRetries: 0');
        expect(cf.endsWith('\n')).toBe(true);
    });

    it('recusa ramal, número ou id tortos — call file torto é ligação para um estranho', () => {
        expect(() => montarCallFile({ ramal: 'x', numero: '5511999990000', pedidoId: 'lig_a_b' })).toThrow(/Ramal/);
        expect(() => montarCallFile({ ramal: '221', numero: '123', pedidoId: 'lig_a_b' })).toThrow(/Número/);
        expect(() => montarCallFile({ ramal: '221', numero: '5511999990000', pedidoId: 'x; rm' })).toThrow(/pedido/);
    });

    it('🐍 o AGENTE (python) monta o MESMO call file — executado, não lido', () => {
        const args = { ramal: '221', numero: '5511999990000', pedidoId: 'lig_5511999990000_20260928130000000', nomeContato: 'Maria "Silva"; x' };
        const esperado = montarCallFile(args);
        const py = [
            'import importlib.util, sys',
            `spec = importlib.util.spec_from_file_location("ag", ${JSON.stringify(path.join(raiz, 'scripts/sbc-agente-saida.py'))})`,
            'ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)',
            `sys.stdout.write(ag.montar_call_file(${JSON.stringify(args.ramal)}, ${JSON.stringify(args.numero)}, ${JSON.stringify(args.pedidoId)}, ${JSON.stringify(args.nomeContato)}))`,
        ].join('\n');
        const saida = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
        expect(saida).toBe(esperado);
    });

    it('🐍 e o agente traduz o CDR igual ao núcleo', () => {
        const py = [
            'import importlib.util, sys, json',
            `spec = importlib.util.spec_from_file_location("ag", ${JSON.stringify(path.join(raiz, 'scripts/sbc-agente-saida.py'))})`,
            'ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)',
            'r = ag.traduzir({"disposition": "NO ANSWER", "dstchannel": "PJSIP/meta-saida-0001", "billsec": 0, "lastdata": ""})',
            'sys.stdout.write(json.dumps([r[0], r[3]]))',
        ].join('\n');
        const [status, detalhe] = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
        const js = traduzirResultado({ encontrado: true, disposicao: 'NO ANSWER', pernaCliente: true, billsec: 0, lastdata: null });
        expect(status).toBe(js.status);
        expect(detalhe).toBe(js.detalhe);
    });
});

describe('o CDR responde "atendeu?" — nunca a nossa vontade', () => {
    const PED = 'lig_5511999990000_20260928130000000';
    const linha = (acc: string, dst: string, dstchannel: string, billsec: number, disp: string) =>
        `"${acc}","5511999990000","${dst}","saida-whatsapp","""WhatsApp Maria"" <5511999990000>","PJSIP/hit-00000001","${dstchannel}","Dial","PJSIP/5511999990000@meta-saida,60","2026-09-28 10:00:00","2026-09-28 10:00:05","2026-09-28 10:01:05",65,${billsec},"${disp}","DOCUMENTATION","1759053600.1"`;

    it('lê a linha com aspas duplas escapadas', () => {
        const cdr = lerLinhaCdr(linha(PED, '5511999990000', 'PJSIP/meta-saida-00000002', 60, 'ANSWERED'));
        expect(cdr?.accountcode).toBe(PED);
        expect(cdr?.clid).toBe('"WhatsApp Maria" <5511999990000>');
        expect(cdr?.billsec).toBe(60);
        expect(cdr?.disposition).toBe('ANSWERED');
    });

    it('acha SÓ o pedido certo e, entre várias linhas, a que chegou mais longe', () => {
        const csv = [
            linha('outro', '5511999990000', '', 0, 'ANSWERED'),
            linha(PED, '5511999990000', '', 0, 'NO ANSWER'),
            linha(PED, '5511999990000', 'PJSIP/meta-saida-00000002', 42, 'ANSWERED'),
        ].join('\n');
        const r = lerResultadoDoCdr(csv, PED);
        expect(r).toEqual({ encontrado: true, disposicao: 'ANSWERED', billsec: 42, pernaCliente: true, lastdata: 'PJSIP/5511999990000@meta-saida,60' });
        expect(lerResultadoDoCdr(csv, 'lig_nao_existe')).toEqual({ encontrado: false });
    });

    it('traduz com a PERNA em conta: ramal atendeu sem perna do cliente é FALHA nomeada, não "atendida"', () => {
        expect(traduzirResultado({ encontrado: true, disposicao: 'ANSWERED', pernaCliente: true, billsec: 42, lastdata: null }).status).toBe('atendida');
        const semPerna = traduzirResultado({ encontrado: true, disposicao: 'ANSWERED', pernaCliente: false, billsec: 3, lastdata: null });
        expect(semPerna.status).toBe('falhou');
        expect(semPerna.detalhe).toMatch(/META_SIP_DESTINO/);
        expect(traduzirResultado({ encontrado: true, disposicao: 'BUSY', pernaCliente: true, billsec: 0, lastdata: null }).status).toBe('ocupado');
        expect(traduzirResultado({ encontrado: true, disposicao: 'NO ANSWER', pernaCliente: false, billsec: 0, lastdata: null }).detalhe).toMatch(/ramal não atendeu/);
        // Sem linha no CDR depois da espera: falha, e diz o que conferir.
        const nada = traduzirResultado({ encontrado: false });
        expect(nada.status).toBe('falhou');
        expect(nada.detalhe).toMatch(/não registrou/);
    });
});

describe('pedido: validade, estados e as frases da tela', () => {
    it('id legível e único; o pedido nasce pendente com validade de 2 min', () => {
        const id = idDoPedido({ numero: '5511999990000', agora: AGORA });
        expect(id).toMatch(/^lig_5511999990000_\d{17}$/);
        const p = montarPedido({ id, numero: '5511999990000', ramal: '221', eu: 'ana@sp.com', agora: AGORA });
        expect(p.status).toBe('pendente');
        expect(Date.parse(p.expiraEm) - Date.parse(p.solicitadoEm)).toBe(VALIDADE_PEDIDO_MS);
    });

    it('pendente além da validade é EXPIRADO — agente parado não disca o passado', () => {
        const p = montarPedido({ id: 'x', numero: '5511999990000', ramal: '221', eu: null, agora: AGORA });
        expect(estadoDoPedido(p, new Date(AGORA.getTime() + 60_000))).toBe('pendente');
        expect(estadoDoPedido(p, new Date(AGORA.getTime() + VALIDADE_PEDIDO_MS + 1))).toBe('expirado');
        // Pego a tempo não expira mais.
        expect(estadoDoPedido({ ...p, status: 'pegou' }, new Date(AGORA.getTime() + 10 * VALIDADE_PEDIDO_MS))).toBe('pegou');
        expect(estadoDoPedido(null)).toBe('inexistente');
    });

    it('cada estado tem frase própria e diz se é FINAL', () => {
        const p = montarPedido({ id: 'x', numero: '5511999990000', ramal: '221', eu: null, agora: AGORA });
        expect(resumoDoPedido(p, AGORA)).toMatchObject({ estado: 'pendente', final: false });
        expect(resumoDoPedido({ ...p, status: 'pegou' }, AGORA).texto).toMatch(/ramal 221/);
        expect(resumoDoPedido({ ...p, status: 'atendida', resultado: { detalhe: '42s' } }, AGORA)).toMatchObject({ final: true });
        const exp = resumoDoPedido(p, new Date(AGORA.getTime() + VALIDADE_PEDIDO_MS + 1));
        expect(exp.estado).toBe('expirado');
        expect(exp.texto).toMatch(/agente da VM/);
        expect(exp.final).toBe(true);
    });

    it('o agente está vivo? nunca → "nunca"; 5 s → no ar; 2 min → parado', () => {
        expect(situacaoDoAgente(null, AGORA).vivo).toBe(false);
        expect(situacaoDoAgente(null, AGORA).texto).toMatch(/nunca/);
        expect(situacaoDoAgente({ ultimoContatoEm: new Date(AGORA.getTime() - 5000).toISOString(), versao: '1.0.0' }, AGORA)).toMatchObject({ vivo: true });
        expect(situacaoDoAgente({ ultimoContatoEm: new Date(AGORA.getTime() - 120_000).toISOString() }, AGORA).texto).toMatch(/parado/);
    });
});

describe('fiação: rota, agente, tela e SBC', () => {
    const rotas = ler('sefaz-backend/whatsapp-routes.js');
    const tela = ler('components/SpConnect/index.tsx');
    const svc = ler('services/spConnectService.ts');
    const setup = ler('scripts/setup-sbc-whatsapp.sh');
    const agente = ler('scripts/sbc-agente-saida.py');

    it('a rota /ligar decide pelo núcleo e grava um PEDIDO — nunca chama a API de chamadas da Meta', () => {
        const rota = rotas.slice(rotas.indexOf("router.post('/conversas/:numero/ligar'"), rotas.indexOf("router.get('/conversas/:numero/ligacoes/:id'"));
        expect(rota).toMatch(/avaliarPedidoDeLigacao\(/);
        expect(rota).toMatch(/COLECAO_PEDIDOS_LIGACAO/);
        expect(rota).not.toMatch(/iniciarChamadaParaCliente/);
        // O ramal vem do CADASTRO do usuário logado, nunca do corpo do pedido.
        expect(rota).toMatch(/users'\)\.doc\(req\.user\.uid\)/);
        expect(rota).toMatch(/ramal: usuario\.ramal/);
        // Um pedido vivo por conversa: dois cliques não discam duas vezes.
        expect(rota).toMatch(/Já existe uma ligação em andamento/);
        // E a importação do caminho da API SAIU do router.
        expect(rotas).not.toMatch(/iniciarChamadaParaCliente/);
    });

    it('o agente autentica por segredo em tempo constante e PEGA em transação (dois agentes não discam a mesma)', () => {
        expect(rotas).toMatch(/function requireSbcSecret/);
        expect(rotas).toMatch(/secretsMatch\(req\.headers\['x-sbc-secret'\], esperado\)/);
        const fila = rotas.slice(rotas.indexOf("router.get('/sbc/pedidos'"), rotas.indexOf("router.post('/sbc/pedidos/:id/resultado'"));
        expect(fila).toMatch(/requireSbcSecret/);
        expect(fila).toMatch(/db\.runTransaction/);
        expect(fila).toMatch(/status: 'expirado'/);
        // Cada GET é o "estou vivo" do agente.
        expect(fila).toMatch(/ultimoContatoEm/);
        const resultado = rotas.slice(rotas.indexOf("router.post('/sbc/pedidos/:id/resultado'"), rotas.indexOf("router.get('/sbc/agente'"));
        expect(resultado).toMatch(/requireSbcSecret/);
        expect(resultado).toMatch(/FINAIS\.includes\(status\)/);
        // E deixa a linha na conversa — a ligação é fato do atendimento.
        expect(resultado).toMatch(/tipo: 'chamada'/);
    });

    it('a lista leva o estado da última ligação; o ramal vive no cadastro e só admin grava', () => {
        expect(rotas).toMatch(/ultimaLigacaoSaida: x\.ultimaLigacaoSaida \|\| null/);
        expect(rotas).toMatch(/ramal: x\.ramal \? String\(x\.ramal\) : null/);
        expect(rotas).toMatch(/router\.post\('\/atendentes\/:uid\/ramal', requireAdmin/);
        expect(rotas).toMatch(/validarRamal\(bruto\)/);
    });

    it('a tela tem o botão, confirma ANTES (o telefone da pessoa vai tocar) e acompanha até o estado final', () => {
        expect(tela).toMatch(/☎️ Ligar para \{sel\.nome \|\| 'o cliente'\} pelo WhatsApp/);
        expect(tela).toMatch(/acaoChamarCliente[\s\S]{0,600}await pedirConfirmacao\(/);
        expect(tela).toMatch(/chamarClientePeloSbc\(sel\.numero\)/);
        expect(tela).toMatch(/statusLigacaoSaida\(numero, pedidoId\)/);
        // Condução recusada oferece o caminho (assumir), como no pedido de permissão.
        expect(tela).toMatch(/setLigacaoConducao\(Boolean\(\(r as any\)\.emConducaoPor\)\)/);
        // Ramal em 👥 e o agente na aba ☎️.
        expect(tela).toMatch(/salvarRamalAtendente\(a\.uid, novo\)/);
        expect(tela).toMatch(/Agente de SAÍDA \(click-to-call\)/);
        expect(tela).toMatch(/agenteSbcStatus\(\)/);
        // A porta de fetch da API de chamadas NÃO volta.
        expect(svc).not.toMatch(/export const ligarParaCliente/);
        expect(svc).toMatch(/urlConversa\(numero, 'ligar'\)/);
    });

    it('o setup do SBC instala o agente como systemd (usuário asterisk), o contexto do call file, e o segredo entra por SSH — nunca pelo metadata', () => {
        expect(setup).toMatch(/\[saida-whatsapp\]/);
        expect(setup).toMatch(/Dial\(PJSIP\/\\\$\{EXTEN\}@meta-saida,60\)/);
        expect(setup).toMatch(/sbc-agente-saida\.service/);
        expect(setup).toMatch(/User=asterisk/);
        expect(setup).toMatch(/base64 -d > \/usr\/local\/bin\/sbc-agente-saida\.py/);
        expect(setup).toMatch(/install -m 640 -o root -g asterisk \/dev\/stdin \/etc\/sbc-agente\.env/);
        // O segredo NÃO aparece no startup script (que vira metadata da VM).
        const startup = setup.slice(setup.indexOf('cat > "$STARTUP" <<EOF'), setup.indexOf('\nEOF\n'));
        expect(startup).not.toMatch(/SBC_SHARED_SECRET/);
        // A URL do Cloud Run é DERIVADA, nunca digitada (regra da casa).
        expect(setup).toMatch(/gcloud run services describe consultor-fiscal-inteligente[^\n]*--format='value\(status\.url\)'/);
        expect(setup).not.toMatch(/https:\/\/[a-z0-9-]+\.run\.app/);
    });

    it('o agente: só biblioteca padrão, fica PARADO sem env (nunca disca no escuro), e o CDR decide', () => {
        expect(agente).not.toMatch(/^\s*import requests/m);
        expect(agente).toMatch(/x-sbc-secret/);
        expect(agente).toMatch(/\/api\/admin\/whatsapp\/sbc\/pedidos/);
        expect(agente).toMatch(/o agente fica parado/);
        expect(agente).toMatch(/os\.replace\(tmp, destino\)/);   // escreve e MOVE: nada pela metade no spool
        expect(agente).toMatch(/Master\.csv/);
        // Sintaxe: bash -n do setup e py_compile do agente.
        execFileSync('bash', ['-n', path.join(raiz, 'scripts/setup-sbc-whatsapp.sh')]);
        execFileSync('python3', ['-m', 'py_compile', path.join(raiz, 'scripts/sbc-agente-saida.py')]);
    });
});
