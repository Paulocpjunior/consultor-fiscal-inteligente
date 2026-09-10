// ============================================================================
// 🚨 ENTREGA SEM NOVIDADE É QUASE NÃO ENTREGAR — e a trava cobria a metade
// errada.
//
// 01/09, Paulo: *"nós não temos um campo de novidades onde deve conter todas as
// atualizações feitas?"*. Temos — e a última entrada era de **22/08**. Dez dias
// de entrega sem registro nenhum: o bloco K, o fim de mês, o ajuste de
// retenção, o FUNRURAL por nota, a captura por resultado.
//
// 📌 A LIÇÃO É SOBRE A TRAVA QUE JÁ EXISTIA. Em 15/08 nasceu
// `novidadesService.test.ts`, que compara `NOVIDADES_VERSAO` com o "atualizado
// em" da própria página. Ela garante que, **SE** a página mudar, o selo
// vermelho acende. Ela **não** garante que a página mude quando há entrega — e
// por isso passou VERDE o tempo todo.
//
// ⚠️ É a mesma classe que esta casa persegue desde sempre: a trava existe, roda,
// passa — e não cobre o caso pelo qual ela foi criada. Aqui o silêncio custou
// dez dias de trabalho que a equipe não soube que existia.
//
// ✂️ ESTA fecha o outro lado: o CLAUDE.md é atualizado em TODO PR (regra da
// casa), então a data mais recente dele é o proxy fiel de *"houve entrega"*. Se
// ela for mais nova que a das Novidades, ou a página está atrasada, ou aquela
// entrega não muda nada para quem usa — e aí isso se DECLARA, com o motivo.
// ============================================================================
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { NOVIDADES_VERSAO } from '../services/novidadesService';

const RAIZ = resolve(__dirname, '..');

/**
 * Entregas que NÃO viram novidade — e o motivo escrito.
 *
 * ⚠️ Só entra aqui o que não muda NADA para quem usa o app: trava de teste,
 * refactor interno, correção de comentário. Se a pessoa vê diferença na tela,
 * no arquivo gerado ou no que ela precisa fazer, é NOVIDADE — não exceção.
 */
const DATAS_SEM_EFEITO_PARA_QUEM_USA: Record<string, string> = {
    // exemplo: '05/09': 'só varredura de teste — nada muda na tela nem no arquivo',
};

/** 'DD/MM' → número comparável. */
const ordem = (dm: string) => {
    const [d, m] = dm.split('/').map(Number);
    return m * 100 + d;
};

/**
 * A data mais recente de ENTREGA registrada no CLAUDE.md.
 *
 * 🐛 A PRIMEIRA VERSÃO DESTA TRAVA NASCEU ACUSANDO CÓDIGO CERTO — o vício que
 * esta casa mais repete. Ela lia TODA `DD/MM` do arquivo e a maior era
 * **`15/12`**: o *"Convênio s/nº 15/12/1970"*. Junto vinham `50/99` (CST do
 * IPI), `87/96` (a LC do CIAP), `55/65` (modelos de documento) e `17/99` (uma
 * portaria CAT — todos escritos com barra e sem nada a ver com data.
 *
 * ⚠️ Por isso a assinatura é a que os mata-burros de fato usam: a data entre
 * PARÊNTESES, **não seguida de barra** (que seria o ano de uma norma). Alarme
 * sobre código certo é o que faz a equipe desligar a trava — e uma trava de
 * comunicado desligada devolve exatamente o silêncio de dez dias.
 *
 * 🚩 VIRADA DE ANO: a comparação é (mês, dia), sem ano — o CLAUDE.md não os
 * escreve. Em janeiro isto precisa de revisão, e é de propósito que a conta
 * seja simples e visível em vez de esperta e errada.
 */
function ultimaEntregaNoClaudeMd(): string {
    const md = readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8');
    const datas = [...md.matchAll(/\((\d{2}\/\d{2})(?![/\d])/g)].map((m) => m[1])
        .filter((dm) => {
            const [d, mes] = dm.split('/').map(Number);
            return d >= 1 && d <= 31 && mes >= 1 && mes <= 12;
        });
    return datas.sort((a, b) => ordem(b) - ordem(a))[0] || '';
}

/** A data que a página de Novidades declara. */
function dataDasNovidades(): string {
    const html = readFileSync(join(RAIZ, 'public/novidades-cfi.html'), 'utf8');
    const m = html.match(/atualizado em (\d{2})\/(\d{2})\/\d{4}/);
    return m ? `${m[1]}/${m[2]}` : '';
}

describe('🚨 as Novidades cobrem as entregas', () => {
    it('a página declara a data em que foi atualizada', () => {
        expect(dataDasNovidades()).toMatch(/^\d{2}\/\d{2}$/);
    });

    it('o CLAUDE.md tem datas legíveis — sem elas a trava não mede nada', () => {
        // 🚨 Guarda contra o silêncio falso: se o regex quebrar, a trava passaria
        // VERDE sem ler nada, que é o defeito que ela existe para acabar.
        expect(ultimaEntregaNoClaudeMd()).toMatch(/^\d{2}\/\d{2}$/);
    });

    it('a última entrega registrada no CLAUDE.md chegou às Novidades', () => {
        const entrega = ultimaEntregaNoClaudeMd();
        const novidades = dataDasNovidades();
        if (ordem(entrega) <= ordem(novidades)) return;
        if (DATAS_SEM_EFEITO_PARA_QUEM_USA[entrega]) return;

        throw new Error(
            '\n\n📣 ENTREGA SEM NOVIDADE\n\n'
            + `  · CLAUDE.md registra trabalho em ${entrega}\n`
            + `  · a página de Novidades está em ${novidades}\n\n`
            + 'Entregar sem avisar é quase não entregar: a equipe não tem como saber que\n'
            + 'existe o que ler, e o selo vermelho do 📣 nunca acende (a lição de 15/08,\n'
            + 'em que onze dias de entrega passaram com o selo apagado).\n\n'
            + 'Escreva a novidade em `public/novidades-cfi.html` (linguagem de quem USA:\n'
            + 'o que mudou, onde fica, e o que a pessoa precisa fazer), atualize o\n'
            + '"atualizado em" do cabeçalho e a constante NOVIDADES_VERSAO.\n\n'
            + 'Se esta entrega REALMENTE não muda nada para quem usa — trava de teste,\n'
            + 'refactor interno —, declare a data em DATAS_SEM_EFEITO_PARA_QUEM_USA COM\n'
            + 'o motivo escrito. Lista sem motivo é lista que envelhece.\n',
        );
    });

    it('toda exceção declarada tem motivo escrito', () => {
        for (const [data, motivo] of Object.entries(DATAS_SEM_EFEITO_PARA_QUEM_USA)) {
            expect(data).toMatch(/^\d{2}\/\d{2}$/);
            expect(String(motivo).trim().length).toBeGreaterThan(20);
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ E A PÁGINA PRECISA DIZER O QUE A PESSOA FAZ, não só o que mudou.
//
// A régua de 21/08 (achado 18): aviso que aponta um lugar tem de apontar um
// lugar que ela ACHA. Uma novidade sem "onde" é a mesma coisa — ela conta uma
// história e deixa a pessoa procurando.
// ════════════════════════════════════════════════════════════════════════════
describe('⚠️ a novidade mais recente diz ONDE', () => {
    it('a seção do topo tem pelo menos um "Onde"', () => {
        const html = readFileSync(join(RAIZ, 'public/novidades-cfi.html'), 'utf8');
        const topo = html.slice(html.indexOf('<main>'), html.indexOf('</section>'));
        expect(topo).toMatch(/Onde:/);
    });
});
