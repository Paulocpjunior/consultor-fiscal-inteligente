// ============================================================================
// 🚨 O CCM SÓ-ZEROS ATRAVESSAVA O BACKEND INTEIRO COMO SE FOSSE INSCRIÇÃO
//
// 21/08 a régua nasceu em `services/empresaDadosFiscaisSanitize.ts` (#311,
// caso LAV: *"coloco uma sequência de 8 zeros"*). 29/08 a MESMA empresa voltou
// com outro sintoma — *"não está capturando as NFS-e de serviços tomados"* —
// porque a régua ficou onde nasceu: `'00000000'` é **truthy**, e todo leitor do
// backend que pergunta `if (!ccm)` recebia "sim, tem CCM" sobre um campo que
// significa "não tem".
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { soZerosComoVazio, ccmSpDaEmpresa, temCcmSp, ccmSpParaGravar } from '../sefaz-backend/ccm-sp.js';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('🚨 zero não é inscrição — é vazio', () => {
    it.each(['', '   ', '0', '00000000', '000000000', '000.000.00-0'])(
        '%p equivale a vazio', (v) => {
            expect(soZerosComoVazio(v)).toBeNull();
            expect(ccmSpDaEmpresa({ ccmSp: v })).toBe('');
            expect(temCcmSp({ ccmSp: v })).toBe(false);
        },
    );

    it('inscrição de verdade passa, inclusive com zero à esquerda', () => {
        expect(ccmSpDaEmpresa({ ccmSp: '01234567' })).toBe('01234567');
        expect(temCcmSp({ ccmSp: '01234567' })).toBe(true);
    });

    it('máscara não engana: a régua olha os dígitos', () => {
        expect(ccmSpDaEmpresa({ ccmSp: '1.234.567-8' })).toBe('12345678');
    });

    // ⚠️ Ausência e zeros são o MESMO desfecho, e isso é de propósito: os dois
    // significam "esta empresa não tem inscrição da capital".
    it('campo ausente devolve vazio, sem explodir', () => {
        expect(ccmSpDaEmpresa(undefined)).toBe('');
        expect(ccmSpDaEmpresa({})).toBe('');
        expect(ccmSpDaEmpresa({ dadosFiscais: {} })).toBe('');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 AS DUAS FORMAS. O modal Dados Fiscais grava `dadosFiscais.ccmSp`; o
// cadastro legado guarda `ccmSp` no topo. Ler uma só devolve "sem CCM" para
// metade da carteira — foi esse o segundo defeito do 0000 do
// EFD-Contribuições, que lia SÓ a forma achatada.
// ════════════════════════════════════════════════════════════════════════════
describe('as duas formas do cadastro', () => {
    it('lê a forma canônica (dadosFiscais)', () => {
        expect(ccmSpDaEmpresa({ dadosFiscais: { ccmSp: '12345678' } })).toBe('12345678');
    });

    it('lê a forma legada (topo)', () => {
        expect(ccmSpDaEmpresa({ ccmSp: '12345678' })).toBe('12345678');
    });

    it('a canônica VENCE a legada', () => {
        expect(ccmSpDaEmpresa({ dadosFiscais: { ccmSp: '11111111' }, ccmSp: '99999999' }))
            .toBe('11111111');
    });

    // ⚠️ Canônica com ZEROS não deixa a legada responder: os zeros são a
    // resposta de quem preencheu no modal — "não tem". Cair no legado faria o
    // valor apagado ressuscitar.
    it('canônica com zeros NÃO cai no legado', () => {
        expect(ccmSpDaEmpresa({ dadosFiscais: { ccmSp: '00000000' }, ccmSp: '99999999' })).toBe('');
    });
});

describe('a gravação: zeros são ordem de APAGAR', () => {
    // A lição do DARCY (26/07): virar `undefined` faz o JSON.stringify sumir
    // com a chave, o backend não recebe nada e o valor velho fica preso.
    it('zeros gravam string vazia, nunca undefined', () => {
        expect(ccmSpParaGravar('00000000')).toBe('');
    });

    it('campo nunca tocado continua undefined — é o "não mexe"', () => {
        expect(ccmSpParaGravar(undefined)).toBeUndefined();
        expect(ccmSpParaGravar(null)).toBeUndefined();
    });

    it('valor bom sai canônico (só dígitos)', () => {
        expect(ccmSpParaGravar('1.234.567-8')).toBe('12345678');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A VARREDURA — régua única é o que impede a terceira cópia.
//
// Ela lê CÓDIGO, nunca prosa (a lição do catálogo de coleções em 26/08): o
// comentário que EXPLICA a correção não pode reprovar a correção.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 nenhum leitor do backend pergunta o CCM sozinho', () => {
    const semComentario = (src: string) => src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');

    // A assinatura é a LEITURA CRUA das duas formas — o jeito exato como cada
    // um dos nove leitores estava escrito antes de 29/08.
    const LEITURA_CRUA = /(dadosFiscais\??\.)?ccmSp\s*\|\|\s*\w+\.ccmSp/;

    const LEITORES = [
        'sefaz-backend/nfse-sp-portal-orchestrator.js',
        'sefaz-backend/nfse-sp-orchestrator.js',
        'sefaz-backend/nfse-sp-routes.js',
        'sefaz-backend/nfse-nacional-dfe-routes.js',
        'sefaz-backend/empresa-status-routes.js',
        'sefaz-backend/empresas-perfil-routes.js',
        'sefaz-backend/cadastro-central.js',
        'sefaz-backend/rotina-empresa-insumo.js',
        'sefaz-backend/sped-fiscal-bloco0.js',
        'sefaz-backend/sped-contrib-bloco0.js',
        'sefaz-backend/sync-routes.js',
    ];

    it.each(LEITORES)('%s pergunta ao dono', (arquivo) => {
        const src = semComentario(ler(arquivo));
        expect(src).toMatch(/from '\.\/ccm-sp\.js'/);
        expect(src).not.toMatch(LEITURA_CRUA);
    });

    // 🚨 O `.ts` do sanitize IMPORTA o dono. O comentário da cópia antiga
    // dizia, ele mesmo: *"o backend não importa TS; mudar uma é mudar a
    // outra"* — cópia que avisa que é cópia continua sendo cópia.
    it('o sanitize do frontend importa o dono em vez de reimplementar', () => {
        const src = semComentario(ler('services/empresaDadosFiscaisSanitize.ts'));
        expect(src).toMatch(/from '\.\.\/sefaz-backend\/ccm-sp\.js'/);
        expect(src).not.toMatch(/function soZerosComoVazio/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 CCM NÃO SE CONSULTA POR IGUALDADE — ele tem DUAS formas no cadastro.
//
// É a MESMA classe do CNPJ (07/08, regra que já está escrita dentro do
// `empresa-por-cnpj.js`): `where('ccmSp','==',…)` casa com a forma legada do
// topo e IGNORA `dadosFiscais.ccmSp`, que é o que o modal grava. A importação
// do CSV do portal seguia sem `empresaId`/`empresaNome` e com a direção caindo
// no palpite pelo nome do arquivo — na tela que o colaborador usa justamente
// para trazer o movimento de serviço à mão.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 nenhuma consulta por igualdade de CCM', () => {
    const CONSULTA_POR_IGUALDADE = /where\(\s*'ccmSp'\s*,\s*'(==|in)'/;

    // ⚠️ Lê CÓDIGO, nunca PROSA (a lição do catálogo de coleções, 26/08): o
    // comentário que EXPLICA a correção cita o padrão antigo, e sem isto ele
    // reprovaria a própria correção — foi o que aconteceu na 1ª execução.
    const semComentarioAqui = (src: string) => src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');

    it.each([
        'sefaz-backend/nfse-sp-routes.js',
        'sefaz-backend/nfse-sp-orchestrator.js',
        'sefaz-backend/nfse-sp-portal-orchestrator.js',
    ])('%s varre e normaliza, nunca compara no Firestore', (arquivo) => {
        expect(semComentarioAqui(ler(arquivo))).not.toMatch(CONSULTA_POR_IGUALDADE);
    });

    // ⚠️ E a varredura pula o que já saiu do app: lápide de exclusão e
    // perdedor de merge não podem responder pelo CCM (regra de 24/07).
    it('a busca por CCM do CSV respeita a lápide', () => {
        const src = ler('sefaz-backend/nfse-sp-routes.js');
        expect(src).toMatch(/_merged_into \|\| d\._deleted/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O ARQUIVO FISCAL ERA O MAIS CARO: o 0000 declarava `00000000` no campo
// Inscrição Municipal. Campo em branco é AUSÊNCIA; oito zeros é uma AFIRMAÇÃO
// falsa de inscrição, e a diferença é a que esta casa paga caro.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 o 0000 dos dois SPED não declara inscrição que não existe', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bloco0 = () => require('../sefaz-backend/sped-fiscal-bloco0.js');

    const dadosBase = (ccm: unknown) => ({
        empresa: {
            nome: 'LAV COMERCIO DE AUTOPECAS LTDA',
            cnpj: '41048669000130',
            dadosFiscais: {
                uf: 'SP', inscricaoEstadual: '123456789012', codMunIBGE: '3550308',
                ccmSp: ccm,
            },
        },
        contador: {},
        competenciaInicio: '2026-07',
        competenciaFim: '2026-07',
        notas: [], participantes: [], itens: [], unidades: [],
        warnings: [],
    });

    const campoIm = (linha: string) => linha.split('|')[12];

    it('CCM só-zeros sai VAZIO no 0000 do EFD ICMS/IPI', () => {
        const linhas = bloco0().buildBloco0(dadosBase('00000000'));
        expect(campoIm(linhas[0])).toBe('');
    });

    it('CCM de verdade continua saindo', () => {
        const linhas = bloco0().buildBloco0(dadosBase('12345678'));
        expect(campoIm(linhas[0])).toBe('12345678');
    });

    // ⚠️ O 0000 do EFD-Contribuições tinha DOIS defeitos na mesma linha: lia
    // só a forma ACHATADA, então quem preencheu no modal saía com o campo
    // vazio. Este caso é a prova de que a leitura passou a ser do dono.
    it('a forma canônica (dadosFiscais) chega ao arquivo', () => {
        const linhas = bloco0().buildBloco0(dadosBase('87654321'));
        expect(campoIm(linhas[0])).toBe('87654321');
    });
});
