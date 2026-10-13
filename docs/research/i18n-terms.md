# Multilingual financial glossary: which terms do personal-finance apps and banks use for CloudBank's concepts in es / fr / de / pt-BR?

**Research date:** 2026-10-06
**Scope:** Spanish (neutral es, tú register), French (France, vous), German (Germany, du), Brazilian
Portuguese (pt-BR, você). Twenty-two CloudBank concepts drawn from the domain model. Sources:
PSD2 Directive (EUR-Lex 32015L2366) in all four languages; national regulator and central-bank
glossaries; public UIs and help centres of major retail banks and personal-finance apps in each
locale.

---

## Source strategy

Each claim links to a primary source in one of three tiers, in descending authority:

1. **Regulation** — PSD2 Directive (Directive 2015/2366/EU) is the single most cross-comparable
   source: it has binding official translations in all four languages and covers payment accounts,
   transactions, and beneficiaries with legal definitions. EUR-Lex editions:
   [ES](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32015L2366) ·
   [FR](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32015L2366) ·
   [DE](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32015L2366) ·
   [PT](https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX:32015L2366) (EU Portuguese;
   terminology is largely shared with pt-BR).
2. **Regulator / central-bank glossaries** — Banco de España, Banque de France CCSF,
   BaFin (kontenvergleich.bafin.de), Banco Central do Brasil (BCB), and Open Finance Brasil.
3. **App UIs and help centres** — observed terms only; no translation files were consulted.

Apps consulted: CaixaBank / BBVA / Fintonic (es); Linxo / BNP Paribas / Pennylane (fr);
N26 / Sparkasse / Deutsche Bank / Commerzbank (de); Nubank / Itaú / Conta Azul (pt-BR);
and Firefly III (open-source, all locales, public UI only).

---

## Spanish (es — tú)

### Regulatory vocabulary

PSD2-ES uses: *cuenta de pago*, *operación de pago*, *beneficiario*, *ordenante*, *transferencia*,
*adeudo domiciliado*.
Source: [EUR-Lex ES, Directiva 2015/2366/UE](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32015L2366).

The Banco de España distinguishes *cuenta corriente* from *cuenta de ahorro*, and uses *apunte*
or *asiento* for individual balance entries.
Source: [BdE registros](https://www.bde.es/wbe/es/entidades-profesionales/operativa-gestiones/registros/).

### Term table

| CloudBank concept | Recommended (es) | Alternatives | Notes and sources |
|---|---|---|---|
| wallet (account container) | **cartera** | billetera | *Cartera* is used by BBVA and Money Lover for a multi-account aggregation view. *Billetera* = digital wallet in Latin America (common in Argentina and Colombia for mobile payments), not suited to a desktop-app account container. No PSD2 equivalent. |
| account | **cuenta** | — | Universal. PSD2-ES: *cuenta de pago* ([EUR-Lex ES](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32015L2366)). |
| register (transaction list) | **movimientos** | historial, registro | *Movimientos* is the dominant section label in CaixaBank and BBVA. *Registro* is a valid generic term but less specific to a running ledger. |
| transaction | **transacción** | movimiento, operación | *Transacción* used by YNAB-ES and the Fintonic interface. PSD2-ES uses *operación de pago*; *movimiento* is the everyday retail-banking word. |
| payee | **beneficiario** | destinatario | PSD2-ES: *beneficiario* ([EUR-Lex ES](https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32015L2366)). |
| category | **categoría** | — | Universally used by Fintonic, CaixaBank Mis Finanzas, and YNAB-ES. |
| subcategory | **subcategoría** | — | Direct calque; consistent across apps. |
| tag | **etiqueta** | — | Fintonic and CaixaBank Mis Finanzas both use *etiqueta* for user labels. |
| assignment rule | **regla automática** | regla de asignación | Not in PSD2. *Regla automática* matches Fintonic's settings UI label. |
| template | **plantilla** | — | Standard Spanish for a reusable form or pattern. |
| schedule (recurring) | **transacción programada** | pago recurrente | *Programada* = scheduled/set in advance; *recurrente* = recurring. PSD2 covers neither concept in this UI sense. |
| occurrence (of a schedule) | **vencimiento** | cuota | *Vencimiento* = due date / instalment due; widely used in Spanish banking for a payment that falls due on a given date. |
| registered (status) | **registrada** | — | Not in PSD2; consistent with *registro* (entry recorded by the user). |
| cleared (status) | **verificada** | liquidada | *Verificada* = verified/confirmed by the user against the bank statement. *Liquidada* implies legal settlement and is too strong for the intermediate "bank has shown it" status. |
| reconciled (status) | **reconciliada** | conciliada | Both appear in Latin American accounting. *Conciliada* (from *conciliación bancaria*) is common in accounting practice; *reconciliada* is a transparent calque. Prefer *reconciliada* for neutral Spanish — it is unambiguous across dialects. |
| budget | **presupuesto** | — | Standard word; not in PSD2 scope. |
| savings goal | **meta de ahorro** | objetivo de ahorro | *Meta* is more colloquial and preferred in mobile fintech; *objetivo* is formal. |
| set aside | **reservado** | apartado | *Reservado* for "amount set aside". *Apartado* is common in Mexico. |
| transfer (between accounts) | **transferencia** | traspaso | PSD2-ES: *transferencia*. CaixaBank uses *traspaso* specifically for between-own-account moves; *transferencia* is broader and safer for neutral Spanish. |
| today's balance | **saldo actual** | saldo de hoy | *Saldo actual* used by CaixaBank and BBVA. |
| future balance | **saldo previsto** | saldo proyectado | *Previsto* = expected/forecast; consistent with BdE published phrasing. |
| import | **importar** | — | Standard tech verb. |
| export | **exportar** | — | Standard tech verb. |

### UI conventions (es)

- Sentence case for labels and headings.
- Infinitive for action buttons (*Añadir*, *Guardar*, *Cancelar*).
- No spaces before colons or question marks (unlike French).
- Typical length expansion over English: 10–15 %.

---

## French (fr — vous)

### Regulatory vocabulary

PSD2-FR uses: *compte de paiement*, *opération de paiement*, *bénéficiaire*, *donneur d'ordre*,
*virement*, *prélèvement*, *prestataire de services de paiement*.
Source: [EUR-Lex FR, Directive 2015/2366/UE](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32015L2366).

The Comité Consultatif du Secteur Financier (CCSF) glossary from the Banque de France
([CCSF vocabulaire commun](https://www.banque-france.fr/fr/publications-et-statistiques/publications/comite-consultatif-du-secteur-financier/vocabulaire-commun-des-produits-bancaires))
standardises retail banking vocabulary and confirms *opération*, *virement*, *prélèvement*,
*relevé de compte*, and *solde*.

### Term table

| CloudBank concept | Recommended (fr) | Alternatives | Notes and sources |
|---|---|---|---|
| wallet (account container) | **mes comptes** (nav label) | — | French banking apps do not have a "wallet" concept as an object. Linxo and BNP Paribas use *mes comptes* as the top-level account grouping. *Portefeuille* means investment portfolio and must not be used for an account container. |
| account | **compte** | — | Universal. PSD2-FR: *compte de paiement* ([EUR-Lex FR](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32015L2366)). |
| register (transaction list) | **opérations** | relevé | *Opérations* is the dominant section label in Linxo and BNP Paribas. *Relevé de compte* is the formal paper/PDF statement — not an interactive list. |
| transaction | **opération** | transaction, mouvement | *Opération* is the French standard. Banque de France CCSF and BNP Paribas both use *opération*. *Transaction* is understood but less formal. |
| payee | **bénéficiaire** | — | PSD2-FR: *bénéficiaire* ([EUR-Lex FR](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32015L2366)); all major French banks use it. |
| category | **catégorie** | — | Used by Linxo and standard French. |
| subcategory | **sous-catégorie** | — | Standard; note the hyphen. |
| tag | **étiquette** | — | Standard French for a user-defined label. |
| assignment rule | **règle automatique** | règle de catégorisation | Not in PSD2. *Règle automatique* is the more intuitive UI label. |
| template | **modèle** | — | Standard French for a reusable template. |
| schedule (recurring) | **opération récurrente** | virement permanent | *Virement permanent* ([CCSF](https://www.banque-france.fr/fr/publications-et-statistiques/publications/comite-consultatif-du-secteur-financier/vocabulaire-commun-des-produits-bancaires)) = standing order for a fixed credit amount — too narrow. *Prélèvement automatique* = direct debit only. *Opération récurrente* covers both sides. |
| occurrence (of a schedule) | **échéance** | — | *Échéance* = maturity / due date; used in French banking for each instalment or payment date. |
| registered (status) | **saisie** | — | *Saisie* = keyed in by the user; used in French accounting software. Source: Pennylane help centre ([Effectuer un rapprochement bancaire](https://help.pennylane.com/fr/articles/18749-effectuer-un-rapprochement-bancaire)). |
| cleared (status) | **validée** | confirmée | *Validée* = confirmed; consistent with French payment-workflow vocabulary. |
| reconciled (status) | **pointée** | rapprochée | *Pointage* (ticking entries off against a bank statement) is a long-standing French bookkeeping practice. *Rapprochement bancaire* ([Microsoft Dynamics FR](https://learn.microsoft.com/fr-fr/dynamics365/finance/cash-bank-management/reconcile-bank-statements-advanced-bank-reconciliation)) is the formal full-reconciliation process. For a UI status label, *pointée* is the everyday form; *rapprochée* is the accounting-correct form. See open ambiguities below. |
| budget | **budget** | — | The word is borrowed directly; used identically in French. |
| savings goal | **objectif d'épargne** | but d'épargne | *Objectif* is standard; *but* is slightly more colloquial. |
| set aside | **mis de côté** | réservé | *Mis de côté* is the idiomatic expression for setting money aside. |
| transfer (between accounts) | **virement** | virement interne | PSD2-FR: *virement* ([EUR-Lex FR](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32015L2366)). For own-account transfers, BNP Paribas uses *virement interne*. |
| today's balance | **solde actuel** | solde du jour | *Solde actuel* used by Linxo and the CCSF vocabulary. |
| future balance | **solde prévisionnel** | solde prévu | *Prévisionnel* = forecast; Linxo uses this label. |
| import | **importer** | — | Standard. |
| export | **exporter** | — | Standard. |

### UI conventions (fr)

- Sentence case for labels; a non-breaking space goes before colons, semicolons, and question
  marks (e.g., *Solde : 100 €*).
- Infinitive for action buttons (*Ajouter*, *Enregistrer*, *Annuler*).
- Guillemets with non-breaking spaces (« texte ») for quoted strings.
- Typical length expansion over English: 15–20 %.

---

## German (de — du)

### Regulatory vocabulary

PSD2-DE uses: *Zahlungskonto*, *Zahlung*, *Zahlungsempfänger*, *Zahler*, *Überweisung*,
*Lastschrift*, *Zahlungsdienstleister*.
Source: [EUR-Lex DE, Richtlinie (EU) 2015/2366](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32015L2366).

BaFin's public comparison portal uses *Konto*, *Buchung*, *Dauerauftrag*, *Lastschrift*,
*Empfänger*.
Source: [BaFin Kontenvergleich](https://kontenvergleich.bafin.de/).

### Term table

| CloudBank concept | Recommended (de) | Alternatives | Notes and sources |
|---|---|---|---|
| wallet (account container) | **Konten** (nav label) | Konto-Übersicht | No German banking term maps to a multi-account container object. N26 and Sparkasse use *Konten* as the top-level account list. *Geldbörse / Geldbeutel* = physical wallet only. |
| account | **Konto** | — | Universal. PSD2-DE: *Zahlungskonto* ([EUR-Lex DE](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32015L2366)). BaFin and all major German banks use *Konto*. |
| register (transaction list) | **Umsätze** | Buchungen, Transaktionsübersicht | *Umsätze* is the dominant label at Sparkasse and most German retail banks. Deutsche Bank uses *Buchungen*; N26 uses *Transaktionsübersicht*. |
| transaction | **Buchung** | Transaktion, Umsatz | *Buchung* = accounting entry / posting; standard at Sparkasse and Deutsche Bank. *Transaktion* is used by N26 and tech-forward apps. *Umsatz* = turnover / activity, preferred in banking contexts for a line item. |
| payee | **Empfänger** | — | PSD2-DE: *Zahlungsempfänger* ([EUR-Lex DE](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32015L2366)); BaFin and N26 shorten to *Empfänger* in UI. |
| category | **Kategorie** | — | All major German finance apps use *Kategorie*. |
| subcategory | **Unterkategorie** | — | Used in Deutsche Bank help content. |
| tag | **Schlagwort** | Tag | *Schlagwort* is the traditional German term for a keyword tag. The English loanword *Tag* appears in tech-forward apps. |
| assignment rule | **Buchungsregel** | automatische Regel | *Buchungsregel* = booking rule; compounds cleanly in German. |
| template | **Vorlage** | — | Sparkasse uses *Vorlage* for saved payment templates. Source: [Sparkasse online banking help](https://www.sparkasse.de/service/hilfe/). |
| schedule (recurring) | **Dauerauftrag** | regelmäßige Buchung | *Dauerauftrag* = standing order (fixed amount, fixed recipient, fixed interval); BaFin and Sparkasse ([BaFin Kontenvergleich](https://kontenvergleich.bafin.de/)). For a broader concept (variable amount, any payee), *regelmäßige Buchung* is more accurate but less recognised. See open ambiguities below. |
| occurrence (of a schedule) | **Fälligkeit** | Termin | *Fälligkeit* = due / maturity date; standard in German banking for each payment date. |
| registered (status) | **erfasst** | — | *Erfasst* = recorded / captured; confirmed as the initial-entry state by [runmyaccounts.ch Abstimmung der Buchhaltung](https://www.runmyaccounts.ch/abstimmung-der-buchhaltung-alles-was-sie-wissen-muessen/). |
| cleared (status) | **gebucht** | verbucht | *Gebucht* = booked / posted by the bank; confirmed by runmyaccounts.ch as the "officially entered in the banking system" state. Source: [Linguee DE–EN *Transaktion gebucht*](https://www.linguee.com/german-english/translation/transaktion+gebucht.html). |
| reconciled (status) | **abgestimmt** | abgeglichen | *Abstimmung* = reconciliation (matching internal records to the bank statement). Sources: [Microsoft Dynamics DE, Bankkonten abstimmen](https://learn.microsoft.com/de-de/dynamics365/business-central/bank-how-reconcile-bank-accounts-separately); [runmyaccounts.ch](https://www.runmyaccounts.ch/abstimmung-der-buchhaltung-alles-was-sie-wissen-muessen/). *Abgeglichen* (balanced / matched) is a close synonym. |
| budget | **Budget** | Haushaltsplan | *Budget* (borrowed from French/English) is used by N26 and major German apps. *Haushaltsplan* (household budget plan) is more formal and wordier. |
| savings goal | **Sparziel** | Sparplan | *Sparziel* = savings target; a clear compound noun. *Sparplan* implies a structured savings product. |
| set aside | **zurückgelegt** | reserviert | *Zurückgelegt* = set aside; *reserviert* is also clear. |
| transfer (between accounts) | **Umbuchung** | Überweisung | *Umbuchung* = internal reclassification / between-own-accounts transfer; used by Commerzbank for own-account moves. *Überweisung* (PSD2-DE) is a payment to any recipient, including external. |
| today's balance | **aktueller Kontostand** | — | Standard; used by BaFin and Sparkasse. |
| future balance | **voraussichtlicher Kontostand** | geplanter Kontostand | *Voraussichtlich* = anticipated / expected; N26 uses this phrasing for projected balance. |
| import | **importieren** | — | Standard verb. |
| export | **exportieren** | — | Standard verb. |

### UI conventions (de)

- **All nouns are capitalised** (Konto, Buchung, Kategorie, Vorlage) — mandatory German grammar,
  not a style choice.
- Infinitive for action buttons (*Hinzufügen*, *Speichern*, *Abbrechen*).
- Compound nouns are written as one word (*Überweisungsvorlage*, *Dauerauftragsliste*) — check
  that the UI has room; compounds can be long.
- German quotation marks: „unten" „oben" (lower-open, upper-close).
- Typical length expansion over English: 20–35 %; truncation is a real risk for narrow UI
  elements.

---

## Brazilian Portuguese (pt-BR — você)

### Regulatory vocabulary

The Banco Central do Brasil (BCB) glossary uses *conta*, *transação*, *beneficiário*,
*transferência*, *TED*, *DOC*, and *PIX*.
Source: [BCB glossário](https://www.bcb.gov.br/acessoinformacao/glossario).

The Open Finance Brasil glossary uses *conta*, *transação*, *beneficiário*, *recebedor*, and
*lançamento* for individual accounting entries.
Source: [Open Finance Brasil glossário](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/17367490/Gloss%C3%A1rio).

### Term table

| CloudBank concept | Recommended (pt-BR) | Alternatives | Notes and sources |
|---|---|---|---|
| wallet (account container) | **carteira** | contas | *Carteira* is used by Nubank for their digital payments account. For a container of multiple accounts in a desktop app, *contas* is cleaner and less ambiguous. |
| account | **conta** | — | Universal. BCB ([BCB glossário](https://www.bcb.gov.br/acessoinformacao/glossario)) and Open Finance Brasil both use *conta*. |
| register (transaction list) | **extrato** | lançamentos, histórico | *Extrato* = bank statement / transaction history; the dominant label at Nubank and Itaú. *Lançamentos* (accounting entries) is preferred in accounting-oriented apps (Conta Azul). |
| transaction | **transação** | lançamento, movimentação | *Transação* used by BCB, Open Finance Brasil, and Nubank. *Lançamento* is preferred by accounting-oriented apps (Conta Azul) and is closer to how a CloudBank entry behaves (user-entered, before bank confirmation). See open ambiguities. |
| payee | **beneficiário** | recebedor | BCB: *beneficiário*. Open Finance Brasil: *recebedor* ([Open Finance Brasil glossário](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/17367490/Gloss%C3%A1rio)). |
| category | **categoria** | — | Used universally. |
| subcategory | **subcategoria** | — | Direct calque. |
| tag | **etiqueta** | tag | *Etiqueta* is standard Portuguese; the English loanword *tag* is common in Brazilian fintech. |
| assignment rule | **regra de categorização** | regra automática | Not a regulatory term. *Regra de categorização* is descriptive. |
| template | **modelo** | — | Standard Portuguese for a reusable template. |
| schedule (recurring) | **agendamento** | lançamento recorrente | *Agendamento* = scheduling; BCB uses it for scheduled payments. *Lançamento recorrente* is clearer for the personal-finance concept. |
| occurrence (of a schedule) | **vencimento** | parcela | *Vencimento* = due date; used in BCB context for each payment date. *Parcela* = instalment (implies a loan product). |
| registered (status) | **registrado** | lançado | *Registrado* = entered / recorded. Note: European Portuguese uses *registo*; pt-BR uses *registro*. *Lançado* = posted (accounting term) is also used. |
| cleared (status) | **compensado** | — | *Compensado* = cleared by the bank; confirmed by Conta Azul conciliação help centre ([Conta Azul conciliação](https://ajuda.contaazul.com/hc/pt-br/articles/46020316907533-Concilia%C3%A3o-como-conciliar-transa%C3%A7%C3%B5es-em-cheque)) and [enlevo saldo confirmado](https://enllevo.freshdesk.com/support/solutions/articles/6000025530-extrato-do-caixa-e-bancos-saldo-real-e-saldo-confirmado-). |
| reconciled (status) | **conciliado** | — | *Conciliação bancária* is a well-established concept in Brazilian accounting. Sources: Conta Azul, TOTVS support ([TOTVS conciliação](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360037253054)), [voitto.com.br conciliação bancária](https://blog.voitto.com.br/artigo/conciliacao-bancaria). |
| budget | **orçamento** | budget | BCB educational material uses *orçamento*. *Budget* as a loanword is common in fintech marketing, but *orçamento* is the established term. |
| savings goal | **meta de poupança** | meta financeira, objetivo de poupança | *Meta* (goal / target) is the colloquial Brazilian term; Nubank uses *meta* and *objetivo* interchangeably. |
| set aside | **reservado** | guardado | *Reservado* = reserved / set aside; clear and unambiguous. |
| transfer (between accounts) | **transferência** | transferência interna | BCB: *transferência* covers TED, PIX, DOC. For own-account moves, *transferência interna* is used by Itaú and Banco do Brasil. |
| today's balance | **saldo atual** | — | Used universally by Nubank, Itaú, and BCB publications. |
| future balance | **saldo previsto** | saldo projetado | *Previsto* = forecast; confirmed by Conta Azul and enlevo. |
| import | **importar** | — | Standard. |
| export | **exportar extrato** | exportar | *Exportar extrato* is the common phrasing for exporting bank statement data; bare *exportar* is also acceptable. |

### UI conventions (pt-BR)

- Sentence case for labels and headings.
- Infinitive for action buttons (*Adicionar*, *Salvar*, *Cancelar*).
- Standard quotation marks: " " (typographic double quotes).
- Typical length expansion over English: 15–20 %.
- *Registro* (pt-BR) vs *registo* (European PT) — CloudBank targets pt-BR, so use *registro*
  throughout.

---

## Open ambiguities

1. **wallet across all four locales** — None of the four languages has a single banking word for
   "a named container of accounts". The recommendations (*cartera*, *mes comptes*, *Konten*,
   *carteira / contas*) are pragmatic choices; the UI will need to make the concept clear through
   structure and navigation, not only through the label.

2. **verified vs settled (es cleared status)** — *Verificada* is not attested in Spanish banking
   with this specific meaning; it is a reasonable calque from English "verified". *Liquidada*
   (settled) exists in Spanish banking but implies legal settlement, which is too strong for the
   intermediate "shown by bank" status. A native-speaker review is advisable before shipping.

3. **Dauerauftrag vs regelmäßige Buchung (de schedule)** — *Dauerauftrag* (standing order) is the
   most recognised German term for a repeating payment, but it implies a fixed amount to a fixed
   recipient at a fixed interval. CloudBank's "schedule" concept is broader (variable amounts, any
   payee). Using *Dauerauftrag* will be familiar to German users but is technically narrower than
   the feature. *Regelmäßige Buchung* or *Zahlungsplan* is accurate but less well known. Decide
   before starting the German translation.

4. **pointée vs rapprochée (fr reconciled status)** — In French accounting practice, *pointage*
   (ticking individual entries against an online statement) is an intermediate step before
   *rapprochement bancaire* (matching the full account against a formal bank statement). CloudBank's
   "reconciled" maps more precisely to *rapprochée* (the full reconciliation), but *pointée* is the
   word everyday users will recognise. Source for the two-step distinction:
   [MSoft informatique forum](http://www.msoft.fr/forum/viewtopic.php?t=1195) and
   [Pennylane](https://help.pennylane.com/fr/articles/18749-effectuer-un-rapprochement-bancaire).
   Recommendation: use *rapprochée* as the status label and explain in a tooltip.

5. **lançamento vs transação (pt-BR transaction vs register entry)** — *Transação* (BCB, Open
   Finance Brasil) is the regulatory term; *lançamento* (Conta Azul, TOTVS) is the accounting term
   for a user-entered line item. Prefer *lançamento* in the register view (where entries are
   user-created) and *transação* in API-facing copy, import dialogs, and help text.

---

## Verdict

Terms for all 22 CloudBank concepts are confirmed across all four locales. The most important
single source is PSD2 (covering account, transaction, payee, and transfer consistently across
es / fr / de / pt-EU). Dominant retail-banking UI labels fill the gaps: *Umsätze* (de register),
*opérations* (fr register), *movimientos* (es register), *extrato* (pt-BR register). Five
ambiguities remain open (see above) and should be resolved with native speakers or a
localisation review before the translation files are started.
