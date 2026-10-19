package moneyalert

// alertText is the wording of the money notifications, one per language
// (internal/locale's codes); a test asks every listed language for an entry.
// Each body has a private form without the amounts, for the channels outside
// the app of someone who wants none there.
type alertText struct {
	largeTitle, large, largeBare, largePrivate string // %[1]s amount, %[2]s account, %[3]s payee or memo
	lowTitle, low, lowPrivate                  string // %[1]s account, %[2]s balance, %[3]s threshold
	budget80Title, budget100Title, budget      string // %[1]s category, %[2]s spent, %[3]s budget
	budget80Private, budget100Private          string // %s category
	reachedTitle, reached, reachedPrivate      string // %[1]s goal, %[2]s target
	behindTitle, behind, behindPrivate         string // %[1]s goal, %[2]s monthly share, %[3]s pace
}

var alertTexts = map[string]alertText{
	"en": {
		largeTitle: "Large expense", large: "%[1]s on %[2]s: %[3]s.", largeBare: "%[1]s on %[2]s.",
		largePrivate: "An expense over the threshold on %s.",
		lowTitle:     "Low balance", low: "%[1]s is at %[2]s, below %[3]s.", lowPrivate: "%s is below its threshold.",
		budget80Title: "Budget at 80%", budget100Title: "Budget used up", budget: "%[1]s: %[2]s of %[3]s this month.",
		budget80Private: "%s has used 80%% of this month's budget.", budget100Private: "%s has used up this month's budget.",
		reachedTitle: "Goal reached", reached: "%[1]s reached its target of %[2]s.", reachedPrivate: "%s reached its target.",
		behindTitle: "Goal falling behind", behind: "%[1]s needs %[2]s a month; lately %[3]s went in.",
		behindPrivate: "%s is falling behind its pace.",
	},
	"it": {
		largeTitle: "Uscita grande", large: "%[1]s su %[2]s: %[3]s.", largeBare: "%[1]s su %[2]s.",
		largePrivate: "Un’uscita oltre la soglia su %s.",
		lowTitle:     "Saldo basso", low: "%[1]s è a %[2]s, sotto %[3]s.", lowPrivate: "%s è sotto la sua soglia.",
		budget80Title: "Budget all’80%", budget100Title: "Budget esaurito", budget: "%[1]s: %[2]s su %[3]s questo mese.",
		budget80Private: "%s ha usato l’80%% del budget del mese.", budget100Private: "%s ha esaurito il budget del mese.",
		reachedTitle: "Obiettivo raggiunto", reached: "%[1]s ha raggiunto il traguardo di %[2]s.", reachedPrivate: "%s ha raggiunto il traguardo.",
		behindTitle: "Obiettivo in ritardo", behind: "%[1]s richiede %[2]s al mese; ultimamente ne sono entrati %[3]s.",
		behindPrivate: "%s è in ritardo sul suo ritmo.",
	},
	"es": {
		largeTitle: "Gasto grande", large: "%[1]s en %[2]s: %[3]s.", largeBare: "%[1]s en %[2]s.",
		largePrivate: "Un gasto por encima del umbral en %s.",
		lowTitle:     "Saldo bajo", low: "%[1]s está en %[2]s, por debajo de %[3]s.", lowPrivate: "%s está por debajo de su umbral.",
		budget80Title: "Presupuesto al 80%", budget100Title: "Presupuesto agotado", budget: "%[1]s: %[2]s de %[3]s este mes.",
		budget80Private: "%s ha usado el 80%% del presupuesto del mes.", budget100Private: "%s ha agotado el presupuesto del mes.",
		reachedTitle: "Meta alcanzada", reached: "%[1]s ha alcanzado su objetivo de %[2]s.", reachedPrivate: "%s ha alcanzado su objetivo.",
		behindTitle: "Meta con retraso", behind: "%[1]s necesita %[2]s al mes; últimamente han entrado %[3]s.",
		behindPrivate: "%s va por detrás de su ritmo.",
	},
	"fr": {
		largeTitle: "Grosse dépense", large: "%[1]s sur %[2]s : %[3]s.", largeBare: "%[1]s sur %[2]s.",
		largePrivate: "Une dépense au-dessus du seuil sur %s.",
		lowTitle:     "Solde bas", low: "%[1]s est à %[2]s, sous %[3]s.", lowPrivate: "%s est sous son seuil.",
		budget80Title: "Budget à 80 %", budget100Title: "Budget épuisé", budget: "%[1]s : %[2]s sur %[3]s ce mois-ci.",
		budget80Private: "%s a utilisé 80 %% du budget du mois.", budget100Private: "%s a épuisé le budget du mois.",
		reachedTitle: "Objectif atteint", reached: "%[1]s a atteint son objectif de %[2]s.", reachedPrivate: "%s a atteint son objectif.",
		behindTitle: "Objectif en retard", behind: "%[1]s demande %[2]s par mois ; ces derniers temps, %[3]s y sont entrés.",
		behindPrivate: "%s prend du retard sur son rythme.",
	},
	"de": {
		largeTitle: "Große Ausgabe", large: "%[1]s auf %[2]s: %[3]s.", largeBare: "%[1]s auf %[2]s.",
		largePrivate: "Eine Ausgabe über der Schwelle auf %s.",
		lowTitle:     "Niedriger Kontostand", low: "%[1]s steht bei %[2]s, unter %[3]s.", lowPrivate: "%s liegt unter seiner Schwelle.",
		budget80Title: "Budget zu 80 % genutzt", budget100Title: "Budget aufgebraucht", budget: "%[1]s: %[2]s von %[3]s in diesem Monat.",
		budget80Private: "%s hat 80 %% des Monatsbudgets genutzt.", budget100Private: "%s hat das Monatsbudget aufgebraucht.",
		reachedTitle: "Sparziel erreicht", reached: "%[1]s hat sein Ziel von %[2]s erreicht.", reachedPrivate: "%s hat sein Ziel erreicht.",
		behindTitle: "Sparziel im Rückstand", behind: "%[1]s braucht %[2]s im Monat; zuletzt kamen %[3]s dazu.",
		behindPrivate: "%s fällt hinter sein Tempo zurück.",
	},
	"pt-BR": {
		largeTitle: "Gasto grande", large: "%[1]s em %[2]s: %[3]s.", largeBare: "%[1]s em %[2]s.",
		largePrivate: "Um gasto acima do limite em %s.",
		lowTitle:     "Saldo baixo", low: "%[1]s está em %[2]s, abaixo de %[3]s.", lowPrivate: "%s está abaixo do limite.",
		budget80Title: "Orçamento em 80%", budget100Title: "Orçamento esgotado", budget: "%[1]s: %[2]s de %[3]s este mês.",
		budget80Private: "%s usou 80%% do orçamento do mês.", budget100Private: "%s esgotou o orçamento do mês.",
		reachedTitle: "Meta alcançada", reached: "%[1]s alcançou o alvo de %[2]s.", reachedPrivate: "%s alcançou o alvo.",
		behindTitle: "Meta atrasada", behind: "%[1]s precisa de %[2]s por mês; ultimamente entraram %[3]s.",
		behindPrivate: "%s está atrás do ritmo.",
	},
}

// watchText is the wording of the review reminder and the summaries (#692),
// one per language; a test asks every listed language for an entry. The
// Review page is called by its name in the app's menu.
type watchText struct {
	reviewTitle           string
	reviewOne, reviewMany string // %[1]d how many (many only), then the wait
	day, days             string // the wait: one day, %d days
	weekTitle, monthTitle string
	weekPrivate           string // %s wallet
	monthPrivate          string // %s wallet
	inOut                 string // %[1]s wallet, %[2]s in, %[3]s out
	prevWeek, prevMonth   string // %s out in the period before
	top                   string // %s the categories that took most
	billsOne, billsMany   string // %d bills in the next seven days
}

var watchTexts = map[string]watchText{
	"en": {
		reviewTitle: "Transactions to review",
		reviewOne:   "A transaction has waited in Review for more than %s.",
		reviewMany:  "%[1]d transactions have waited in Review for more than %[2]s.",
		day:         "a day", days: "%d days",
		weekTitle: "Your week", monthTitle: "Your month",
		weekPrivate: "The week's summary of %s is ready.", monthPrivate: "The month's summary of %s is ready.",
		inOut:    "%[1]s: %[2]s in, %[3]s out.",
		prevWeek: "The week before: %s out.", prevMonth: "The month before: %s out.",
		top:      "Most went to %s.",
		billsOne: "Next 7 days: one bill.", billsMany: "Next 7 days: %d bills.",
	},
	"it": {
		reviewTitle: "Transazioni da rivedere",
		reviewOne:   "Una transazione aspetta in Revisione da più di %s.",
		reviewMany:  "%[1]d transazioni aspettano in Revisione da più di %[2]s.",
		day:         "un giorno", days: "%d giorni",
		weekTitle: "La tua settimana", monthTitle: "Il tuo mese",
		weekPrivate: "Il riepilogo della settimana di %s è pronto.", monthPrivate: "Il riepilogo del mese di %s è pronto.",
		inOut:    "%[1]s: entrate %[2]s, uscite %[3]s.",
		prevWeek: "La settimana prima: uscite %s.", prevMonth: "Il mese prima: uscite %s.",
		top:      "Di più per %s.",
		billsOne: "Prossimi 7 giorni: una scadenza.", billsMany: "Prossimi 7 giorni: %d scadenze.",
	},
	"es": {
		reviewTitle: "Movimientos por revisar",
		reviewOne:   "Un movimiento espera en Revisar desde hace más de %s.",
		reviewMany:  "%[1]d movimientos esperan en Revisar desde hace más de %[2]s.",
		day:         "un día", days: "%d días",
		weekTitle: "Tu semana", monthTitle: "Tu mes",
		weekPrivate: "El resumen de la semana de %s está listo.", monthPrivate: "El resumen del mes de %s está listo.",
		inOut:    "%[1]s: ingresos %[2]s, gastos %[3]s.",
		prevWeek: "La semana anterior: gastos %s.", prevMonth: "El mes anterior: gastos %s.",
		top:      "Lo que más: %s.",
		billsOne: "Próximos 7 días: un vencimiento.", billsMany: "Próximos 7 días: %d vencimientos.",
	},
	"fr": {
		reviewTitle: "Opérations à vérifier",
		reviewOne:   "Une opération attend dans « À vérifier » depuis plus de %s.",
		reviewMany:  "%[1]d opérations attendent dans « À vérifier » depuis plus de %[2]s.",
		day:         "un jour", days: "%d jours",
		weekTitle: "Votre semaine", monthTitle: "Votre mois",
		weekPrivate: "Le récapitulatif de la semaine de %s est prêt.", monthPrivate: "Le récapitulatif du mois de %s est prêt.",
		inOut:    "%[1]s : entrées %[2]s, sorties %[3]s.",
		prevWeek: "La semaine précédente : sorties %s.", prevMonth: "Le mois précédent : sorties %s.",
		top:      "Le plus pour %s.",
		billsOne: "7 prochains jours : une échéance.", billsMany: "7 prochains jours : %d échéances.",
	},
	"de": {
		reviewTitle: "Buchungen zu prüfen",
		reviewOne:   "Eine Buchung wartet seit mehr als %s unter „Prüfen“.",
		reviewMany:  "%[1]d Buchungen warten seit mehr als %[2]s unter „Prüfen“.",
		day:         "einem Tag", days: "%d Tagen",
		weekTitle: "Deine Woche", monthTitle: "Dein Monat",
		weekPrivate: "Die Wochenübersicht von %s ist fertig.", monthPrivate: "Die Monatsübersicht von %s ist fertig.",
		inOut:    "%[1]s: Einnahmen %[2]s, Ausgaben %[3]s.",
		prevWeek: "Die Woche davor: Ausgaben %s.", prevMonth: "Der Monat davor: Ausgaben %s.",
		top:      "Am meisten für %s.",
		billsOne: "Nächste 7 Tage: eine Fälligkeit.", billsMany: "Nächste 7 Tage: %d Fälligkeiten.",
	},
	"pt-BR": {
		reviewTitle: "Lançamentos para revisar",
		reviewOne:   "Um lançamento espera em Revisão há mais de %s.",
		reviewMany:  "%[1]d lançamentos esperam em Revisão há mais de %[2]s.",
		day:         "um dia", days: "%d dias",
		weekTitle: "Sua semana", monthTitle: "Seu mês",
		weekPrivate: "O resumo da semana de %s está pronto.", monthPrivate: "O resumo do mês de %s está pronto.",
		inOut:    "%[1]s: entradas %[2]s, saídas %[3]s.",
		prevWeek: "A semana anterior: saídas %s.", prevMonth: "O mês anterior: saídas %s.",
		top:      "O que mais pesou: %s.",
		billsOne: "Próximos 7 dias: um vencimento.", billsMany: "Próximos 7 dias: %d vencimentos.",
	},
}
