// ============================================================================
// 🚨 O CÓDIGO MORTO DO SPED **ERA A RÉGUA VELHA** — e uma trava estava escrita
// sem nunca ter sido ligada
//
// A varredura de declarações órfãs no `sefaz-backend/` achou seis, e a triagem
// por RISCO separou duas naturezas opostas:
//
// ① **Cinco a DELETAR, porque o código morto É a régua que já custou caro.**
//    `MODELOS_BLOCO_C = ['55','65']` + `filtrarNotasBlocoC` viviam nos DOIS
//    geradores, e `MODELOS_BLOCO_D = ['57']` no bloco D: é a comparação contra
//    o campo CRU `n.modelo` — o defeito que tirou **100 das 131 notas** da
//    PS VIDROS 0896 do arquivo (19/08), porque o importer principal nunca
//    gravou esse campo. Quem responde hoje é `selecionarNotasBlocoC`.
//    Junto saiu o `modeloDaChave` da prevalidação, que ficou órfão quando a
//    R1 mudou para o dono comum, hoje mesmo.
//
// ② **Uma a LIGAR, porque ela deveria estar rodando.** A tabela de CST de
//    PIS/COFINS (4.3.3/4.3.4) morava em `sped-fiscal-regras-tributarias.js` —
//    o módulo do EFD **ICMS/IPI**, que não escreve CST de PIS/COFINS nenhum —
//    sem um único leitor. É a família do `coberturaIncompleta` (quatro dias
//    produzindo flag que ninguém lia) e do E510 "pronto" que ninguém gerava:
//    **trava escrita não é trava ligada.**
// ============================================================================
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirCstPisCofins, avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';

const RAIZ = join(__dirname, '..');
const l = (campos: string[]) => `|${campos.join('|')}|\r\n`;

/** C170 do EFD-Contribuições — 37 campos, com CST_PIS no 25 e CST_COFINS no 31. */
const c170 = (cstPis: string, cstCofins: string) => l([
    'C170', '1', 'ABC', 'PRODUTO', '1,000', 'UN', '100,00', '0,00', '0', '000', '5102', '',
    '0,00', '0,00', '0,00', '0,00', '0,00', '0,00', '0', '', '', '0,00', '0,00', '0,00',
    cstPis, '100,00', '0,6500', '', '', '0,65',
    cstCofins, '100,00', '3,0000', '', '', '3,00', '',
]);

describe('🚨 a linha de prova tem os 37 campos do leiaute', () => {
    it('e as posições 25 e 31 são as que o recibo do PVA fixou', () => {
        const f = c170('01', '02').split('|');
        expect(f.length - 2).toBe(37);   // [0] e o último são vazios (| nas pontas)
        expect(f[25]).toBe('01');
        expect(f[31]).toBe('02');
    });
});

describe('🚨 CST de PIS/COFINS fora da tabela', () => {
    it('código válido passa — a trava nasce VERDE', () => {
        expect(conferirCstPisCofins([c170('01', '01')]).ok).toBe(true);
        expect(conferirCstPisCofins([c170('50', '70')]).ok).toBe(true);
    });

    // 🔴 O que ela pega: CSOSN no campo de PIS (o item do Simples), e vazio.
    it('CSOSN e vazio são acusados, com o campo nomeado', () => {
        const r = conferirCstPisCofins([c170('101', '')]);
        expect(r.erros.map((e: any) => e.campo)).toEqual(['25 - CST_PIS', '31 - CST_COFINS']);
        expect(r.erros[0].mensagem).toContain('101');
        expect(r.erros[1].mensagem).toContain('(vazio)');
    });

    it('e ela entra nos avisos da geração, não num relatório que ninguém abre', () => {
        expect(avisosDaPrevalidacaoContrib([c170('101', '01')]).join(' '))
            .toMatch(/não existe na Tabela 4.3.3/);
    });

    // ⚠️ O QUE ELA NÃO FAZ, declarado: julgar se o código é o certo para a
    // DIREÇÃO. A Tabela 4.3.7 (aquisições) não está neste repo, e reconstruí-la
    // de memória seria inventar tabela oficial.
    it('não julga direção — 01 numa entrada continua passando, e isso é decisão', () => {
        expect(conferirCstPisCofins([c170('01', '01')]).ok).toBe(true);
    });

    // O A170 fica de fora porque a contagem dele não está provada em
    // CAMPOS_POR_REGISTRO — conferir posição deduzida é alarme falso.
    it('e o A170 não é conferido', () => {
        const a170 = l(['A170', '1', 'X', 'SERV', '100,00', '', '', '', 'LIXO', '100,00', '0,65', '0,65', 'LIXO', '100,00', '3,00', '3,00', '', '']);
        expect(conferirCstPisCofins([a170]).ok).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A VARREDURA: nenhuma declaração órfã nova no `sefaz-backend/`, porque é
// justamente ali que o código morto costuma SER a régua velha.
//
// ⚠️ A lista de exceções carrega o motivo. Constante que documenta um valor de
// protocolo (endpoint, algoritmo de assinatura) é referência, não régua morta.
// ═══════════════════════════════════════════════════════════════════════════
const ORFAS_DECLARADAS: Record<string, string> = {
    // ── Referência de PROTOCOLO: documentam o que o órgão exige (endpoint,
    //    SOAPAction, algoritmo de assinatura). Não decidem dado fiscal.
    'nfse-sp-client.js:SOAP_ACTION_RECEBIDAS': 'SOAPAction do portal de SP — documenta o protocolo do webservice',
    'nfse-sp-headless-login.js:PORTAL_HOST': 'host do portal de SP, referência do fluxo de login com certificado',
    'nfse-sp-headless-login.js:OPCOES_URL': 'URL de opções do portal, referência do mesmo fluxo de login',
    'nfse-sp-portal-client.js:ENDPOINT_LOGIN_ICP': 'endpoint de login por certificado ICP, referência do contrato',
    'serpro-client.js:INVOKE_URL': 'endpoint do SERPRO, referência do contrato da API',
    'reinf-gateway.js:DIGEST_ALG': 'algoritmo de digest do XMLDSig que a Receita exige no evento assinado',
    'reinf-gateway.js:ENVELOPED': 'transform do XMLDSig exigida pela Receita — documenta a assinatura',

    // ── Padrão repetido em toda rota: o acessor do firebase-admin.
    'manifesto-routes.js:fa': 'acessor do firebase-admin — o mesmo helper existe em toda rota do backend',

    // ── 🚩 NÃO TRIADAS. Ficam NOMEADAS em vez de apagadas ou de ganharem um
<<<<<<< HEAD
    //    motivo inventado.
    //
    //    ✅ `spOk`/`baixaOk` SAÍRAM daqui: triadas e DELETADAS — elas estavam
    //    superadas por `pendenciaSharePoint`/`pendenciaBaixa`, que respondem a
    //    mesma pergunta E devolvem o motivo. Mas a triagem achou o defeito que
    //    elas escondiam: aquelas duas devolvem null quando NÃO HÁ status
    //    gravado, e o painel lia esse null como "etapa cumprida".
=======
    //    motivo inventado: as duas primeiras têm cara da MESMA classe do CST
    //    de PIS/COFINS deste PR — conferência do rito #293 (arquivo no
    //    SharePoint, baixa da obrigação) escrita e nunca ligada. Só o dono do
    //    painel decide se é trava faltando ou sobra de versão antiga.
    'envio-imposto-painel.js:spOk': 'PENDENTE DE TRIAGEM — pergunta se o arquivo foi arquivado no SharePoint (rito #293); pode ser trava não ligada',
    'envio-imposto-painel.js:baixaOk': 'PENDENTE DE TRIAGEM — pergunta se a obrigação foi baixada (rito #293); mesma dúvida do spOk',
>>>>>>> origin/main
    'captura-resumo-cron.js:fmtDateBr': 'PENDENTE DE TRIAGEM — formatador de data do e-mail de resumo; é exibição, não decide dado fiscal',
    'require-cross-project-auth.js:getGooglePublicKeys': 'PENDENTE DE TRIAGEM — busca das chaves públicas do Google; caminho de AUTH, não se mexe sem caso real',
};


function declaracoesOrfas(): string[] {
    const dir = join(RAIZ, 'sefaz-backend');
    const fora: string[] = [];
    for (const nome of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
        const src = readFileSync(join(dir, nome), 'utf8');
        // Comentário fora: menção em prosa não é uso.
        const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        const decls = [...codigo.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
            .map((m) => m[1]);
        for (const d of new Set(decls)) {
            const usos = (codigo.match(new RegExp(`\\b${d.replace(/\$/g, '\\$')}\\b`, 'g')) || []).length;
            if (usos <= 1) fora.push(`${nome}:${d}`);
        }
    }
    return fora;
}

describe('🚨 declaração órfã no backend fiscal', () => {
    it('as cinco réguas velhas foram DELETADAS', () => {
        for (const [rel, nome] of [
            ['sefaz-backend/sped-fiscal-blocoC.js', 'MODELOS_BLOCO_C'],
            ['sefaz-backend/sped-fiscal-blocoC.js', 'filtrarNotasBlocoC'],
            ['sefaz-backend/sped-contrib-blocos.js', 'MODELOS_BLOCO_C'],
            ['sefaz-backend/sped-contrib-blocos.js', 'filtrarNotasBlocoC'],
            ['sefaz-backend/sped-fiscal-blocoD.js', 'MODELOS_BLOCO_D'],
        ]) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            expect({ rel, nome, viva: new RegExp(`^const ${nome}|^function ${nome}`, 'm').test(src) })
                .toEqual({ rel, nome, viva: false });
        }
    });

    it('e nenhuma órfã nova aparece sem estar declarada COM o motivo', () => {
        const novas = declaracoesOrfas().filter((x) => !ORFAS_DECLARADAS[x]);
        if (novas.length) {
            throw new Error(
                '\n\n🚧 DECLARAÇÃO ÓRFÃ NOVA NO BACKEND FISCAL\n\n'
                + novas.map((x) => `  · ${x}`).join('\n')
                + '\n\nNo SPED o código morto costuma SER a régua velha — foi o caso do\n'
                + '`MODELOS_BLOCO_C`, a comparação contra o campo cru que tirou 100 das 131\n'
                + 'notas da PS VIDROS do arquivo. Ou ele some, ou (se for uma trava que\n'
                + 'DEVERIA rodar, como a tabela de CST de PIS/COFINS) ele é LIGADO.\n'
                + 'Se for referência de protocolo, declare em ORFAS_DECLARADAS COM o motivo.\n',
            );
        }
    });

    it('toda exceção declarada tem motivo escrito', () => {
        for (const [k, motivo] of Object.entries(ORFAS_DECLARADAS)) {
            expect({ k, ok: motivo.trim().length >= 15 }).toEqual({ k, ok: true });
        }
    });
});
