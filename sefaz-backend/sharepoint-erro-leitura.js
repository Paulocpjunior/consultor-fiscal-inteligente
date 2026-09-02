// ============================================================================
// sefaz-backend/sharepoint-erro-leitura.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "879 ERROS" NUMA RODADA — E A MAIORIA NÃO ERA ERRO.
//
// 02/09, print do Paulo depois de clicar "Executar Sync Agora":
// *"Sync concluído: 0 novos, 0 duplicados, 879 erros"*, e logo abaixo
// *"Não deu para listar as pastas de Empresas agora (Muitas requisições)"*.
//
// A conta foi MEDIDA, não deduzida: o auto-sync faz **4 chamadas ao proxy por
// empresa** (2 competências × 2 direções) e há **416 empresas** com auto-sync
// ligado ⇒ **1.664 chamadas** por rodada. O proxy aceita **60 por minuto**
// (`proxy-backend/server.js`). Da 61ª em diante a resposta é **429**, e a
// rodada gasta minutos colecionando recusas do PRÓPRIO app.
//
// 🚨 E O RESTO É **404 ESPERADO**: o auto-sync **LÊ** o SharePoint (baixa o
// XML que está lá para dentro do app) — ele NUNCA cria pasta. Quem cria é o
// UPLOAD (`ensureFolderPath` no proxy). Como a árvore do `Departamento Fiscal`
// ainda não existe em empresa nenhuma, listar aquela pasta responde 404 — que
// é a VERDADE ("ainda não há nada aqui"), não uma falha.
//
// ⚠️ Empilhar as três coisas num contador só produz **879 alarmes vermelhos
// por rodada sobre a carteira inteira** — o jeito conhecido de a equipe parar
// de olhar o card (a lição das 236 empresas em ALTO, 26/08). E as ações são
// OPOSTAS: 404 não pede nada de ninguém; 429 é o app batendo rápido demais;
// credencial recusada trava tudo e é do administrador.
// ============================================================================

/**
 * Classifica a falha de uma leitura de pasta no SharePoint.
 *
 * ⚠️ Só acusa o que se PROVA pela mensagem. O que não se reconhece volta como
 * `desconhecido` — que **não é aprovação**: ele continua contando como erro,
 * com a mensagem inteira, porque afirmar a causa errada manda procurar no
 * lugar errado.
 *
 * @param {string} mensagem
 * @returns {{ causa: 'pasta-inexistente'|'limite-do-proxy'|'credencial'|'desconhecido',
 *             ehErro: boolean, acao: string|null }}
 */
export function classificarErroDeLeitura(mensagem) {
    const m = String(mensagem || '');

    // 429 do NOSSO proxy — nada a ver com a empresa da linha.
    if (/\b429\b/.test(m) || /muitas requisi/i.test(m)) {
        return {
            causa: 'limite-do-proxy',
            ehErro: true,
            acao: 'O app pediu mais rápido que o limite do proxy (60/min). Não é problema '
                + 'desta empresa: a rodada segue no ritmo do proxy.',
        };
    }

    // Credencial recusada trava TODA a carteira — não é erro de empresa.
    if (/AADSTS|invalid_client|\b401\b|\b403\b/i.test(m)) {
        return {
            causa: 'credencial',
            ehErro: true,
            acao: 'A credencial do proxy foi recusada — enquanto isso NENHUMA empresa '
                + 'sincroniza. Veja o card Conexão SharePoint.',
        };
    }

    // 404 de LEITURA = a pasta daquela competência ainda não existe.
    //
    // ⚠️ Isto NÃO é falha: o auto-sync lê, e quem cria a pasta é a gravação.
    // Chamar de erro faz a carteira inteira nascer vermelha todo dia.
    if (/\b404\b/.test(m) || /itemNotFound/i.test(m) || /Failed to list folder/i.test(m)) {
        return {
            causa: 'pasta-inexistente',
            ehErro: false,
            acao: null,
        };
    }

    return { causa: 'desconhecido', ehErro: true, acao: null };
}

/**
 * A frase do resultado da rodada — com a causa DOMINANTE junto do número.
 *
 * 📌 "879 erros" sem porquê obrigava a caçar no log; e quando a maioria é
 * pasta que ainda não existe, o número sozinho é uma mentira sobre a saúde da
 * captura.
 */
export function resumoDaRodada({ novos = 0, duplicados = 0, erros = 0, semPasta = 0, limite = 0 } = {}) {
    const partes = [`${novos} novos`, `${duplicados} duplicados`, `${erros} erros`];
    if (semPasta > 0) {
        partes.push(`${semPasta} pasta(s) ainda sem a competência no SharePoint — o app LÊ esta `
            + 'pasta; ela nasce quando algo é arquivado nela');
    }
    if (limite > 0) {
        partes.push(`${limite} recusa(s) por limite do proxy (60/min) — o app pediu rápido demais`);
    }
    return partes.join(' · ');
}

/**
 * O respiro entre chamadas para caber no teto do proxy.
 *
 * 📌 É o mesmo desenho do respiro de 90s da SEFAZ (cStat 656): quando o outro
 * lado publica um limite, **respeitá-lo é mais barato que colecionar recusas**
 * — 1.664 chamadas contra 60/min viraram 879 falhas que não ensinam nada.
 *
 * ⚠️ Devolve 0 quando o teto não é um número positivo: inventar pausa onde não
 * há limite conhecido seria atrasar a rodada por dedução minha.
 */
export function intervaloEntreChamadasMs(porMinuto) {
    const n = Number(porMinuto);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(60000 / n);
}
