<p align="center">
  <img src="docs/img/logo.svg" alt="Logo do CloudBank" width="96" height="96" />
</p>

<h1 align="center">CloudBank</h1>

<p align="center">
  <strong>Seu dinheiro, no seu servidor.</strong><br />
  Um gerenciador de finanças pessoais gratuito na web: uma versão para o navegador do <a href="https://www.gethomebank.org/">HomeBank</a>, reescrita do zero.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <strong>Português (Brasil)</strong>
</p>

<p align="center">
  <a href="https://p01--cloudbank--7dcjw6mlmtky.code.run/"><img src="https://img.shields.io/badge/Experimentar_a_demo-2457D6?style=for-the-badge" alt="Experimentar a demo" height="34" /></a>
</p>

<p align="center">
  <sub>Dados inventados numa conta descartável, que é apagada quando você para de usá-la. <a href="docs/demo.md">O que é a demo</a> (em inglês).</sub>
</p>

<p align="center">
  <a href="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml"><img src="https://github.com/easly1989/cloudbank/actions/workflows/ci.yml/badge.svg" alt="Status da CI" /></a>
  <a href="https://github.com/easly1989/cloudbank/issues"><img src="https://img.shields.io/github/issues/easly1989/cloudbank" alt="Issues abertas" /></a>
  <a href="https://github.com/easly1989/cloudbank/pkgs/container/cloudbank"><img src="https://img.shields.io/badge/ghcr.io-cloudbank-2496ED?logo=docker&logoColor=white" alt="Imagem do contêiner" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="Licença: AGPL v3" /></a>
</p>

---

**CloudBank** é um gerenciador de finanças pessoais gratuito, para você hospedar e usar no navegador: uma versão web, reescrita do zero, do excelente app de desktop [HomeBank](https://www.gethomebank.org/). Ele quer fazer tudo o que o HomeBank faz, mas pensado para o navegador: um único contêiner Docker que você mesmo gerencia, com os dados num banco SQLite num volume que você controla.

**Experimente antes:** a [demo](https://p01--cloudbank--7dcjw6mlmtky.code.run/) está a um clique, sem cadastro, com um ano de dados inventados. Ela é apagada depois de duas horas sem uso, então nada do que você digitar fica guardado.

## Por quê

O HomeBank é um app de desktop excelente, mas só de desktop. O CloudBank leva o mesmo jeito de trabalhar (contas, uma lista completa de lançamentos, agendamentos, orçamentos, relatórios detalhados e a importação de muitos formatos, inclusive o arquivo `.xhb` do HomeBank, em **leitura e escrita**) para uma interface web que você abre de qualquer dispositivo, enquanto os dados ficam no seu servidor.

O CloudBank é uma **reimplementação independente, em sala limpa**. Ele não copia nem usa código do HomeBank: do original olha só o comportamento documentado e os formatos de arquivo, e acompanha as versões do HomeBank, as atuais e as futuras. O CloudBank tem licença **AGPL-3.0** (o HomeBank, GPL-2+).

## Capturas de tela

|                 Visão geral                |          Lançamentos: ações sobre várias linhas selecionadas          |
| :--------------------------------------: | :---------------------------------------------------------: |
| ![Visão geral](docs/img/dashboard.png)     | ![Ações sobre várias linhas nos lançamentos](docs/img/register-bulk.png) |

|        Agendamentos: as contas do mês no calendário        |        Revisão: possíveis duplicatas da sincronização bancária        |
| :------------------------------------------------------: | :---------------------------------------------------------: |
| ![Calendário dos agendamentos](docs/img/schedules.png)  | ![Revisão](docs/img/review.png)                           |

|      Orçamento: planejado e gasto, a resposta primeiro      |      Categorias: cada lista é editada num painel lateral      |
| :--------------------------------------------------------: | :----------------------------------------------------------: |
| ![Orçamento](docs/img/budget.png)                              | ![Categorias](docs/img/categories.png)                         |

|                 Relatórios interativos                  |            Aparência: tema, cor, barra lateral            |
| :-------------------------------------------------: | :------------------------------------------------: |
| ![Relatórios](docs/img/reports.png)                     | ![Configurações](docs/img/settings.png)             |

|            Uma visão geral que você organiza do seu jeito             |    Importar e exportar: `.xhb` do HomeBank, backup e restauração    |
| :------------------------------------------------------: | :------------------------------------------------: |
| ![Personalizar a visão geral](docs/img/dashboard-customize.png) | ![Exportar](docs/img/export.png)             |

<sub>As capturas mostram os dados inventados da demo, em inglês.</sub>

## Recursos

- **Contas e lançamentos:** todos os tipos de conta do HomeBank, cada uma na sua moeda, com o saldo atual e o previsto. Os lançamentos são marcados como conferidos e conciliados, com divisões, tags e transferências; a lista de lançamentos tem filtros, colunas à escolha, ações sobre várias linhas, pesquisa e conciliação com o extrato.
- **Agendamentos e calendário:** o que se repete se registra sozinho, até três meses antes se você quiser. Um calendário mostra os vencimentos do mês com o status, o que falta pagar e o que vem pela frente; os modelos e as regras de classificação preenchem o resto.
- **Orçamento e relatórios:** para onde foi o dinheiro, o que entrou e o que saiu, o que as contas têm e terão, quanto custa um carro; por mês, trimestre ou ano, com visões salvas e downloads em CSV e PNG.
- **Metas de economia e veículos:** quanto você guardou, quanto guardar por mês para chegar a tempo, e quanto sobra livre; para cada veículo, o combustível, os quilômetros, o custo por quilômetro e o consumo.
- **Importar e exportar:** `.xhb` do HomeBank, QIF, OFX/QFX, CSV e CAMT.053 (ISO 20022) na entrada, com um assistente; `.xhb`, QIF e CSV na saída; backup e restauração da carteira.
- **Sincronização bancária:** os lançamentos novos chegam do banco, passam pelas suas regras e se mesclam com os que já existem em vez de aparecer duplicados. Com as suas próprias credenciais, via [SimpleFIN](https://www.simplefin.org/), [Enable Banking](https://enablebanking.com/) (UE e Reino Unido) e, de forma experimental, [Pluggy](https://pluggy.ai/) (América Latina).
- **E-mails do banco:** o CloudBank lê os avisos de pagamento de uma pasta de uma caixa: Outlook.com, Hotmail ou Live entrando na Microsoft, qualquer outra via IMAP com uma senha de app. Um padrão criado destacando um e-mail de verdade transforma cada um em um lançamento conferido, ou a IA o lê, depois de ocultar números de cartão e IBANs. A sincronização bancária mescla a própria linha com a do e-mail em vez de duplicá-la, e Revisão pergunta pelos que o banco nunca lançou. Só leitura, à escuta enquanto os e-mails chegam, e só de remetentes que o servidor de e-mail autenticou.
- **Várias moedas e usuários:** cotações manuais ou online (BCE), vários usuários gerenciados pelo administrador, carteiras compartilhadas; o app está em inglês e italiano, e em alemão, francês, espanhol e português do Brasil (beta).
- **Uma visão geral do seu jeito:** em cima, o que vem pela frente; embaixo, widgets que você posiciona e redimensiona como quiser, tema claro e escuro na sua cor preferida, barra lateral e navegação que você pode reordenar.
- **Segurança:** autenticação em dois fatores, login com SSO (OIDC), tokens de API revogáveis e segredos criptografados no banco de dados.
- **App instalável:** o CloudBank se instala no celular ou no computador como um app, com notificações push dos vencimentos, e avisa quando há uma versão nova.
- **IA opcional, com a sua própria chave:** sugestões de categoria e lançamentos escritos com as suas palavras (“café 3,50 ontem”).

## Início rápido

<!-- quick-start -->

Você precisa do [Docker](https://docs.docker.com/get-docker/) com o plugin Compose.
Crie um `docker-compose.yml` (ou copie [o do repositório](docker-compose.yml)):

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main # latest stable release (see tags below)
    container_name: cloudbank
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Set to "false" only for a plain-HTTP LAN install without TLS in front.
      CB_SECURE_COOKIES: "false"
    volumes:
      - cloudbank-data:/data

volumes:
  cloudbank-data:
```

Depois inicie-o e abra o app:

```bash
docker compose up -d
# open http://localhost:8080 and complete the first-run admin setup
```

Essa é toda a instalação: um contêiner, nenhum banco de dados externo. Os dados
ficam no volume `cloudbank-data` (um banco SQLite em `/data`). Para fazer uma
cópia, copie esse volume, ou use o **backup da carteira** no app
(Configurações › Importação e exportação) e a **cópia completa** do administrador:
[docs/backup.md](docs/backup.md) explica o que cada uma contém e como restaurá-la.

Depois siga o [Getting started](docs/getting-started.md): o administrador, uma
carteira, as contas e as categorias, os primeiros lançamentos.

Vai colocá-lo atrás de HTTPS (recomendado para tudo o que vá além de uma rede
doméstica de confiança)? Veja [docs/reverse-proxy.md](docs/reverse-proxy.md). Vem
do HomeBank no desktop? Veja [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).

<!-- /quick-start -->

## O resto, em inglês

A configuração (as variáveis `CB_*`), as imagens do contêiner e o significado das tags, a instalação como app e todos os guias estão no [README em inglês](README.md) e em [docs/](docs/README.md). Atenção às tags: `:main` é a última versão estável, `:latest` o build noturno.

## Licença

O CloudBank tem licença **GNU Affero General Public License v3.0**: veja [LICENSE](LICENSE). Se você oferece uma versão modificada como serviço em rede, a AGPL pede que você disponibilize o código-fonte dela aos usuários.

## Apoie o projeto

O CloudBank é um projeto de código aberto feito com paixão. Se ele for útil para você,
pense em fazer uma doação: ajuda de verdade e é muito bem-vinda. ♥
O jeito mais simples é o [**Buy Me a Coffee**](https://buymeacoffee.com/easly1989).
Se preferir outra forma, a
[página de doações](https://easly1989.github.io/donate.html) reúne todas:
[PayPal](https://paypal.me/carloruggiero),
[Stripe](https://buy.stripe.com/8x26oAeqA7h6dPk80hfbq00),
[Liberapay](https://liberapay.com/amon2126/donate) ou
[GitHub Sponsors](https://github.com/sponsors/easly1989).

---

<sub>Alinhado ao README da v3.8.0.</sub>
