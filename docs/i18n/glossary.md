# Translation glossary

The words CloudBank uses for its own ideas, in every language it speaks, and the
style each translation follows. Translate against this page: a term that reads
differently on two screens is a bug, even when both readings are correct.

Decided in issue #596. The research behind the choices, with its sources, is
[docs/research/i18n-terms.md](../research/i18n-terms.md).

## What the words mean in CloudBank

- **Wallet:** a container of accounts, with its own categories, payees and
  rules. It can be shared between several users.
- **Transaction:** one row of an account.
- **Register:** the list of an account's transactions.
- **Cleared:** the bank shows it, even if it is not booked yet, or you ticked it
  yourself. It has not been checked against a statement. Bank sync saves
  *pending* transactions as cleared.
- **Reconciled:** checked against a statement. Bank sync saves *booked*
  transactions as reconciled.
- **Schedule:** a transaction that repeats, income or expense, with a fixed or a
  varying amount.
- **Occurrence:** one date a schedule falls on.
- **Registered:** the occurrence already has its transaction in the register.
- **Payee:** the other side of a transaction, whether it receives or pays.
- **Transfer:** money moved between two of your own accounts.
- **Set aside:** the part of a balance earmarked for goals.

## Terms

| en | it | es | fr | de | pt-BR |
|---|---|---|---|---|---|
| wallet | portafoglio | cartera | classeur | Haushaltsbuch | carteira |
| account | conto | cuenta | compte | Konto | conta |
| transaction | transazione | movimiento | opération | Buchung | lançamento |
| register | registro | movimientos | opérations | Buchungen | lançamentos |
| payee | beneficiario | beneficiario | tiers | Zahlungspartner | beneficiário |
| category / subcategory | categoria / sottocategoria | categoría / subcategoría | catégorie / sous-catégorie | Kategorie / Unterkategorie | categoria / subcategoria |
| tag | tag | etiqueta | étiquette | Tag | tag |
| rule | regola | regla | règle | Regel | regra |
| template | modello | plantilla | modèle | Vorlage | modelo |
| schedule | programmata | movimiento programado | opération récurrente | wiederkehrende Buchung | agendamento |
| occurrence | scadenza | vencimiento | échéance | Fälligkeit | vencimento |
| Schedules (the page) | Programmate | Programados | Échéancier | Wiederkehrend | Agendamentos |
| registered | registrata | registrado | saisie | erfasst | registrado |
| cleared | verificata | verificado | pointée | bestätigt | conferido |
| reconciled | riconciliata | conciliado | rapprochée | abgeglichen | conciliado |
| remind | promemoria | recordatorio | rappel | Erinnerung | lembrete |
| void | annullata | anulado | annulée | storniert | cancelado |
| budget | budget | presupuesto | budget | Budget | orçamento |
| goal | obiettivo | meta | objectif | Sparziel | meta |
| set aside | messo da parte | reservado | mis de côté | zurückgelegt | guardado |
| transfer | giroconto | transferencia | virement | Umbuchung | transferência |
| today / future balance | saldo di oggi / futuro | saldo actual / previsto | solde actuel / prévisionnel | Kontostand heute / künftig | saldo atual / previsto |

**Adjectives agree with the word for transaction**, or with the noun they
describe when it is another one:

- Spanish and Portuguese: masculine (verificado, conciliado, registrado).
- French: feminine (pointée, rapprochée, saisie).
- German: unchanged when used as a predicate.
- Italian: feminine beside *transazione* or *programmata*; a status shown on
  its own, as in the register's status menu, agrees with *stato* (Verificato,
  Riconciliato).

## Why, where there was a choice

- **Wallet.**
  - French: *portefeuille* suggests an investment portfolio, and *mes comptes*
    clashes with the accounts.
  - German: *Konten* is the accounts again, and *Geldbörse* is a purse.
    *Haushaltsbuch* is what this kind of app is called.
- **Cleared and reconciled.**
  - French: *pointer* is ticking a line on the statement; *rapprochement* is
    the full reconciliation.
  - German: *gebucht* would be wrong, because a cleared transaction can still be
    pending.
  - Portuguese: *compensado* would mean the bank has already settled it.
  - Spanish: *conciliación bancaria* is the accounting term in Spain and in
    Latin America.
- **Schedule in German:** *Dauerauftrag* is narrower: a fixed amount, and only
  money going out.
- **Payee:** French *tiers* and German *Zahlungspartner* work in both
  directions; Spanish and Portuguese follow the Italian habit.
- **Tag:** German and Portuguese keep *Tag*, which is more common in their
  apps and already used in Italian.

## Style

- **Address:** tú in Spanish, vous in French, du in German, você in Portuguese.
- **Variants:** neutral Spanish; Brazilian Portuguese.
- **Capitals:** sentence case everywhere. German capitalizes every noun.
- **Buttons:** the infinitive: Guardar, Enregistrer, Speichern, Salvar.
- **Quotation marks:** «» in Spanish and French, „“ in German, “” in
  Portuguese.
- **French spacing:** a non-breaking space before `: ; ? !` and inside « ».
- **German compounds:** check them wherever space is tight.
- **Length against English:** Spanish +10–15%, French and Portuguese +15–20%,
  German +20–35%. Check the narrow places (buttons, chips, the phone layout).
