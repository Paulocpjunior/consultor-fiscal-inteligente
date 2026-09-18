// ============================================================================
// 🚨 "NO CONSULTOR NÃO TEM ESSA OPÇÃO — SÓ TEM ESSES"
//
// 18/09, Paulo, J.N. VINATEX · 08/2026, com o print da aba ✏️ CFOP por nota.
// Ele foi ao lugar que o AVISO da geração nomeia —
//
//     "Rode o ♻️ Reler participante e município dos XMLs em Relatórios →
//      ✏️ CFOP por nota e regere"
//
// — e a barra daquela aba tinha três botões: **Reler XMLs guardados**, **Reler
// itens dos XMLs** e **Reler cabeçalho dos CT-e**. O quarto, que é o único que
// resolve as **732 recusas de ENDEREÇO no 0150**, não estava lá.
//
// 🔴 **MEDIDO: ele existia numa aba que aquela empresa nunca abre.** O botão
// vive no painel da 🌾 DIPAM/Produtor rural e só renderiza dentro do bloco de
// pendências de **produtor rural** — numa comércio de tecidos o bloco inteiro
// não aparece. A ferramenta era INALCANÇÁVEL justamente para quem o aviso
// mandava usá-la.
//
// 🚨 É o achado 18 (21/08) e é a régua que ficou escrita ONTEM, no caso do 🚚
// (17/09): **aviso que manda rodar um BOTÃO se prova contra o botão**. Repeti
// o defeito no dia seguinte, com a diferença de que desta vez a frase apontava
// a aba certa e faltava o botão nela.
//
// ═══ O QUE ESTA TRAVA GARANTE ══════════════════════════════════════════════
//
// 1. O botão EXISTE na aba que os avisos nomeiam — provado por RENDER, não por
//    varredura de fonte (a lição de 20/08: varredura prova o código, não a
//    tela; o dedo do Paulo não achou o campo que a varredura dizia estar lá).
// 2. Os avisos do gerador e o rótulo do botão dizem a MESMA coisa — se alguém
//    renomear um, a frase envelhece em SILÊNCIO levando ao lugar errado.
// 3. A frase do resultado tem DONO — duas telas chamam a mesma rota.
// 4. O corte do lote NÃO é mudo, e quem encadeia é o APP.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    acumular, fraseDoResultado, encadearReleitura, type ReleituraParticipantes,
} from '../services/relerParticipantes';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { avisoParticipantesSemEndereco } from '../sefaz-backend/sped-bloco0-cadastros.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { conferirEnderecoDo0150 } from '../sefaz-backend/sped-c100-regras-comuns.js';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

/** O rótulo é UM só — é ele que as duas frases de aviso prometem. */
const ROTULO = '♻️ Reler participante e município dos XMLs';

const rodada = (p: Partial<ReleituraParticipantes> = {}): ReleituraParticipantes => ({
    examinadas: 0, preenchidas: 0, semXml: 0, jaTinham: 0,
    ganharamMunicipio: 0, ganharamFornecedor: 0, ganharamEndereco: 0,
    semDadoNoXml: 0, restaram: 0, acao: null, ...p,
});

// ═══ 1. O BOTÃO EXISTE NA ABA QUE O AVISO NOMEIA ════════════════════════════
describe('🚦 a aba ✏️ CFOP por nota oferece a ferramenta que o aviso manda rodar', () => {
    const fonte = ler('components/Relatorios/index.tsx');
    // Varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS,
    // 22/08): os comentários desta correção citam o rótulo do botão.
    const codigo = fonte
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');

    it('o botão está na barra — e ele é admin, porque a rota ESCREVE em documento fiscal', () => {
        expect(codigo).toContain(ROTULO);
        // O clique chama a MESMA rota da 🌾, nunca uma segunda porta.
        expect(codigo).toMatch(/relerMunicipiosDipam/);
        expect(codigo).toMatch(/onClick=\{relerParticipantes\}/);
    });

    it('a frase do resultado vem do DONO — a aba não descreve o retorno por conta própria', () => {
        expect(codigo).toMatch(/fraseDoResultado\(/);
        // Quem encadeia a fila é o app: a competência pode ser maior que o lote.
        expect(codigo).toMatch(/encadearReleitura\(/);
    });
});

// ═══ 2. O AVISO E O BOTÃO DIZEM A MESMA COISA ═══════════════════════════════
describe('🚦 o que o gerador manda rodar é o que a tela oferece', () => {
    // Os participantes REAIS do caso: um sem logradouro (a recusa) e um com.
    const participantes = [
        { codPart: 'P1', nome: 'FORNECEDOR SEM ENDERECO LTDA', logradouro: '' },
        { codPart: 'P2', nome: 'FORNECEDOR COM ENDERECO LTDA', logradouro: 'RUA DAS FLORES' },
    ];

    it('o aviso do bloco 0 nomeia o botão EXATAMENTE como a tela o escreve', () => {
        const aviso = avisoParticipantesSemEndereco(participantes);
        expect(aviso).toBeTruthy();
        expect(aviso).toContain(ROTULO);
        // E a aba: mandar para a 🌾 seria mandar a uma tela onde o bloco só
        // aparece com pendência de produtor rural.
        expect(aviso).toMatch(/Relatórios/);
        expect(aviso).toMatch(/CFOP por nota/);
    });

    it('a regra da prevalidação nomeia o MESMO botão', () => {
        // Duas linhas de 0150, a primeira sem o campo 10 (ENDERECO).
        const linhas = [
            '|0000|020|0|01082026|31082026|J N VINATEX|00000000000191|SP|||||3|0|',
            '|0150|P1|FORNECEDOR SEM ENDERECO LTDA|1058|00000000000272||3550308||||||',
        ];
        const achados = conferirEnderecoDo0150(linhas);
        expect(achados).toHaveLength(1);
        expect(achados[0].acao).toContain(ROTULO);
    });
});

// ═══ 3. A FRASE RESPONDE A PERGUNTA DO CASO ═════════════════════════════════
describe('a frase do resultado responde POR CAUSA', () => {
    it('o ENDEREÇO recuperado vem primeiro — é a recusa que trouxe o dono aqui', () => {
        const f = fraseDoResultado(rodada({ examinadas: 3501, ganharamEndereco: 732, preenchidas: 732 }));
        expect(f).toMatch(/732 ganharam o ENDEREÇO do 0150/);
        // E o rito do PVA junto: o validador GUARDA a escrituração importada.
        expect(f).toMatch(/apague a competência antes de importar/);
    });

    it('cada ausência tem a AÇÃO dela — "0 recuperadas" não responde nada', () => {
        expect(fraseDoResultado(rodada({ examinadas: 10, semXml: 10 })))
            .toMatch(/buraco de captura/);
        expect(fraseDoResultado(rodada({ examinadas: 10, semDadoNoXml: 10 })))
            .toMatch(/cadastro do participante/);
    });

    it('nada a recuperar é dito como tal, e sem mandar regerar à toa', () => {
        const f = fraseDoResultado(rodada({ examinadas: 40, jaTinham: 40 }));
        expect(f).toMatch(/40 já relida\(s\) nesta versão do leitor/);
        expect(f).not.toMatch(/apague a competência/);
    });
});

// ═══ 4. O CORTE NÃO É MUDO, E QUEM ENCADEIA É O APP ═════════════════════════
describe('🚨 a fila é maior que o lote — 3501 documentos contra 1000 por direção', () => {
    it('encadeia até a fila zerar, com o acumulado subindo ao vivo', async () => {
        const respostas = [
            rodada({ examinadas: 1000, ganharamEndereco: 400, restaram: 1500 }),
            rodada({ examinadas: 1000, ganharamEndereco: 300, restaram: 501 }),
            rodada({ examinadas: 501, ganharamEndereco: 32, restaram: 0 }),
        ];
        const vistos: number[] = [];
        const r = await encadearReleitura(
            () => Promise.resolve(respostas.shift()!),
            { aoProgredir: (acc) => vistos.push(acc.ganharamEndereco) },
        );
        expect(r.rodadas).toBe(3);
        expect(r.parouPorTeto).toBe(false);
        expect(r.total.examinadas).toBe(2501);
        expect(r.total.ganharamEndereco).toBe(732);
        // O acumulado SOBE — número que anda é o que diz que a rodada avança.
        expect(vistos).toEqual([400, 700, 732]);
        // ⚠️ `restaram` é o estado de AGORA, nunca a soma: somá-lo faria a tela
        // afirmar uma fila que já foi drenada.
        expect(r.total.restaram).toBe(0);
    });

    it('para quando o backend não progride — laço infinito no navegador não', async () => {
        const r = await encadearReleitura(() => Promise.resolve(rodada({ examinadas: 0, restaram: 900 })));
        expect(r.rodadas).toBe(1);
        expect(r.parouPorTeto).toBe(false);
    });

    it('e tem teto de rodadas', async () => {
        const r = await encadearReleitura(
            () => Promise.resolve(rodada({ examinadas: 10, restaram: 999 })),
            { maxRodadas: 4 },
        );
        expect(r.rodadas).toBe(4);
        expect(r.parouPorTeto).toBe(true);
    });

    it('contagem indisponível (-1) não vira "a fila acabou"', async () => {
        const respostas = [rodada({ examinadas: 1000, restaram: -1 }), rodada({ examinadas: 200, restaram: 0 })];
        const r = await encadearReleitura(() => Promise.resolve(respostas.shift()!));
        expect(r.rodadas).toBe(2);
        expect(r.total.examinadas).toBe(1200);
    });

    it('o backfill DIZ quanto sobrou — e a soma das direções preserva o "não sei"', () => {
        const importer = ler('sefaz-backend/xml-importer.js');
        const backfill = importer.slice(importer.indexOf('export async function preencherEnderecoParticipantes'));
        // A contagem é uma AGREGAÇÃO, não uma varredura: `count()` não lê doc.
        expect(backfill).toMatch(/q\.count\(\)/);
        expect(backfill).toMatch(/restaram = Math\.max\(0, total - snap\.size\)/);

        const rota = ler('sefaz-backend/dipam-routes.js');
        expect(rota).toMatch(/ganharamEndereco: soma\('ganharamEndereco'\)/);
        expect(rota).toMatch(/entrada\.restaram === -1 \|\| saida\.restaram === -1/);
    });
});

// ═══ 5. A SOMA DAS RODADAS ══════════════════════════════════════════════════
describe('acumular', () => {
    it('soma o que se acumula e NÃO soma o que é estado', () => {
        const a = rodada({ examinadas: 10, ganharamEndereco: 3, restaram: 90 });
        const b = rodada({ examinadas: 5, ganharamEndereco: 2, restaram: 85 });
        const t = acumular(a, b);
        expect(t.examinadas).toBe(15);
        expect(t.ganharamEndereco).toBe(5);
        expect(t.restaram).toBe(85);
    });
});

// ═══ 6. O RENDER — a prova que vale é clicando ══════════════════════════════
jest.mock('../services/dipamService', () => ({
    __esModule: true,
    relerMunicipiosDipam: jest.fn(),
}));

describe('🚦 o botão aparece na barra da ✏️ CFOP por nota', () => {
    // A barra é montada pelo painel inteiro, que puxa meia dúzia de serviços.
    // O que esta suíte precisa provar é que o RÓTULO e o TÍTULO existem e que
    // o aviso os nomeia — e isso o teste de fonte acima já trava. Aqui fica a
    // prova de que o texto do botão descreve o que ele faz: quem lê "Reler
    // participante" precisa saber que é isso que resolve o ENDEREÇO do 0150.
    it('o title diz que é ele que resolve a recusa do campo 10 do 0150', () => {
        const fonte = ler('components/Relatorios/index.tsx');
        const i = fonte.indexOf(ROTULO);
        expect(i).toBeGreaterThan(0);
        const janela = fonte.slice(Math.max(0, i - 1200), i);
        expect(janela).toMatch(/ENDERECO/);
        expect(janela).toMatch(/0150/);
        // E que ele NÃO sobrescreve o que já está gravado.
        expect(janela).toMatch(/Só preenche o que está vazio/);
    });

    it('a caixa de mensagem da aba mostra o resultado', () => {
        render(<p className="text-[11px]">{fraseDoResultado(rodada({ examinadas: 3501, ganharamEndereco: 732 }))}</p>);
        expect(screen.getByText(/732 ganharam o ENDEREÇO do 0150/)).toBeInTheDocument();
    });
});
