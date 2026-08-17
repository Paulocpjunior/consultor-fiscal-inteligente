# SP Connect — app do Microsoft Teams

Pacote de **app personalizado do Teams** que abre o SP Connect (`/connect`)
como aba pessoal, do lado do HitPhone.

## O que tem aqui

| Arquivo | O que é |
| --- | --- |
| `manifest.json` | Manifesto do Teams (aba estática → `/connect`) |
| `color.png` | Ícone colorido 192×192 (regra do Teams) |
| `outline.png` | Ícone de contorno 32×32, branco sobre transparente (regra do Teams) |

O zip pronto para upload fica em **`public/sp-connect-teams.zip`** — ou seja,
também dá pra baixar do próprio app em `/sp-connect-teams.zip`.

## Como instalar (parte do Paulo — uma vez)

1. Abrir o **Centro de administração do Teams** (admin.teams.microsoft.com)
   → **Aplicativos do Teams → Gerenciar aplicativos → Ações → Carregar novo
   aplicativo** e enviar o `sp-connect-teams.zip`.
   *(Alternativa rápida, se a política permitir: no próprio Teams,
   Aplicativos → Gerenciar seus aplicativos → Carregar um aplicativo →
   Carregar um aplicativo personalizado.)*
2. Em **Políticas de permissão/configuração de aplicativos**, liberar o app
   para a equipe (ou fixá-lo por política, para aparecer na barra lateral de
   todo mundo).
3. Cada colaborador: Aplicativos → SP Connect → **Adicionar** → fixar na
   barra lateral (botão direito → Fixar).

O login dentro da aba é o mesmo do CFI (Firebase). O CSP do app já permite
o iframe só nos domínios do Teams (`teams.microsoft.com`, `*.cloud.microsoft`,
`*.office.com`) — travado por teste.

## Quando o domínio próprio entrar no ar

O `contentUrl` aponta pra URL do Cloud Run (funciona hoje). Quando o
`app.spassessoriacontabil.com.br` estiver mapeado (script
`scripts/setup-dominio-app.sh` + CNAME), trocar o `contentUrl`/`websiteUrl`
no `manifest.json`, subir `version` (ex.: 1.0.1), regenerar o zip
(`bash scripts/gerar-pacote-teams.sh`) e reenviar no admin center — o
domínio novo já está em `validDomains`, então é só o reenvio.

## Regras que valem aqui

- O `id` (GUID) **não muda** entre versões — mudar cria OUTRO app na visão
  do Teams e a equipe perde o fixado.
- Ícones seguem a regra do Teams: `color.png` 192×192; `outline.png` 32×32
  **branco sobre transparente** (colorido ali é recusado na validação).
- Gerados por `scripts/gerar-icones-teams.py` (sem dependência de lib de
  imagem — o container não tem PIL).
