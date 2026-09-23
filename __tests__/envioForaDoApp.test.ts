// ============================================================================
// 📋 REGISTRAR UM ENVIO QUE ACONTECEU FORA DO APP (27/08)
//
// Paulo, com o print da AC MASON: *"a obrigação já foi entregue e as guias
// enviadas para o cliente — como atualizar para ficar verde?"* — e não dava. A
// etapa 5 só fecha com o rito, o fim de mês BLOQUEIA, e reenviar pelo app
// DUPLICARIA a guia no cliente.
//
// ═══ ISTO NÃO FURA "NADA SE MARCA À MÃO" ════════════════════════════════════
//
// A etapa 5 NUNCA exigiu prova de ENTREGA: mailto e WhatsApp sempre a fecharam,
// e `canalComprovaEnvio` diz desde 05/08 que eles não provam nada. O que ela
// exige é o RITO. O que entra aqui é um envio cujo rito se cumpre com o que
// existe, mais uma DECLARAÇÃO com autor, data e meio escrito — o desenho da T3
// da DCTFWeb e da reabertura do fim de mês.
// ============================================================================
// @ts-expect-error — módulo .js puro
import { conferirDeclaracao, textoDaDeclaracao, MEIOS_FORA_DO_APP, MOTIVO_MINIMO, CANAL_FORA_DO_APP } from '../sefaz-backend/envio-fora-do-app.js';
// (o `.d.ts` vizinho declara estes — ver envio-imposto-painel.d.ts)
import { canalComprovaEnvio, envioCompletoPeloRito } from '../sefaz-backend/envio-imposto-painel.js';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';

const boa = (over: any = {}) => ({
    meio: 'email-pessoal',
    comoFoi: 'Mandei do meu Outlook para a sócia, que confirmou o recebimento.',
    quando: '2026-08-20',
    quem: 'ana@spassessoriacontabil.com.br',
    hojeIso: '2026-08-27',
    ...over,
});

describe('a declaração de envio fora do app', () => {
    it('aceita a declaração completa e devolve o que vai ser gravado', () => {
        const r = conferirDeclaracao(boa());
        expect(r.ok).toBe(true);
        expect(r.declaracao).toMatchObject({
            meio: 'email-pessoal',
            quando: '2026-08-20',
            declaradoPor: 'ana@spassessoriacontabil.com.br',
        });
        expect(r.declaracao.meioLabel).toMatch(/E-mail/);
    });

    it('recusa meio fora da lista — "outro" existe, mas obriga a escrever qual', () => {
        expect(conferirDeclaracao(boa({ meio: 'pombo-correio' })).erro).toMatch(/Escolha por qual meio/);
        expect(conferirDeclaracao(boa({ meio: 'outro' })).ok).toBe(true);
        expect(MEIOS_FORA_DO_APP.some((m: any) => m.id === 'outro')).toBe(true);
    });

    // ⚠️ O TEXTO É O QUE FAZ A AUDITORIA RESPONDER daqui a três meses. Sem o
    // piso, a declaração vira um clique — e clique fácil transforma exceção em
    // rotina (a lição do ✕ do FUNRURAL).
    it('exige o texto com o piso da T3 da DCTFWeb', () => {
        expect(MOTIVO_MINIMO).toBe(15);
        expect(conferirDeclaracao(boa({ comoFoi: 'mandei' })).erro).toMatch(/mínimo 15 caracteres/);
        expect(conferirDeclaracao(boa({ comoFoi: '   ' })).erro).toMatch(/Descreva como a guia chegou/);
    });

    // ⚠️ DATA NO FUTURO fecharia o mês sobre trabalho NÃO FEITO. No passado é
    // legítima — é justamente o caso (a guia saiu antes de alguém registrar).
    it('recusa data no futuro e aceita no passado', () => {
        expect(conferirDeclaracao(boa({ quando: '2026-08-28' })).erro).toMatch(/futuro/);
        expect(conferirDeclaracao(boa({ quando: '2026-07-01' })).ok).toBe(true);
        expect(conferirDeclaracao(boa({ quando: '20/08/2026' })).erro).toMatch(/AAAA-MM-DD/);
    });

    // Declaração sem autor é declaração de ninguém — e é o autor que a torna
    // aceitável no lugar da prova do servidor.
    it('recusa declaração sem autor', () => {
        expect(conferirDeclaracao(boa({ quem: '' })).erro).toMatch(/Sessão sem usuário/);
    });

    it('a frase gravada DIZ que o app não enviou e não tem prova', () => {
        const t = textoDaDeclaracao(conferirDeclaracao(boa()).declaracao);
        expect(t).toMatch(/DECLARADO por ana@/);
        expect(t).toMatch(/20\/08\/2026/);
        expect(t).toMatch(/O app NÃO enviou esta guia e não tem prova de entrega/);
    });
});

// ============================================================================
// 🔒 O CANAL CONTINUA SEM PROVAR NADA — e isso é por construção.
// ============================================================================
describe('o canal declarado não vira prova', () => {
    it('canalComprovaEnvio recusa o fora-do-app, como recusa mailto e WhatsApp', () => {
        expect(canalComprovaEnvio(CANAL_FORA_DO_APP)).toBe(false);
        expect(canalComprovaEnvio('email-app')).toBe(false);
        expect(canalComprovaEnvio('whatsapp')).toBe(false);
        // Só o servidor prova.
        expect(canalComprovaEnvio('email-graph')).toBe(true);
        expect(canalComprovaEnvio('whatsapp-api')).toBe(true);
    });
});

// ============================================================================
// 🚨 O DONO DE "ESTE ENVIO FECHOU O RITO?" — a Rotina reimplementava
//
// Até 27/08 a etapa 5 fazia `sharePoint === 'arquivado' && baixa === 'baixada'`
// enquanto o PAINEL do rito, ao lado, já tratava `sem-pdf` e `sem-tarefa` como
// desfechos LEGÍTIMOS. O painel dava por completo, a Rotina deixava em ÂMBAR
// para sempre — e travava o fim de mês de uma empresa cujo rito fechou.
// ============================================================================
describe('quem diz se o rito fechou é o dono', () => {
    const rito = (sp: string | null, bx: string | null) => envioCompletoPeloRito({
        sharePoint: sp ? { status: sp } : {},
        baixa: bx ? { status: bx } : {},
    });

    it('arquivado + baixada é completo', () => {
        expect(rito('arquivado', 'baixada').completo).toBe(true);
    });

    // Os dois desfechos legítimos que a Rotina rejeitava.
    it('sem-pdf é desfecho LEGÍTIMO — não há o que arquivar', () => {
        expect(rito('sem-pdf', 'baixada').completo).toBe(true);
    });

    // 🚨 A ARMADILHA QUE ESTA FEATURE CRIOU, e que o teste pegou: quem entrega
    // a obrigação por fora dá baixa em Vencimentos e SÓ DEPOIS registra o
    // envio. Fazendo na ordem CERTA, o rito não achava tarefa pendente e caía
    // em `sem-tarefa` — que é PENDÊNCIA de verdade (o cron não gerou). O
    // caminho certo punia quem o seguia.
    it('ja-baixada é desfecho LEGÍTIMO — a tarefa existe e já estava concluída', () => {
        expect(rito('arquivado', 'ja-baixada').completo).toBe(true);
    });

    // ⚠️ E `sem-tarefa` CONTINUA sendo pendência: ali a tarefa não existe, e
    // isso é o cron mensal que não gerou — trabalho real, não desfecho.
    it('sem-tarefa continua sendo pendência — a tarefa não existe', () => {
        expect(rito('arquivado', 'sem-tarefa').completo).toBe(false);
    });

    it('pendência de verdade NÃO fecha', () => {
        expect(rito('sem-config', 'baixada').completo).toBe(false);
        expect(rito('erro', 'baixada').completo).toBe(false);
    });

    // ⚠️ SEM REGISTRO não é completo — é NÃO CONFERIDO, e tem ação própria.
    // Auditoria gravada antes do rito #293 existir cai exatamente aqui.
    it('sem registro de etapa é NÃO CONFERIDO, nunca completo', () => {
        const r = rito(null, 'baixada');
        expect(r.completo).toBe(false);
        expect(r.naoConferido).toBe(true);
    });
});

// ============================================================================
// E o efeito na Rotina — que é o que o Paulo vê.
// ============================================================================
describe('a etapa 5 com o envio declarado', () => {
    const CHAVE = '3526' + '07' + '1'.repeat(14) + '55' + '1'.repeat(22);
    const rodar = (envios: any[]) => montarRotinaFiscal({
        empresa: { nome: 'AC MASON', cnpj: '11111111000191' },
        competencia: '2026-07',
        documentos: [
            { chave: CHAVE, direcao: 'entrada', valorTotal: 100, temItens: true, schema: 'procNFe', status: 'autorizado' },
            { chave: CHAVE + 'x', direcao: 'saida', valorTotal: 100, temItens: true, schema: 'procNFe', status: 'autorizado' },
        ],
        apuracao: { fonte: 'lucro', totalImpostos: 1500, receita: 21811.34, receitaDeLocacao: 0 },
        tarefas: [{ obrigacao: 'DCTFWEB', status: 'concluida' }],
        envios,
    });
    const guias = (r: any) => r.etapas.find((e: any) => e.id === 'guias');

    it('o envio DECLARADO fecha a etapa — e a linha DIZ que foi declarado', () => {
        const r = rodar([{
            tipo: 'DARF', canal: CANAL_FORA_DO_APP,
            sharePoint: { status: 'sem-pdf' }, baixa: { status: 'baixada' },
            declaracao: { declaradoPor: 'ana@x', quando: '2026-08-20' },
        }]);
        expect(guias(r).status).toBe('concluida');
        expect(guias(r).resumo).toMatch(/1 DECLARADA\(S\) como enviada\(s\) por fora do app/);
        expect(guias(r).declarados).toBe(1);
        expect(r.proximoPasso).toBeNull();
    });

    // 🔒 O QUE O APP NÃO PODE AFIRMAR SAI CONTADO, nunca escondido — é ele que
    // viaja no carimbo do fim de mês (o retrato das etapas).
    it('o que não tem prova de envio é contado, e o que tem não é', () => {
        expect(guias(rodar([
            { tipo: 'DARF', canal: CANAL_FORA_DO_APP, sharePoint: { status: 'sem-pdf' }, baixa: { status: 'baixada' } },
            { tipo: 'DAS', canal: 'email-app', sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' } },
            { tipo: 'DARE', canal: 'email-graph', sharePoint: { status: 'arquivado' }, baixa: { status: 'baixada' } },
        ])).semProva).toBe(2);
    });

    // O sem-pdf que a Rotina rejeitava — envio SEM anexo (aviso de guia já
    // paga) é desfecho legítimo desde sempre no painel do rito.
    it('envio sem anexo deixa de travar o mês para sempre', () => {
        expect(guias(rodar([
            { tipo: 'DAS', canal: 'email-graph', sharePoint: { status: 'sem-pdf' }, baixa: { status: 'baixada' } },
        ])).status).toBe('concluida');
    });

    it('sem envio nenhum, nada muda no comportamento antigo', () => {
        expect(guias(rodar([])).status).toBe('pendente');
    });
});
