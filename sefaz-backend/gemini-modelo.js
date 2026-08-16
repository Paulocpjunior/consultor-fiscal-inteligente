// ============================================================================
// sefaz-backend/gemini-modelo.js  (ESM, puro)
// ----------------------------------------------------------------------------
// QUAL GEMINI O APP USA — resolvido PERGUNTANDO, nunca chutando o ID.
//
// Paulo, 15/08: *"nosso motor de busca é o Gemini, usando minha conta paga; o
// Gemini teve sua versão atualizada para 3.7, nós devemos nos atualizar
// também"* — e, quando eu respondi com a explicação dos aliases: *"o que você
// quer dizer? pedi para você atualizar p a versão 3.7"*. A ordem é PINAR.
//
// ═══ POR QUE ISTO É UM MÓDULO E NÃO DUAS CONSTANTES ═════════════════════════
//
// Escrever `'gemini-3.7-pro'` na mão é apostar a produção num ID que eu nunca
// vi responder: se o nome real for outro (sufixo de data, `-preview`, ou a
// família ainda não liberada para ESTA conta), a IA do app inteiro cai — e cai
// no deploy, calada, porque nada aqui prova que o nome existe. É o mesmo erro
// do payload do PGDAS-D deduzido: **perguntar é PROVA, deduzir é aposta**.
//
// Então o desenho é o do ISS fixo código 9 e do R-2055: a FONTE responde. A
// API do Gemini lista os modelos da conta; este módulo escolhe, dentro do que
// ELA devolveu, o melhor da família alvo. Se o 3.7 estiver lá, o app fica
// PINADO nele (sem deploy quando a Google publicar). Se não estiver, o app
// continua no alias — funcionando — e a tela DIZ que o alvo não foi encontrado,
// em vez de quebrar ou de mentir que atualizou.
//
// TRÊS TRAVAS QUE OS TESTES PROTEGEM:
//  (1) `-lite` NÃO entra na vaga do Flash. É outro degrau de preço/qualidade, e
//      o roteador Pro×Flash manda prompt de verdade para o Flash.
//  (2) a família casa com FRONTEIRA (`3.7` não pega `3.70` nem `13.7`).
//  (3) lista vazia/falha ⇒ ALIAS, nunca ID inventado — e o motivo vai escrito.
// ============================================================================

/**
 * A família que o Paulo mandou usar — o PISO, não um casamento exato.
 *
 * 🚨 CORREÇÃO DE PREMISSA (16/08, print do seletor da conta dele): **as linhas
 * Pro e Flash NÃO andam no mesmo número**. O seletor do Gemini mostra, na mesma
 * lista: `3.5 Flash Lite`, **`3.7 Flash`** e **`3.1 Pro`**. Eu tinha escrito o
 * resolvedor casando a família EXATA nos dois degraus, então ele procurava um
 * "3.7 Pro" que simplesmente não existe — e, não achando, dizia que *"a família
 * 3.7 não aparece para esta conta"*, o que era falso e contradizia a sonda.
 *
 * O alvo certo é: **o mais novo de CADA linha**, com a família como piso.
 * "Atualizar para a 3.7" quer dizer não ficar para trás — não quer dizer que
 * exista um 3.7 em todo degrau.
 */
export const FAMILIA_ALVO_GEMINI = '3.7';

/** `gemini-3.7-flash` → 3.7 · `gemini-2.5-pro` → 2.5 · sem versão → null. */
export function versaoDoModelo(nome) {
    const m = normalizarNomeModelo(nome).match(/^gemini-(\d+)\.(\d+)/i);
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 1000;
}

/** Aliases oficiais do Google — a rede de baixo, que sempre responde. */
export const ALIAS_PRO = 'gemini-pro-latest';
export const ALIAS_FLASH = 'gemini-flash-latest';

/** `models/gemini-3.7-pro` → `gemini-3.7-pro`. */
export function normalizarNomeModelo(nome) {
    return String(nome || '').trim().replace(/^models\//, '');
}

/** Sufixos que marcam modelo NÃO estável — servem, mas perdem para o GA. */
const INSTAVEL = /(preview|exp|experimental|thinking|tuning)/i;

/**
 * O modelo suporta gerar conteúdo? Entrada de embedding/imagem casaria com o
 * nome da família e viraria "Pro" — resposta que nunca chega.
 * Ausência do campo NÃO reprova (nem toda listagem traz): ausente ≠ não.
 */
function geraConteudo(m) {
    const acoes = m?.supportedActions || m?.supportedGenerationMethods;
    if (!Array.isArray(acoes) || acoes.length === 0) return true;
    return acoes.some(a => String(a).toLowerCase() === 'generatecontent');
}

/**
 * Escolhe o melhor modelo da família+tipo dentro do que a API devolveu.
 *
 * @param {Array<object|string>} modelos  lista da API (objetos ou nomes crus)
 * @param {{familia: string, tipo: 'pro'|'flash'}} alvo
 * @returns {{modelo: string|null, candidatos: string[], motivo: string}}
 */
export function escolherModeloDaFamilia(modelos, { familia, tipo }) {
    const lista = Array.isArray(modelos) ? modelos : [];
    // A FAMÍLIA É PISO, não casamento exato: o Pro pode estar no 3.1 enquanto
    // o Flash está no 3.7 (print da conta do Paulo, 16/08). Exigir o número
    // igual nos dois degraus fazia o app procurar um "3.7 Pro" inexistente.
    const piso = versaoDoModelo(`gemini-${familia}-x`) ?? 0;

    const candidatos = lista
        .map(m => (typeof m === 'string' ? { name: m } : (m || {})))
        .filter(geraConteudo)
        .map(m => normalizarNomeModelo(m.name))
        .filter(nome => !!nome && versaoDoModelo(nome) !== null)
        .filter(nome => {
            const n = nome.toLowerCase();
            if (tipo === 'flash') {
                // `-lite` é OUTRO degrau: mais barato e mais fraco. O roteador
                // manda ao Flash prompt de trabalho, então cair no lite seria
                // rebaixar o app em silêncio.
                return n.includes('flash') && !n.includes('lite');
            }
            // Na vaga do Pro, qualquer coisa que diga "flash" está fora.
            return n.includes('pro') && !n.includes('flash');
        });

    if (candidatos.length === 0) {
        return {
            modelo: null, candidatos: [], versao: null, atingiuPiso: false,
            motivo: `A conta não lista nenhum modelo ${tipo.toUpperCase()} com versão reconhecível.`,
        };
    }

    const ordenados = [...candidatos].sort((a, b) => {
        // MAIS NOVO PRIMEIRO — é isso que "não ficar para trás" significa.
        const va = versaoDoModelo(a) ?? 0;
        const vb = versaoDoModelo(b) ?? 0;
        if (va !== vb) return vb - va;
        const ia = INSTAVEL.test(a) ? 1 : 0;
        const ib = INSTAVEL.test(b) ? 1 : 0;
        if (ia !== ib) return ia - ib;               // estável antes de preview
        if (a.length !== b.length) return a.length - b.length; // nome base antes de datado
        return b.localeCompare(a);
    });

    const escolhido = ordenados[0];
    const versao = versaoDoModelo(escolhido);
    const atingiuPiso = (versao ?? 0) >= piso;
    return {
        modelo: escolhido, candidatos: ordenados, versao, atingiuPiso,
        motivo: atingiuPiso
            ? `Pinado em ${escolhido} — o mais novo ${tipo.toUpperCase()} que a conta lista.`
            : `Pinado em ${escolhido}: é o mais novo ${tipo.toUpperCase()} da conta, e a linha ${tipo.toUpperCase()} `
              + `ainda não chegou na ${familia} (as linhas Pro e Flash não andam no mesmo número).`,
    };
}

/**
 * Resolve os DOIS modelos do app (Pro e Flash).
 *
 * Precedência: env explícito > família alvo listada pela API > alias.
 * O env vence porque é o operador pinando à mão (hotfix, release quebrada) —
 * decisão humana não é sobrescrita por regra automática.
 *
 * @param {object} p
 * @param {Array|null} p.modelos  lista da API; null/[] = não foi possível perguntar
 * @param {string} [p.envPro] @param {string} [p.envFlash]
 * @param {string} [p.familia]
 * @returns {{familiaAlvo: string, pro: object, flash: object, alvoEncontrado: boolean}}
 */
export function resolverModelosGemini({ modelos, envPro, envFlash, familia = FAMILIA_ALVO_GEMINI } = {}) {
    const perguntou = Array.isArray(modelos) && modelos.length > 0;

    const resolverUm = (tipo, env, alias) => {
        if (env && String(env).trim()) {
            return {
                modelo: String(env).trim(), origem: 'env',
                motivo: `Pinado à mão no Cloud Run (GEMINI_MODEL_${tipo.toUpperCase()}) — o env vence a regra automática.`,
            };
        }
        if (!perguntou) {
            // NÃO inventa o ID da família. Sem a lista, o alvo é indeterminado
            // — e indeterminado aqui LIBERA no alias (a IA do escritório não
            // pode cair porque a listagem piscou), dizendo que não conferiu.
            return {
                modelo: alias, origem: 'alias-sem-lista',
                motivo: `Não foi possível listar os modelos da conta — seguindo no alias ${alias}. `
                    + `O alvo ${familia} não foi conferido nesta consulta.`,
            };
        }
        const achado = escolherModeloDaFamilia(modelos, { familia, tipo });
        if (achado.modelo) {
            return {
                modelo: achado.modelo, origem: 'familia-alvo', motivo: achado.motivo,
                candidatos: achado.candidatos, versao: achado.versao, atingiuPiso: achado.atingiuPiso,
            };
        }
        return {
            modelo: alias, origem: 'alias-fallback',
            motivo: `${achado.motivo} Seguindo no alias ${alias}, que a Google promove sozinha. `
                + `Quando a família ${familia} aparecer para esta conta, o app pina nela sem deploy.`,
        };
    };

    const pro = resolverUm('pro', envPro, ALIAS_PRO);
    const flash = resolverUm('flash', envFlash, ALIAS_FLASH);

    return {
        familiaAlvo: familia,
        pro, flash,
        alvoEncontrado: pro.origem === 'familia-alvo' && flash.origem === 'familia-alvo',
    };
}

/**
 * A versão CONCRETA que respondeu (campo `modelVersion`) é da família alvo?
 *
 * É esta função que responde *"estamos no 3.7?"* — e ela responde pelo que a
 * API DEVOLVEU, não pelo nome que o app pediu. Alias apontando para o 3.7 já
 * é estar no 3.7; nome pinado que a API atende com outra versão, não é.
 */
export function versaoAtendeAlvo(modelVersion, familia = FAMILIA_ALVO_GEMINI) {
    const v = normalizarNomeModelo(modelVersion);
    if (!v) return null; // sem resposta não se afirma nada — nem sim, nem não
    const escapada = String(familia).replace(/\./g, '\\.');
    return new RegExp(`(^|-)${escapada}(?=[-.]|$)`).test(v) || new RegExp(`^gemini-${escapada}(?=[-.]|$)`, 'i').test(v);
}

// ============================================================================
// O QUE O PAINEL DEVE DIZER — e o print de produção provou que ele dizia errado.
// ----------------------------------------------------------------------------
// Paulo abriu o ⚙️ Config Admin e a tela mostrou, LADO A LADO:
//
//   ⚠ A família 3.7 ainda não aparece para esta conta — o app segue no alias.
//   ✓ gemini-flash-latest → gemini-3.7-flash · na família alvo
//   ✓ gemini-flash-latest → gemini-3.7-flash · na família alvo
//
// Ou seja: o cabeçalho dizia que NÃO estamos na 3.7 enquanto as duas sondas
// mostravam a conta sendo atendida POR ELA. Duas leituras do mesmo fato
// discordando na mesma tela — a armadilha que este projeto mais pagou, e eu
// acabei de reproduzi-la.
//
// A CAUSA: `alvoEncontrado` respondia sobre a LISTAGEM (o modelo aparece em
// `models.list`?), e o cabeçalho lia isso como se fosse a resposta de "estamos
// no 3.7?". São perguntas diferentes: a listagem é STATUS, a sonda é RESULTADO
// — e nesta casa **quem responde é o resultado**.
// ============================================================================

/**
 * "Estamos na família alvo?" — respondido pela SONDA, com a listagem só como
 * informação de apoio.
 *
 * @param {Array<{modelVersion: string|null, naFamiliaAlvo: boolean|null}>} sondas
 * @param {boolean} listada  a família apareceu em `models.list`
 */
export function vereditoDaFamilia(sondas, listada, familia = FAMILIA_ALVO_GEMINI) {
    const responderam = (sondas || []).filter((s) => s && s.modelVersion);

    // Sonda que não respondeu NÃO vira "não estamos" — é a mesma régua do
    // `versaoAtendeAlvo` devolvendo null: rede que piscou não é veredito.
    if (responderam.length === 0) {
        return {
            situacao: 'indeterminado', cor: 'neutro',
            texto: `Nenhuma sonda respondeu — não dá para afirmar em que família a conta está.`,
        };
    }

    const naFamilia = responderam.filter((s) => s.naFamiliaAlvo === true);
    if (naFamilia.length === responderam.length) {
        return {
            situacao: 'atendida', cor: 'ok',
            texto: `Estamos na família ${familia}: quem respondeu foi `
                + `${[...new Set(responderam.map((s) => s.modelVersion))].join(' e ')}.`
                + (listada ? '' : ' (A família não aparece na listagem da conta, mas o alias está sendo servido por ela — '
                    + 'quem responde é o resultado, não a listagem.)'),
        };
    }
    if (naFamilia.length === 0) {
        return {
            situacao: 'fora', cor: 'atencao',
            texto: `A conta está sendo atendida por ${[...new Set(responderam.map((s) => s.modelVersion))].join(', ')}, `
                + `fora da família ${familia}.`,
        };
    }
    return {
        situacao: 'parcial', cor: 'atencao',
        texto: `Só parte das chamadas está na família ${familia}: `
            + responderam.map((s) => `${s.modelo || '?'} → ${s.modelVersion}`).join(' · ') + '.',
    };
}

/**
 * O ROTEADOR Pro×Flash está fazendo alguma coisa?
 *
 * O print de produção mostrou **`gemini-flash-latest` nas DUAS linhas**: com os
 * dois iguais, o roteador vira ENFEITE e tudo — anexo, prompt longo, parecer
 * jurídico — sai no mesmo degrau.
 *
 * ⚠️ **ISTO DEIXOU DE SER ALARME EM 16/08, POR DECISÃO DO PAULO**: *"não vejo
 * problema em continuar no Gemini Flash desde que seja a última versão"*. O
 * fato continua na tela (o roteador sem efeito é informação que quem opera
 * precisa ter), mas em NEUTRO — pintar de vermelho uma escolha que o dono fez
 * é o alarme sem ação que ensina a equipe a ignorar os alarmes que importam.
 *
 * A vigilância migrou para a condição que ELE pôs: `conferirAtualizacao` acusa
 * quando o modelo que está respondendo ficou atrás do mais novo da conta.
 */
export function conferirRoteador({ pro, flash }) {
    const p = normalizarNomeModelo(pro?.modelo || pro);
    const f = normalizarNomeModelo(flash?.modelo || flash);
    if (!p || !f) return { ok: true, colidiu: false, cor: 'neutro', aviso: null };
    if (p !== f) return { ok: true, colidiu: false, cor: 'ok', aviso: null };
    return {
        // `ok: true` de propósito — não é defeito, é a configuração escolhida.
        ok: true, colidiu: true, cor: 'neutro',
        aviso: `Os dois degraus usam o mesmo modelo (${p}) — o roteador Pro×Flash está sem efeito, `
            + 'e tudo (inclusive anexo, prompt longo e parecer jurídico) sai por ele. '
            + 'Decisão registrada em 16/08: seguir no Flash, desde que na última versão — '
            + 'é isso que o app vigia agora. Para voltar a ter dois degraus, remova os envs '
            + 'GEMINI_MODEL_PRO / GEMINI_MODEL_FLASH no Cloud Run e o app resolve sozinho.',
    };
}

/** 'flash' · 'pro' · null quando o nome não diz a linha. */
export function linhaDoModelo(nome) {
    const n = normalizarNomeModelo(nome).toLowerCase();
    if (!n) return null;
    if (n.includes('flash')) return 'flash';
    if (n.includes('pro')) return 'pro';
    return null;
}

/**
 * 🚨 A CONDIÇÃO DO PAULO VIROU A RÉGUA: *"desde que seja a última versão"*.
 *
 * Enquanto o alarme era "PRO e FLASH colidiram", ele acusava uma ESCOLHA. O que
 * de fato pode envelhecer sem ninguém ver é outra coisa: o modelo que está
 * respondendo ficar para trás do que a conta já oferece — e isso acontece
 * SOZINHO, no dia em que a Google publica a versão seguinte.
 *
 * Compara pelo que a SONDA respondeu (`modelVersion`), nunca pelo nome que o
 * app pediu: alias não tem versão no nome, e é justamente o alias que promove
 * sozinho. Quem responde é o resultado.
 *
 * TRÊS RECUSAS:
 * - Sem a listagem da conta ⇒ `indeterminado`, NUNCA "atrasado". Rede que
 *   piscou não é veredito, e "você está atrasado" faria alguém pinar à mão um
 *   modelo que já estava certo.
 * - Sonda que não respondeu ⇒ fora da conta, nomeada.
 * - Modelo cuja linha não dá para ler pelo nome ⇒ fora, nomeado. Julgar sem
 *   saber a linha compararia Flash com Pro.
 */
export function conferirAtualizacao(sondas, modelos, familia = FAMILIA_ALVO_GEMINI) {
    const temLista = Array.isArray(modelos) && modelos.length > 0;
    if (!temLista) {
        return {
            situacao: 'indeterminado', cor: 'neutro', linhas: [],
            texto: 'Não foi possível listar os modelos da conta — não dá para afirmar se estamos na última versão. '
                + 'Reabra o painel para conferir de novo.',
        };
    }

    const vistos = new Map();
    for (const s of sondas || []) {
        const versaoQueRespondeu = s?.modelVersion;
        if (!versaoQueRespondeu) continue;
        const linha = linhaDoModelo(versaoQueRespondeu) || linhaDoModelo(s?.modelo);
        if (!linha || vistos.has(linha)) continue;

        const maisNovo = escolherModeloDaFamilia(modelos, { familia, tipo: linha });
        const vAtual = versaoDoModelo(versaoQueRespondeu);
        const vNovo = maisNovo.versao;
        // `== null` PRIMEIRO: `Number(null)` é 0 e passaria por versão válida —
        // é o mesmo tropeço que mordeu três vezes num só dia em 16/08.
        if (vAtual == null || vNovo == null) {
            vistos.set(linha, { linha, situacao: 'indeterminado', atual: versaoQueRespondeu, maisNovo: maisNovo.modelo });
            continue;
        }
        vistos.set(linha, {
            linha,
            situacao: vAtual >= vNovo ? 'atual' : 'atrasado',
            atual: versaoQueRespondeu,
            maisNovo: maisNovo.modelo,
        });
    }

    const linhas = [...vistos.values()];
    if (linhas.length === 0) {
        return {
            situacao: 'indeterminado', cor: 'neutro', linhas,
            texto: 'Nenhuma sonda respondeu — não dá para afirmar em que versão a conta está.',
        };
    }

    const atrasadas = linhas.filter((l) => l.situacao === 'atrasado');
    if (atrasadas.length > 0) {
        return {
            situacao: 'atrasado', cor: 'erro', linhas,
            texto: atrasadas
                .map((l) => `A linha ${l.linha.toUpperCase()} está ATRÁS: responde em ${l.atual}, `
                    + `e a conta já lista ${l.maisNovo}.`)
                .join(' ')
                + ' Remova o env correspondente no Cloud Run (GEMINI_MODEL_PRO / GEMINI_MODEL_FLASH) '
                + 'para o app pinar sozinho no mais novo.',
        };
    }
    if (linhas.every((l) => l.situacao === 'atual')) {
        return {
            situacao: 'atual', cor: 'ok', linhas,
            texto: `Na última versão: ${linhas.map((l) => `${l.linha.toUpperCase()} em ${l.atual}`).join(' · ')} — `
                + 'nada mais novo na conta.',
        };
    }
    return {
        situacao: 'indeterminado', cor: 'neutro', linhas,
        texto: 'Não deu para comparar todas as linhas com a listagem da conta: '
            + linhas.map((l) => `${l.linha.toUpperCase()} responde em ${l.atual}`).join(' · ') + '.',
    };
}
