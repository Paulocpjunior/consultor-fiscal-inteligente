// ============================================================================
// 🚨 "QUAL É A COMPETÊNCIA?" TINHA DUAS RESPOSTAS — e a divergência cegava a
// trava que impede COBRAR O CLIENTE DUAS VEZES
//
// Havia duas funções `normalizarCompetencia`, e elas divergiam nos DOIS
// sentidos: a do `envio-imposto` aceitava `AAAAMM` e recusava `AAAA-MM-DD`; a
// do `ipi-varredura` fazia o contrário. Cada uma devolvia **null** para a forma
// que a outra entendia — e null aqui não falha, some.
//
// 🔴 E o efeito mais caro estava na CONSULTA: a gravação de
// `impostos_enviados` normaliza a competência, e a trava do débito repetido
// perguntava pelo TEXTO CRU da requisição. Pedindo `07/2026`, ela achava ZERO
// envios anteriores, respondia "nunca foi enviado" e liberava a MESMA cobrança
// — que é exatamente o que ela existe para impedir (caso HYPE, 17/08).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// O módulo ganhou `.d.ts` em 26/08 (o fim de mês precisou dele no FRONTEND).
import {
    normalizarCompetencia, competenciaTarefa, formasDaCompetencia,
} from '../sefaz-backend/competencia.js';

const RAIZ = join(__dirname, '..');

describe('🚨 a competência tem UM dono, e ele conhece as quatro formas', () => {
    it('as quatro formas caem na mesma resposta', () => {
        for (const forma of ['2026-07', '2026-07-15', '07/2026', '202607']) {
            expect({ forma, iso: normalizarCompetencia(forma) })
                .toEqual({ forma, iso: '2026-07' });
        }
    });

    // As duas divergências reais: cada cópia recusava a forma da outra.
    it('AAAA-MM-DD (a ficha) e AAAAMM (colagem) valem nas DUAS pontas', () => {
        expect(normalizarCompetencia('2026-07-31')).toBe('2026-07');
        expect(normalizarCompetencia('202607')).toBe('2026-07');
    });

    it('o que não é reconhecível devolve null — competência não se chuta', () => {
        for (const lixo of ['', null, undefined, 'julho/2026', '2026', '13/2026', '2026-13']) {
            expect({ lixo, iso: normalizarCompetencia(lixo) }).toEqual({ lixo, iso: null });
        }
    });

    it('a forma da coleção de tarefas continua sendo MM/AAAA', () => {
        expect(competenciaTarefa('2026-07')).toBe('07/2026');
        expect(competenciaTarefa('nada')).toBeNull();
    });
});

describe('🚨 consulta por competência cobre as formas GRAVADAS', () => {
    it('as QUATRO formas entram, sem repetir — inclusive a DATA do 1º dia', () => {
        // 03/09: a ficha grava a competência como DATA (`AAAA-MM-DD`), e a
        // consulta por `in` não enumera 31 dias — entra o 1º, que é a forma
        // que o app grava quando "a competência" é uma data. Outro dia só é
        // achado quando ele mesmo é a forma crua pedida.
        expect(formasDaCompetencia('07/2026').sort())
            .toEqual(['07/2026', '2026-07', '2026-07-01', '202607']);
    });

    // Envio antigo, anterior à normalização, guarda o texto como veio —
    // perder ESSE registro é a mesma conta dobrada, um mês mais tarde.
    it('a forma CRUA entra quando é diferente das derivadas', () => {
        expect(formasDaCompetencia('2026-07-15')).toContain('2026-07-15');
    });

    it('competência ilegível devolve lista VAZIA — quem chama tem de parar', () => {
        expect(formasDaCompetencia('julho')).toEqual([]);
    });
});

describe('🚨 a trava do débito repetido consulta pelo dono', () => {
    const fonte = readFileSync(join(RAIZ, 'sefaz-backend/envio-imposto-routes.js'), 'utf8');

    it('a consulta usa as formas, não a igualdade com o texto cru', () => {
        expect(fonte).toContain('formasDaCompetencia');
        expect(fonte).not.toMatch(/\.where\('competencia',\s*'==',\s*competencia\)/);
    });

    // Indeterminado PARA — é guia indo ao cliente. Liberar aqui seria liberar
    // a segunda cobrança justamente quando não dá para conferir.
    it('competência ilegível RECUSA, nunca vira "nunca foi enviado"', () => {
        expect(fonte).toContain('não reconhecida');
        expect(fonte).toContain('duplicidade');
    });
});

describe('🚨 ninguém reescreve a normalização da competência', () => {
    // A assinatura é a conversão MM/AAAA → AAAA-MM feita na mão.
    const DONO = 'sefaz-backend/competencia.js';
    const PERMITIDO: Record<string, string> = {
        // Valida na PORTA e LANÇA de propósito: outra pergunta, outro contrato.
        'sefaz-backend/catalogo-obrigacoes.js': 'partesDaCompetencia valida o formato do catálogo e lança',
    };

    it('a régua mora num lugar só', () => {
        const { readdirSync, statSync } = require('fs');
        const varrer = (dir: string, out: string[] = []): string[] => {
            for (const nome of readdirSync(dir)) {
                if (['node_modules', 'dist'].includes(nome) || nome.startsWith('.')) continue;
                const p = join(dir, nome);
                if (statSync(p).isDirectory()) varrer(p, out);
                else if (nome.endsWith('.js')) out.push(p);
            }
            return out;
        };
        const copias: string[] = [];
        const arquivos = varrer(join(RAIZ, 'sefaz-backend'));
        // Varredura vazia é trava falsa: hoje são ~400 módulos, o piso é folga.
        expect(arquivos.length).toBeGreaterThan(200);
        for (const arquivo of arquivos) {
            const rel = arquivo.replace(`${RAIZ}/`, '');
            if (rel === DONO || PERMITIDO[rel]) continue;
            if (/export function normalizarCompetencia/.test(readFileSync(arquivo, 'utf8'))) {
                copias.push(rel);
            }
        }
        if (copias.length) {
            throw new Error(
                '\n\n🚧 SEGUNDA CÓPIA DA NORMALIZAÇÃO DE COMPETÊNCIA\n\n'
                + copias.map((x) => `  · ${x}`).join('\n')
                + `\n\nAs duas que existiam divergiam nos DOIS sentidos e cada uma devolvia null\n`
                + 'para a forma que a outra entendia. Importe de `competencia.js`.\n',
            );
        }
    });
});
