// ============================================================================
// 🚨 O CONTABILISTA DO 0100 SAÍA INVENTADO — 'CONTADOR SP CONTABIL' e o CRC
// '1SP123456/O-7'
//
// 29/08. O cruzamento "registros que o gerador EMITE × registros que a
// prevalidação COBRE" no EFD-**Contribuições** deixou cinco descobertos, e o
// 0100 era um deles. Fui ler o Guia 1.35 para escrever a regra — e ele
// entregou outra coisa, maior:
//
// 📖 **NOME (campo 02), CPF (03) e CRC (04) são Obrig. `S`**, e o campo 03 traz
// *"Validação: será conferido o dígito verificador (DV) do CPF informado"*.
//
// 🔴 E os DOIS geradores tinham DEFAULT INVENTADO em dois deles. Sem a env, o
// arquivo declarava ao fisco **um contabilista que não existe, com um CRC que
// não é de ninguém** — e o **PVA aceita**, porque a forma está certa. É a
// família do `1405`, do `PARTSEM` e do `5352`: o erro que só aparece na
// fiscalização. Campo vazio é PIOR de ler e MELHOR de ter: vazio o PVA acusa.
//
// ⚠️ **E O GUIA ME IMPEDIU DE PORTAR A REGRA ERRADA.** A hipótese era a "meia
// trava" de sempre: a R13 (EMAIL/COD_MUN obrigatórios, recusa da PWR 19/08)
// existe só no EFD ICMS/IPI, e o 0100 é byte a byte IDÊNTICO nas duas famílias.
// Só que **no EFD-Contribuições esses dois campos são Obrig. `N`** — portar
// teria produzido alarme falso sobre arquivo CORRETO. Mesmo registro, famílias
// diferentes, obrigatoriedade diferente: é o 1010 (17/08) e o 0500 (24/08) na
// direção da regra, e não do leiaute.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts (nenhum TS de produção o importa)
import { conferirContador, getContadorPadrao } from '../sefaz-backend/contador-escrituracao.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirContador0100 } from '../sefaz-backend/sped-c100-regras-comuns.js';

const L = (...campos: (string | number)[]) => `|${campos.join('|')}|`;
// |0100|NOME|CPF|CRC|CNPJ|CEP|END|NUM|COMPL|BAIRRO|FONE|FAX|EMAIL|COD_MUN|
const reg0100 = (nome = 'PAULO', cpf = '39053344705', crc = '1SP238285/O-5') =>
    L('0100', nome, cpf, crc, '', '', '', '', '', '', '', '', 'a@b.com', '3550308');

describe('🚨 o gerador não inventa mais contabilista', () => {
    const ler = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');
    // Varredura lê CÓDIGO, nunca PROSA — o comentário que EXPLICA a correção
    // cita o valor antigo e reprovaria a correção (a mordida do ISS, 22/08).
    const semComentario = (s: string) => s
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    for (const arq of ['sefaz-backend/sped-fiscal-bloco0.js', 'sefaz-backend/sped-contrib-bloco0.js']) {
        it(`${arq} não carimba nome nem CRC fabricados`, () => {
            const src = semComentario(ler(arq));
            expect(src).not.toMatch(/CONTADOR SP CONTABIL/);
            expect(src).not.toMatch(/1SP123456/);
        });
    }

    // 🚨 A trava é da CLASSE, não dos dois valores: qualquer default no NOME ou
    // no CRC do 0100 é dado fabricado num campo que a fiscalização lê.
    it('nenhum default sobra nos campos do contabilista', () => {
        for (const arq of ['sefaz-backend/sped-fiscal-bloco0.js', 'sefaz-backend/sped-contrib-bloco0.js']) {
            const src = semComentario(ler(arq));
            expect(src).toMatch(/c\.nome \|\| ''/);
            expect(src).toMatch(/c\.crc \|\| ''/);
        }
    });
});

describe('📖 conferirContador — a falta vai DITA, com a env', () => {
    it('contabilista completo não gera aviso', () => {
        const c = conferirContador({ nome: 'PAULO', cpf: '390.533.447-05', crc: '1SP238285/O-5' });
        expect(c.completo).toBe(true);
        expect(c.aviso).toBeNull();
    });

    it('faltando, nomeia a env que resolve — não a chave do banco', () => {
        const c = conferirContador({ nome: '', cpf: '', crc: '' });
        expect(c.completo).toBe(false);
        expect(c.faltando).toEqual(['CONTADOR_NOME', 'CONTADOR_CPF', 'CONTADOR_CRC']);
        expect(String(c.aviso)).toMatch(/o app não os inventa mais/);
    });

    // 📖 "Validação: será conferido o dígito verificador (DV) do CPF informado"
    it('CPF que não fecha no DV é acusado, com a citação', () => {
        const c = conferirContador({ nome: 'X', cpf: '11111111111', crc: 'Y' });
        expect(c.cpfInvalido).toBe(true);
        expect(String(c.aviso)).toMatch(/dígito verificador/);
    });

    // ⚠️ O DV tem DONO (`documento-dv.js`) — conferir o dígito aqui seria a
    // segunda cópia da mesma régua.
    it('CPF válido com máscara passa', () => {
        expect(conferirContador({ nome: 'X', cpf: '390.533.447-05', crc: 'Y' }).cpfInvalido).toBe(false);
    });

    it('entrada nula não explode', () => {
        expect(conferirContador(null).completo).toBe(false);
    });

    // ⚠️ EMAIL e COD_MUN NÃO entram aqui: no EFD-Contribuições são Obrig. N, e
    // cobrá-los produziria alarme falso sobre arquivo correto.
    it('EMAIL e COD_MUN não são cobrados por esta conferência', () => {
        const c = conferirContador({ nome: 'X', cpf: '390.533.447-05', crc: 'Y', email: '', codMunIBGE: '' });
        expect(c.completo).toBe(true);
    });

    // Os padrões do escritório vieram do 0100 ACEITO (HS PROJETOS 05/2026) e
    // continuam — o que saiu foi o nome/CRC fabricados.
    it('o padrão do escritório continua preenchendo e-mail e município', () => {
        const c = getContadorPadrao();
        expect(c.email).toBeTruthy();
        expect(c.codMunIBGE).toBe('3550308');
    });
});

describe('🚦 a regra do 0100 roda nas DUAS famílias', () => {
    it('0100 completo não acusa nada', () => {
        expect(conferirContador0100([reg0100()])).toEqual([]);
    });

    it('sem NOME, CPF e CRC acusa os três de uma vez', () => {
        const e = conferirContador0100([reg0100('', '', '')]);
        expect(e).toHaveLength(1);
        expect(e[0].campo).toBe('2 - NOME, 3 - CPF, 4 - CRC');
        expect(e[0].fonte).toMatch(/Obrigatórios \(S\)/);
    });

    it('CPF com DV errado é acusado com a validação literal do Guia', () => {
        const e = conferirContador0100([reg0100('PAULO', '11111111111')]);
        expect(e).toHaveLength(1);
        expect(e[0].campo).toBe('3 - CPF');
        expect(String(e[0].fonte)).toMatch(/dígito verificador \(DV\) do CPF informado/);
    });

    // ⚠️ Campo faltando VENCE o DV: dizer "CPF inválido" sobre um campo vazio
    // manda procurar erro de digitação num campo que ninguém preencheu.
    it('campo vazio não vira "CPF inválido"', () => {
        const e = conferirContador0100([reg0100('PAULO', '')]);
        expect(e[0].campo).toBe('3 - CPF');
        expect(String(e[0].mensagem)).toMatch(/está sem/);
    });

    // 🚨 A PROVA QUE VALE: a regra NASCE VERDE sobre a linha REAL de produção.
    // O 0100 do EFD-Contribuições da PWR (citado no mata-burro de 20/08) traz
    // nome, CPF e CRC de verdade — ou seja, as envs ESTÃO preenchidas hoje, e o
    // default inventado não está produzindo arquivo torto. Isto é PREVENÇÃO,
    // não defeito vivo: impacto se mede, não se deduz do código (a lição do
    // ADN, 22/08).
    it('nasce VERDE sobre o 0100 REAL de produção', () => {
        const real = L('0100', 'Paulo Cesar Pereira Junior', '26819016859', '1SP238285/O-5',
            '', '', '', '', '', '', '', '', 'spcontabil@spassessoriacontabil.com.br', '3550308');
        expect(conferirContador0100([real])).toEqual([]);
    });

    it('arquivo sem 0100 fica MUDO', () => {
        expect(conferirContador0100([L('0000', '020')])).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A REGRA ENTRA NAS DUAS PREVALIDAÇÕES — a "meia trava" ao contrário.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 as duas famílias chamam a régua comum', () => {
    const ler = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');
    const semComentario = (s: string) => s
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    for (const arq of ['sefaz-backend/sped-prevalidacao.js', 'sefaz-backend/sped-contrib-campos.js']) {
        it(`${arq} roda o conferirContador0100`, () => {
            expect(semComentario(ler(arq))).toMatch(/conferirContador0100\(/);
        });
    }

    // 🚨 E os DOIS orquestradores conferem ANTES de o 0100 virar linha — o
    // aviso na geração é o que a pessoa lê; a prevalidação é a rede.
    for (const arq of ['sefaz-backend/sped-fiscal-orchestrator.js', 'sefaz-backend/sped-contrib-orchestrator.js']) {
        it(`${arq} avisa na geração`, () => {
            const src = semComentario(ler(arq));
            expect(src).toMatch(/conferirContador\(contadorDoArquivo\)/);
            expect(src).toMatch(/warnings\.push\(conf\.aviso\)/);
        });
    }
});
