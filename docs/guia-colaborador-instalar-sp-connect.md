# Guia — Instalar o SP Connect (Teams, celular, tablet e computador)

<!-- guia-id: instalar-sp-connect · guia-revisao: 2026-08-16 -->
<!-- Mexeu aqui? mexa no par em public/ e suba a revisão nos DOIS. -->

> Fonte dupla: este arquivo e `public/guia-instalar-sp-connect.html` DEVEM ser
> atualizados juntos (`__tests__/guiaParDuplo.test.ts` barra o build se as
> revisões divergirem).

Nasceu da pergunta do Paulo (16/08): *"podemos de verdade criar um app pra
download e instalação? um plugin pra navegador, ou apenas URL e tenant
Microsoft adicionando o app ao Teams, como já temos o HitPhone por exemplo"*.

## A resposta curta

O SP Connect roda em **quatro lugares** e em **nenhum deles alguém baixa um
instalador**. É o mesmo desenho do **HitPhone**: app do *nosso* tenant
Microsoft apontando para uma URL — mais a instalação pelo próprio navegador
no celular e no computador.

| Onde | Como se instala | Ícone próprio? | Quem faz |
|---|---|---|---|
| **Microsoft Teams** | app do tenant, enviado uma vez no Admin Center | sim, na barra lateral | admin uma vez · colaborador adiciona |
| **Celular / tablet** | abrir a URL → *Adicionar à Tela de Início* / *Instalar* | sim, abre sem barra de navegador | cada colaborador |
| **Computador** | abrir no Edge/Chrome → *Instalar* | sim, janela própria | cada colaborador |
| **Navegador** | só a URL | não | — |

Endereço: o CFI de sempre com `/connect` no fim. Quando o domínio próprio
entrar no ar (`app.spassessoriacontabil.com.br`), quem já instalou **não
precisa reinstalar**.

## 1. Microsoft Teams

**Admin, uma vez para a casa inteira.** O pacote já está pronto e se baixa do
próprio app: `/sp-connect-teams.zip`.

1. Baixar o `sp-connect-teams.zip`.
2. `admin.teams.microsoft.com` → **Aplicativos do Teams** → **Gerenciar
   aplicativos** → **Ações** → **Carregar novo aplicativo** → enviar o zip.
   *Atalho, se a política permitir:* no Teams → Aplicativos → Gerenciar seus
   aplicativos → Carregar um aplicativo personalizado.
3. **Políticas de permissão de aplicativos**: liberar o SP Connect.
4. **Políticas de configuração**: **fixar** o app — assim ele aparece na barra
   lateral de todo mundo, sem ninguém procurar.

**Colaborador:** Teams → Aplicativos → **SP Connect** → **Adicionar** → botão
direito no ícone → **Fixar**.

⚠️ App que não aparece na busca do Teams é uma de duas coisas: o pacote ainda
não foi enviado, ou a política do tenant bloqueia aplicativos personalizados.
Não é problema da máquina do colaborador.

O login dentro da aba é o **mesmo do CFI** — não existe usuário separado.

Detalhes técnicos do pacote (GUID que não muda, regra dos ícones, troca de
domínio) ficam em `teams-app/README.md`.

## 2. Celular e tablet

**iPhone / iPad** — precisa ser o **Safari** (só ele instala no iOS):
Compartilhar (quadrado com seta) → **Adicionar à Tela de Início** →
confirmar.

**Android** — no **Chrome**: aceitar o convite **Instalar aplicativo**, ou
⋮ → **Instalar aplicativo** (em alguns aparelhos, *Adicionar à tela inicial*).

Instalado, abre em tela cheia, sem barra de navegador, com o ícone azul da SP.

⚠️ **Depois de instalar, abra e ligue os avisos.** Aplicativo instalado e mudo
é o pior dos dois mundos: parece que vai avisar e não avisa.

## 3. Computador (Windows e Mac)

Edge ou Chrome → ícone de **instalar** na barra de endereço (ou menu … →
Aplicativos → *Instalar este site como um aplicativo*). Passa a abrir em
janela própria, com ícone na barra de tarefas / Dock — e evita fechar o
atendimento junto com o navegador.

## 4. Navegador, sem instalar nada

Abrir o endereço e usar. Com a aba **fechada**, som e pop-up não tocam — quem
atende todo dia deve instalar e ligar os avisos.

## E um app "de verdade", na App Store e no Google Play?

Dá para fazer. **Não compensa hoje** — o que se ganharia já temos, e o que se
pagaria é recorrente.

| Caminho | Dá? | Custo real | O que acrescenta |
|---|---|---|---|
| Instalar pela URL (o que fazemos) | **no ar** | zero; versão nova chega na hora | ícone, tela cheia, aviso no celular |
| App na App Store / Google Play | tecnicamente sim | conta de desenvolvedor anual da Apple + conta do Google; **cada atualização passa por revisão** (dias); e a Apple recusa app que é "só um site empacotado" — a regra 4.2 exige que ele faça algo que o site não faz | estar na busca da loja |
| Extensão (plugin) de navegador | ferramenta errada | publicação com revisão + um segundo código para manter | nada: extensão serve para **modificar outras páginas**, não para hospedar um sistema |

**O ponto que decide:** a loja não entrega nada que a equipe use. Ícone na
tela inicial, tela cheia e aviso no celular já funcionam sem ela, e o app é
**interno** — ninguém de fora vai procurar "SP Connect" na App Store. O que a
loja adicionaria é **fila de revisão entre nós e uma correção urgente**.

Não é porta fechada: se um dia precisarmos de algo que só um app nativo faz, o
caminho existe e o PWA de hoje é a base dele. É ordem de prioridade.

## O que só o admin resolve

- Enviar o pacote do Teams e liberar/fixar por política.
- Publicar a chave de aviso no celular (`VITE_FIREBASE_VAPID_KEY`) — enquanto
  não estiver publicada, o app **diz na tela** que o push está pendente; som e
  pop-up funcionam igual.
- Ligar o colaborador nas filas (⚙️ → 👥 Atendentes). Sem isso a pessoa entra e
  não vê conversa nenhuma — parece defeito e é cadastro.

## Não deu certo?

| Sintoma | Causa mais provável | O que fazer |
|---|---|---|
| iPhone não mostra "Adicionar à Tela de Início" | está no Chrome/Edge do iPhone | abrir no **Safari** |
| Instalou, mas abre com barra do navegador | abriu pelo atalho antigo | abrir pelo ícone instalado |
| Não recebe aviso de mensagem nova | permissão negada ou avisos não ligados | abrir o app: a barra amarela mostra o que falta |
| Entra e não vê conversa nenhuma | não está ligado a nenhuma fila | pedir ao admin (⚙️ → 👥 Atendentes) |
| SP Connect não aparece no Teams | pacote não enviado ou política bloqueia | falar com o Paulo |

Ao reportar, mande **print da tela inteira** com a versão do rodapé. Print sem
versão não diz em que build o problema aconteceu.
