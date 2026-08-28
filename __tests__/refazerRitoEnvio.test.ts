// ============================================================================
// ♻️ REFAZER O RITO DE UM ENVIO JÁ REGISTRADO
//
// 28/08, Paulo, na VINCENZO GUERRA: *"Já criei a pasta e continua assim, o que
// eu faço?"*.
//
// O status do rito é um CARIMBO HISTÓRICO — `sharePoint` e `baixa` são
// gravados no instante do envio e nunca mais mudam. Consertar a causa depois
// (cadastrar a pasta, gerar a tarefa, corrigir o tenant do proxy) NÃO move o
// carimbo, e o mês travado seguia travado para sempre. A única saída oferecida
// era reenviar a guia ao cliente — o que DUPLICA a cobrança.
// ============================================================================
// @ts-expect-error — módulo .js puro
import { oQueRefazer, patchDoRefazer, textoDoRefazer } from '../sefaz-backend/refazer-rito-envio.js';

/** O envio da VINCENZO, como ele está gravado. */
const VINCENZO = {
    id: 'env1',
    empresaCnpj: '63027940000194',
    tipo: 'DAS',
    competencia: '2026-07',
    sharePoint: { status: 'sem-config', motivo: 'Empresa sem sharePointConfig' },
    baixa: { status: 'sem-tarefa', motivo: 'Nenhuma tarefa desta obrigação' },
};

describe('🚨 o caso VINCENZO — as duas pontas são refazíveis', () => {
    it('sem pasta e sem tarefa: as duas se tentam de novo', () => {
        const r = oQueRefazer(VINCENZO);
        expect(r.sharePoint).toBe(true);
        expect(r.baixa).toBe(true);
        expect(r.nada).toBe(false);
    });

    it('erro de gravação também se refaz — a causa pode ter sido o proxy', () => {
        const r = oQueRefazer({ sharePoint: { status: 'erro' }, baixa: { status: 'erro' } });
        expect(r.sharePoint).toBe(true);
        expect(r.baixa).toBe(true);
    });

    // ⚠️ Auditoria anterior ao rito #293 não guarda o resultado. Refazer ali é
    // justamente o que descobre o estado real — "sem registro" NÃO é "fechado".
    it('envio sem registro nenhum é refazível', () => {
        const r = oQueRefazer({ tipo: 'DAS', competencia: '2026-07' });
        expect(r.sharePoint).toBe(true);
        expect(r.baixa).toBe(true);
    });
});

describe('o que NÃO se refaz — e o motivo vai dito', () => {
    it('já arquivado não sobe o mesmo arquivo de novo', () => {
        const r = oQueRefazer({ ...VINCENZO, sharePoint: { status: 'arquivado' } });
        expect(r.sharePoint).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/já está na pasta/);
    });

    // `sem-pdf` é desfecho LEGÍTIMO (aviso de guia já paga, sem anexo). Não há
    // o que arquivar, e oferecer "refazer" ali promete o que não existe.
    it('envio sem anexo não vira promessa de arquivamento', () => {
        const r = oQueRefazer({ ...VINCENZO, sharePoint: { status: 'sem-pdf' } });
        expect(r.sharePoint).toBe(false);
        expect(r.motivos.join(' ')).toMatch(/sem anexo/);
    });

    it('baixada e ja-baixada não são refeitas', () => {
        expect(oQueRefazer({ ...VINCENZO, baixa: { status: 'baixada' } }).baixa).toBe(false);
        expect(oQueRefazer({ ...VINCENZO, baixa: { status: 'ja-baixada' } }).baixa).toBe(false);
    });

    it('rito inteiro fechado devolve `nada` com os dois motivos', () => {
        const r = oQueRefazer({ sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' } });
        expect(r.nada).toBe(true);
        expect(r.motivos).toHaveLength(2);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O ESTADO ANTERIOR NÃO SE PERDE. "Por que este envio dizia `sem-config` e
// agora diz `arquivado`?" é a pergunta que alguém faz ao conferir a
// competência — e sem histórico ela não tem resposta.
// ════════════════════════════════════════════════════════════════════════════
describe('o patch guarda o antes e o depois', () => {
    const base = { envio: VINCENZO, quem: 'paulo@sp', agoraIso: '2026-08-28T20:00:00.000Z' };

    it('carimba quem, quando, e os dois estados', () => {
        const p = patchDoRefazer({
            ...base,
            sharePoint: { status: 'arquivado', folder: '/x' },
            baixa: { status: 'baixada', tarefas: 1 },
        });
        expect(p.sharePoint.status).toBe('arquivado');
        expect(p.ritoRefeito).toHaveLength(1);
        expect(p.ritoRefeito[0].por).toBe('paulo@sp');
        expect(p.ritoRefeito[0].antes.sharePoint.status).toBe('sem-config');
        expect(p.ritoRefeito[0].depois.baixa.status).toBe('baixada');
    });

    it('só toca o que foi tentado — o outro lado fica intacto', () => {
        const p = patchDoRefazer({ ...base, sharePoint: null, baixa: { status: 'baixada' } });
        expect(p.sharePoint).toBeUndefined();
        expect(p.baixa.status).toBe('baixada');
        expect(p.ritoRefeito[0].antes.sharePoint).toBeUndefined();
    });

    it('nada tentado devolve null — não grava rodada vazia', () => {
        expect(patchDoRefazer({ ...base, sharePoint: null, baixa: null })).toBeNull();
    });

    // O histórico não vira arquivo: guarda as 10 últimas.
    it('o histórico acumula e é limitado', () => {
        const antigo = Array.from({ length: 12 }, (_, i) => ({ em: `x${i}` }));
        const p = patchDoRefazer({
            ...base, envio: { ...VINCENZO, ritoRefeito: antigo },
            sharePoint: { status: 'arquivado' }, baixa: null,
        });
        expect(p.ritoRefeito).toHaveLength(10);
        expect(p.ritoRefeito[0].em).toBe('x3');   // as antigas saem pela frente
    });
});

describe('a frase DIZ o que não deu, não só o que deu', () => {
    it('sucesso nas duas pontas', () => {
        const t = textoDoRefazer({ sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' } });
        expect(t).toMatch(/✓ cópia gravada/);
        expect(t).toMatch(/✓ obrigação baixada/);
    });

    // 🚨 "1 refeito" sobre uma rodada em que o arquivamento falhou de novo
    // seria a meia-verdade de sempre.
    it('falha continua aparecendo, com o motivo', () => {
        const t = textoDoRefazer({
            sharePoint: { status: 'erro', motivo: 'AADSTS90002' },
            baixa: { status: 'sem-tarefa', motivo: 'o cron não gerou' },
        });
        expect(t).toMatch(/✗ arquivamento ainda falha/);
        expect(t).toMatch(/AADSTS90002/);
        expect(t).toMatch(/✗ baixa ainda falha/);
    });

    // ⚠️ O PDF não fica guardado no registro do envio. Isso NÃO vira silêncio:
    // sem dizer, quem lê acha que o arquivamento foi tentado e falhou.
    it('PDF indisponível sai DITO, com a saída', () => {
        const t = textoDoRefazer({ pdfIndisponivel: 'O app não guarda o PDF de DARF.' });
        expect(t).toMatch(/PDF da guia não foi recuperado/);
        expect(t).toMatch(/reenviar a guia pelo app refaz o rito inteiro/);
    });

    it('`ja-baixada` conta como sucesso — é desfecho legítimo', () => {
        expect(textoDoRefazer({ baixa: { status: 'ja-baixada' } })).toMatch(/✓ obrigação baixada/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A CASCA CHAMA OS DONOS — arquivamento e baixa são os MESMOS do envio.
// Duas implementações do mesmo upload divergiriam, e a divergência apareceria
// como "no envio funcionou e no refazer não".
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 o refazer não reimplementa o rito', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src: string = fs.readFileSync(
        path.resolve(__dirname, '..', 'sefaz-backend/refazer-rito-store.js'), 'utf8',
    );

    it('chama os donos do envio', () => {
        expect(src).toMatch(/arquivarGuiaNoSharePoint/);
        expect(src).toMatch(/darBaixaDaObrigacao/);
        expect(src).toMatch(/from '\.\/envio-imposto\.js'/);
    });

    it('não sobe arquivo por conta própria', () => {
        expect(src).not.toMatch(/uploadProxy|\/api\/sharepoint\/upload/);
    });

    // 🚨 SEM PDF NÃO SE MARCA NADA: gravar `erro` ali apagaria o `sem-config`,
    // que é a causa REAL e a que tem conserto.
    it('sem PDF, o arquivamento não é sequer tentado', () => {
        expect(src).toMatch(/if \(pdf\) \{/);
    });
});
