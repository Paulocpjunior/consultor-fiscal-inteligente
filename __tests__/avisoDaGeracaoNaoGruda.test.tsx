// ============================================================================
// 🚨 AVISO GRUDADO É AVISO QUE NINGUÉM LÊ — a caixa de avisos do SPED
//
// 18/09, Paulo — PWR INDUSTRIA METALURGICA · 08/2026, pela TERCEIRA vez com a
// MESMA pergunta: *"PWR - ainda continua com a diferença do valor da
// RECEITA"*, com o `17.775,31` do M210 do PVA sublinhado em vermelho e uma
// seta apontando o `18.355,90` da coluna Contábil do Resumo por CFOP do CFI.
//
// ═══ MEDIDO ANTES DE MEXER — e o arquivo dela estava CERTO ══════════════════
//
// Rodando o gerador com os números dela, a linha que sai é
//
//     |M210|51|17775,31|15186,83|0,00|0,00|15186,83|0,6500|||98,71|…
//
// ou seja **exatamente** o print do PVA — inclusive a BASE 15.186,83, que é o
// número da Memória de Apuração e a prova de que a correção do frete (16/09)
// chegou à produção. Não havia defeito de número a procurar.
//
// 🔴 **O QUE FALHOU FOI A CAIXA.** A geração dela empilha CINCO avisos, e o
// quarto responde a pergunta inteira — *"Receita do M210/M610 × Memória de
// Apuração: os DOIS estão certos e medem coisas diferentes"*. Só que a tela
// fazia `warnings.join(' — ')` e entregava ~2.500 caracteres num `<p>` de
// fonte 12px, **com o mesmo travessão separando os avisos e separando as
// frases dentro de cada um**. Não há como achar o quarto ali.
//
// É a classe da manhã do mesmo dia (o corte do `resumoPrevalidacao` deixando
// de fora a única recusa que impedia o PVA de importar o arquivo) pela outra
// ponta: lá o aviso certo caía fora da lista, aqui ele está na lista e ninguém
// o enxerga. Nas duas o conteúdo estava certo e o CAMINHO até o olho de quem
// lê é que estava quebrado.
//
// 📌 REGRA QUE FICA: **aviso que o app empilha se entrega em LISTA, um por
// linha.** Quando são vários, juntar com um separador que as próprias frases
// usam por dentro é o mesmo que não entregar — e o sintoma não é erro nenhum:
// é o dono voltando com a mesma pergunta que o app já respondeu.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MensagemBlock from '../components/SpedFiscal/MensagemBlock';
import { buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── A PWR de 08/2026, reconstruída dos prints ──────────────────────────────
// Σ vProd 17.775,31 · desconto 169,41 · ICMS 3.169,07 · frete 750,00 ·
// vNF 18.355,90 (o contábil que ele aponta) · base 15.186,83.
const item = (nItem: number, vProd: number, vICMS: number, vDesc: number, vFrete: number) => ({
    nItem, cProd: `P${nItem}`, xProd: 'PECA METALURGICA', qCom: 1, uCom: 'UN',
    vProd, vICMS, vDesc, vFrete, vBC: vProd - vDesc, cfop: '5101', cst: '00', NCM: '73089090',
});
const notaPwr = {
    chave: '35260800000000000191550010000000081369620739', numero: '8', serie: '1',
    direcao: 'saida', status: 'autorizado', dhEmi: '2026-08-14T10:00:00-03:00',
    tpNF: '1', cnpjEmit: '00000000000191', cnpjDest: '00000000000272',
    itens: [item(1, 10000.00, 1800.00, 100.00, 400.00), item(2, 7775.31, 1369.07, 69.41, 350.00)],
    totais: { vProd: 17775.31, vDesc: 169.41, vICMS: 3169.07, vFrete: 750.00, vNF: 18355.90 },
};

/** Os avisos REAIS da competência dela — nunca frases escritas à mão aqui. */
function avisosDaPwr(): string[] {
    const warnings: string[] = [];
    buildBlocoM({
        empresa: { cnpj: '00000000000191', nome: 'PWR', uf: 'SP' },
        competencia: '2026-08', competenciaFim: '2026-08',
        regimeApuracao: '2', notas: [notaPwr], warnings,
    } as never);
    return warnings;
}

describe('📐 a competência da PWR — os avisos que o gerador de fato produz', () => {
    it('o gerador responde a pergunta dele: o M210 é o do print, e a conciliação está lá', () => {
        const avisos = avisosDaPwr();
        const conciliacao = avisos.find((a) => /Receita do M210\/M610 × Memória/.test(a));
        expect(conciliacao).toBeDefined();
        // A conta fecha na própria frase — os dois números e a diferença.
        expect(conciliacao).toMatch(/17775\.31/);
        expect(conciliacao).toMatch(/18355\.90/);
        expect(conciliacao).toMatch(/580\.59/);
        expect(conciliacao).toMatch(/confira a base, não a receita/);
    });

    // 🚨 A FRASE QUE FALTAVA EM 17/09 — e por isso ele voltou em 18/09: sem
    // dizer que NÃO EXISTE caminho, "os dois estão certos" se lê como "ainda
    // vamos ajustar", e o dono espera o número mudar no mês seguinte.
    it('diz que o número dele não sai daquele campo — e dá o do F100, medido', () => {
        const conciliacao = avisosDaPwr().find((a) => /Receita do M210\/M610 × Memória/.test(a))!;
        // O caminho fechado, com a validação que ele quebraria.
        expect(conciliacao).toMatch(/Σ VL_ITEM = VL_MERC do C100/);
        expect(conciliacao).toMatch(/REGERA o bloco M/);
        // O caminho ABERTO, com o número que ele de fato produz — 17.775,31 +
        // 750,00 de frete, sem abater o desconto. Prometer "dá pra fazer" sem
        // o número faria ele pedir uma mudança esperando 18.355,90.
        expect(conciliacao).toMatch(/F100/);
        expect(conciliacao).toMatch(/18525\.31/);
        expect(conciliacao).toMatch(/não o valor da Memória/);
    });

    // 🚨 A PROVA QUE VALE É DE RENDER, lendo o DOM (a régua de 20/08: varredura
    // de fonte prova o CÓDIGO, não a TELA).
    it('cada aviso vira um ITEM na tela — nunca um parágrafo só', () => {
        const avisos = avisosDaPwr();
        const { container } = render(
            <MensagemBlock mensagem={{ tipo: 'warning', titulo: 'SPED Contribuições gerado com avisos', detalhes: avisos }} />,
        );
        expect(container.querySelectorAll('li')).toHaveLength(avisos.length);
        expect(avisos.length).toBeGreaterThan(1);
    });

    // O que fazia o dono voltar: achar ESTA frase no muro de 2.500 caracteres.
    it('a conciliação é um bloco PRÓPRIO, com o rótulo à vista no começo da linha', () => {
        render(
            <MensagemBlock mensagem={{ tipo: 'warning', titulo: 'SPED Contribuições gerado com avisos', detalhes: avisosDaPwr() }} />,
        );
        const li = screen.getByText(/Receita do M210\/M610 × Memória de Apuração/).closest('li');
        expect(li).not.toBeNull();
        // E ela cabe sozinha no item: o texto do <li> é o aviso, não o muro.
        expect(li!.textContent!.replace(/^•\s*/, '')).toMatch(/^Receita do M210\/M610/);
        expect(li!.textContent).not.toMatch(/Frete na base do PIS\/COFINS/);
    });

    // ⚠️ NADA É CORTADO: foi o corte em 12 que enterrou, na manhã do mesmo dia,
    // a única recusa que impedia o PVA de importar o arquivo inteiro.
    it('todos os avisos chegam à tela — nenhum fica de fora', () => {
        const avisos = avisosDaPwr();
        render(<MensagemBlock mensagem={{ tipo: 'warning', titulo: 'x', detalhes: avisos }} />);
        for (const a of avisos) expect(screen.getByText(a)).toBeInTheDocument();
    });
});

describe('a caixa de mensagem', () => {
    it('uma frase só continua saindo como parágrafo — nada regride', () => {
        const { container } = render(
            <MensagemBlock mensagem={{ tipo: 'success', titulo: 'SPED gerado', detalhes: 'Download concluído.' }} />,
        );
        expect(container.querySelectorAll('li')).toHaveLength(0);
        expect(screen.getByText('Download concluído.')).toBeInTheDocument();
    });

    it('lista vazia não deixa a caixa dizer nada pela metade', () => {
        const { container } = render(
            <MensagemBlock mensagem={{ tipo: 'success', titulo: 'SPED gerado', detalhes: [] }} />,
        );
        expect(container.querySelectorAll('li')).toHaveLength(0);
        expect(container.querySelectorAll('ul')).toHaveLength(0);
    });
});

// ═══ A TRAVA DA CLASSE — o join volta a nascer no próximo aviso novo ════════
describe('🚦 os dois caminhos entregam LISTA', () => {
    const fonte = readFileSync(join(__dirname, '..', 'components', 'SpedFiscal', 'index.tsx'), 'utf8');
    // Varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS,
    // 22/08): os comentários que contam esta história citam o `join(' — ')`.
    const codigo = fonte
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');

    it('nenhum dos dois junta os warnings numa string', () => {
        expect(codigo).not.toMatch(/warnings\s*\.join\(/);
        expect(codigo).not.toMatch(/\]\s*\.join\(' — '\)/);
    });

    it('e os dois passam o array para `detalhes`', () => {
        // EFD-Contribuições (o caso da PWR) e SPED Fiscal.
        expect(codigo).toMatch(/detalhes:\s*warnings\.length\s*\?\s*warnings\s*:/);
        expect(codigo).toMatch(/detalhes:\s*linhasDoAviso\.length\s*\?\s*linhasDoAviso\s*:/);
    });
});
