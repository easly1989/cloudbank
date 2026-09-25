package demo

import (
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/easly1989/cloudbank/server/internal/importer"
)

// The demo wallet is described the way a HomeBank file describes one and goes
// through the importer, which already creates a whole wallet in a single
// transaction. Every date is counted back from today, so a demo opened on any
// day shows the year that ends on it; the numbers come from a fixed seed, so
// every visitor sees the same year.

// HomeBank's day numbering: 1970-01-01 is day 719163.
const julian1970 = 719163

func julian(t time.Time) int {
	return int(t.Sub(time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)).Hours()/24) + julian1970
}

// Keys of the seeded accounts, payees and categories.
const (
	accChecking = iota + 1
	accSavings
	accCard
	accCash
)

const (
	payEmployer = iota + 1
	payLandlord
	payEnergy
	payInternet
	paySupermarket
	payMarket
	payRestaurant
	payCafe
	payPetrol
	payTransit
	payStreaming
	payGym
	payPharmacy
	payClothes
	payBookshop
	payHotel
)

const (
	catIncome = iota + 1
	catSalary
	catOtherIncome
	catHome
	catRent
	catUtilities
	catInternet
	catFood
	catGroceries
	catRestaurants
	catTransport
	catFuel
	catTransit
	catLeisure
	catSubscriptions
	catSport
	catBooks
	catHolidays
	catHealth
	catClothing
	catGifts
)

// HomeBank payment modes and flags, as the importer reads them.
const (
	modeCard     = 1
	modeCash     = 3
	modeTransfer = 4
	modeInternal = 5
	modeDebit    = 6
	modeStanding = 7
	modeDeposit  = 9
	modeDirect   = 11

	flagIncome = 1 << 1
	flagBudget = 1 << 3

	asgDoCategory = 1 << 1
)

// words holds every name the seed shows, in English and Italian.
var words = map[string][2]string{
	"wallet":     {"Demo wallet", "Portafoglio demo"},
	"checking":   {"Checking", "Conto corrente"},
	"savings":    {"Savings", "Risparmi"},
	"card":       {"Credit card", "Carta di credito"},
	"cash":       {"Cash", "Contanti"},
	"bank":       {"Demo Bank", "Banca Demo"},
	"employer":   {"Employer", "Datore di lavoro"},
	"landlord":   {"Landlord", "Padrone di casa"},
	"energy":     {"Energy supplier", "Fornitore di energia"},
	"internet":   {"Internet provider", "Provider internet"},
	"super":      {"Supermarket", "Supermercato"},
	"market":     {"Local market", "Mercato rionale"},
	"restaurant": {"Restaurant", "Ristorante"},
	"cafe":       {"Café", "Bar"},
	"petrol":     {"Petrol station", "Distributore"},
	"transitPay": {"City transit", "Trasporto urbano"},
	"streaming":  {"Streaming service", "Servizio di streaming"},
	"gym":        {"Gym", "Palestra"},
	"pharmacy":   {"Pharmacy", "Farmacia"},
	"clothes":    {"Clothes shop", "Negozio di abbigliamento"},
	"bookshop":   {"Bookshop", "Libreria"},
	"hotel":      {"Seaside hotel", "Hotel al mare"},
	"income":     {"Income", "Entrate"},
	"salary":     {"Salary", "Stipendio"},
	"other":      {"Other income", "Altre entrate"},
	"home":       {"Home", "Casa"},
	"rent":       {"Rent", "Affitto"},
	"utilities":  {"Utilities", "Utenze"},
	"phone":      {"Internet & phone", "Internet e telefono"},
	"food":       {"Food", "Alimentari"},
	"groceries":  {"Groceries", "Spesa"},
	"eatingOut":  {"Restaurants", "Ristoranti"},
	"transport":  {"Transport", "Trasporti"},
	"fuel":       {"Fuel", "Carburante"},
	"transit":    {"Public transport", "Trasporto pubblico"},
	"leisure":    {"Leisure", "Tempo libero"},
	"subs":       {"Subscriptions", "Abbonamenti"},
	"sport":      {"Sport", "Sport"},
	"books":      {"Books", "Libri"},
	"holidays":   {"Holidays", "Vacanze"},
	"health":     {"Health", "Salute"},
	"clothing":   {"Clothing", "Abbigliamento"},
	"gifts":      {"Gifts", "Regali"},
	"tagHoliday": {"holiday", "vacanza"},
	"weekly":     {"Weekly shop", "Spesa settimanale"},
	"household":  {"Household items", "Articoli per la casa"},
	"topUp":      {"Monthly saving", "Risparmio mensile"},
	"payOff":     {"Card balance", "Saldo carta"},
	"withdraw":   {"Cash withdrawal", "Prelievo"},
	"pass":       {"Monthly pass", "Abbonamento mensile"},
	"bonus":      {"Bonus", "Premio"},
	"refund":     {"Refund", "Rimborso"},
	"goalTrip":   {"Summer trip", "Viaggio d'estate"},
	"goalBuffer": {"Rainy-day fund", "Fondo imprevisti"},
	"goalNote":   {"Made-up goal: change it, top it up, delete it.", "Obiettivo inventato: modificalo, aggiungi, eliminalo."},
}

// seeder builds the file for one language.
type seeder struct {
	lang  int // 0 = English, 1 = Italian
	today time.Time
	rng   *rand.Rand
	x     *importer.XHB
	kxfer int
	// card spending per month, paid off from checking the month after
	cardSpend map[time.Month]int64
	// amounts already booked, per account, with their dates (see unique)
	booked map[int]map[int64][]time.Time
}

// lookAlikeDays is how close two equal amounts on one account may fall before
// the review page calls them a suspected duplicate (duplicateFinderWindowDays
// in internal/transaction). The seed stays clear of it: a made-up year should
// not open with a dozen false alarms.
const lookAlikeDays = 14

// unique nudges an amount until no other on the account is equal to it within
// lookAlikeDays, and books it.
func (s *seeder) unique(account int, d time.Time, cents int64) int64 {
	for s.clash(account, d, cents) {
		cents -= 7
	}
	s.book(account, d, cents)
	return cents
}

func (s *seeder) clash(account int, d time.Time, cents int64) bool {
	for _, other := range s.booked[account][cents] {
		if gap := d.Sub(other).Hours() / 24; gap > -lookAlikeDays-1 && gap < lookAlikeDays+1 {
			return true
		}
	}
	return false
}

func (s *seeder) book(account int, d time.Time, cents int64) {
	if s.booked[account] == nil {
		s.booked[account] = map[int64][]time.Time{}
	}
	s.booked[account][cents] = append(s.booked[account][cents], d)
}

func (s *seeder) w(key string) string {
	v, ok := words[key]
	if !ok {
		panic("demo seed: no words for " + key)
	}
	return v[s.lang]
}

// amount renders cents as HomeBank writes an amount.
func amount(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}

// status is what a transaction of that age would be by now: reconciled once a
// statement has come and gone, cleared once the bank shows it, pending before.
func (s *seeder) status(d time.Time) int {
	age := int(s.today.Sub(d).Hours() / 24)
	switch {
	case age > 40:
		return 2
	case age > 4:
		return 1
	}
	return 0
}

// between returns a whole number of cents in [lo, hi].
func (s *seeder) between(lo, hi int64) int64 { return lo + s.rng.Int64N(hi-lo+1) }

type ope struct {
	date     time.Time
	account  int
	cents    int64
	mode     int
	payee    int
	category int
	memo     string
	tags     string
}

func (s *seeder) add(o ope) {
	if o.date.After(s.today) {
		return
	}
	o.cents = s.unique(o.account, o.date, o.cents)
	if o.account == accCard {
		s.cardSpend[o.date.Month()] += o.cents
	}
	s.x.Operations = append(s.x.Operations, importer.XOpe{
		Date: julian(o.date), Amount: amount(o.cents), Account: o.account, Paymode: o.mode,
		St: s.status(o.date), Payee: o.payee, Category: o.category, Wording: o.memo, Tags: o.tags,
	})
}

func (s *seeder) transfer(d time.Time, from, to int, cents int64, memo string) {
	if d.After(s.today) || cents <= 0 {
		return
	}
	// Both legs move together, so both must be clear.
	for s.clash(from, d, -cents) || s.clash(to, d, cents) {
		cents += 7
	}
	s.book(from, d, -cents)
	s.book(to, d, cents)
	s.kxfer++
	for _, leg := range []struct {
		acc, dst int
		amt      int64
	}{{from, to, -cents}, {to, from, cents}} {
		s.x.Operations = append(s.x.Operations, importer.XOpe{
			Date: julian(d), Amount: amount(leg.amt), Account: leg.acc, DstAccount: leg.dst,
			Paymode: modeInternal, St: s.status(d), Wording: memo, Kxfer: s.kxfer,
		})
	}
}

// split records one supermarket receipt that was partly food, partly household.
func (s *seeder) split(d time.Time, food, house int64) {
	if d.After(s.today) {
		return
	}
	food = -s.unique(accChecking, d, -(food+house)) - house
	s.x.Operations = append(s.x.Operations, importer.XOpe{
		Date: julian(d), Amount: amount(-(food + house)), Account: accChecking, Paymode: modeDebit,
		St: s.status(d), Payee: paySupermarket, Wording: s.w("weekly"),
		Scat: fmt.Sprintf("%d||%d", catGroceries, catHome),
		Samt: amount(-food) + "||" + amount(-house),
		Smem: s.w("groceries") + "||" + s.w("household"),
	})
}

// seedFile describes the demo wallet: a year of made-up money ending today.
func seedFile(today time.Time, italian bool) *importer.XHB {
	s := &seeder{
		today:     time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC),
		rng:       rand.New(rand.NewPCG(420, 2026)),
		x:         &importer.XHB{Version: "1.6"},
		cardSpend: map[time.Month]int64{},
		booked:    map[int]map[int64][]time.Time{},
	}
	if italian {
		s.lang = 1
	}
	x := s.x
	x.Properties = importer.XProperties{Title: s.w("wallet"), Curr: 1}
	x.Currencies = []importer.XCur{{
		Key: 1, ISO: "EUR", Name: "Euro", Symb: "€", Syprf: 0, Dchar: ",", Gchar: ".", Frac: 2, Rate: 1,
	}}
	x.Accounts = []importer.XAccount{
		{Key: accChecking, Pos: 1, Type: 1, Curr: 1, Name: s.w("checking"), Bankname: s.w("bank"), Initial: "1850.00", Minimum: "200.00"},
		{Key: accSavings, Pos: 2, Type: 1, Curr: 1, Name: s.w("savings"), Bankname: s.w("bank"), Initial: "6200.00"},
		{Key: accCard, Pos: 3, Type: 4, Curr: 1, Name: s.w("card"), Bankname: s.w("bank")},
		{Key: accCash, Pos: 4, Type: 2, Curr: 1, Name: s.w("cash"), Initial: "80.00"},
	}
	for key, name := range map[int]string{
		payEmployer: "employer", payLandlord: "landlord", payEnergy: "energy", payInternet: "internet",
		paySupermarket: "super", payMarket: "market", payRestaurant: "restaurant", payCafe: "cafe",
		payPetrol: "petrol", payTransit: "transitPay", payStreaming: "streaming", payGym: "gym",
		payPharmacy: "pharmacy", payClothes: "clothes", payBookshop: "bookshop", payHotel: "hotel",
	} {
		x.Payees = append(x.Payees, importer.XPayee{Key: key, Name: s.w(name)})
	}
	cat := func(key, parent, flags int, name string, budget int64) {
		c := importer.XCat{Key: key, Parent: parent, Flags: flags, Name: s.w(name)}
		if budget != 0 {
			c.Flags |= flagBudget
			c.B0 = amount(budget)
		}
		x.Categories = append(x.Categories, c)
	}
	cat(catIncome, 0, flagIncome, "income", 0)
	cat(catSalary, catIncome, flagIncome, "salary", 0)
	cat(catOtherIncome, catIncome, flagIncome, "other", 0)
	cat(catHome, 0, 0, "home", 0)
	cat(catRent, catHome, 0, "rent", 0)
	cat(catUtilities, catHome, 0, "utilities", -9000)
	cat(catInternet, catHome, 0, "phone", 0)
	cat(catFood, 0, 0, "food", 0)
	cat(catGroceries, catFood, 0, "groceries", -38000)
	cat(catRestaurants, catFood, 0, "eatingOut", -12000)
	cat(catTransport, 0, 0, "transport", 0)
	cat(catFuel, catTransport, 0, "fuel", -11000)
	cat(catTransit, catTransport, 0, "transit", 0)
	cat(catLeisure, 0, 0, "leisure", 0)
	cat(catSubscriptions, catLeisure, 0, "subs", -3000)
	cat(catSport, catLeisure, 0, "sport", 0)
	cat(catBooks, catLeisure, 0, "books", 0)
	cat(catHolidays, catLeisure, 0, "holidays", 0)
	cat(catHealth, 0, 0, "health", 0)
	cat(catClothing, 0, 0, "clothing", -6000)
	cat(catGifts, 0, 0, "gifts", 0)
	x.Tags = []importer.XTag{{Key: 1, Name: s.w("tagHoliday")}}

	// Twelve months, the current one only up to today.
	first := time.Date(s.today.Year(), s.today.Month(), 1, 0, 0, 0, 0, time.UTC)
	for back := 11; back >= 0; back-- {
		s.month(first.AddDate(0, -back, 0), back)
	}

	// Rules the reader can watch at work when they type a memo.
	x.Assignments = []importer.XAsg{
		{Key: 1, Flags: asgDoCategory, Field: 1, Name: s.w("super"), Category: catGroceries},
		{Key: 2, Flags: asgDoCategory, Field: 1, Name: s.w("petrol"), Category: catFuel},
	}

	// The recurring bills, each next due after the last one posted. The energy
	// bill is due three days ago and unpaid, so the overview has something to
	// point at.
	next := func(day int) time.Time {
		d := time.Date(s.today.Year(), s.today.Month(), day, 0, 0, 0, 0, time.UTC)
		if !d.After(s.today) {
			d = d.AddDate(0, 1, 0)
		}
		return d
	}
	fav := func(account int, cents int64, mode, payee, category int, memo string, due time.Time) {
		x.Favorites = append(x.Favorites, importer.XFav{
			Account: account, Amount: amount(cents), Paymode: mode, Payee: payee, Category: category,
			Wording: memo, Nextdate: julian(due), Every: 1, Unit: 2,
		})
	}
	fav(accChecking, 245000, modeDeposit, payEmployer, catSalary, s.w("salary"), next(27))
	fav(accChecking, -75000, modeStanding, payLandlord, catRent, s.w("rent"), next(1))
	fav(accChecking, -2990, modeDirect, payInternet, catInternet, s.w("internet"), next(5))
	fav(accCard, -1299, modeCard, payStreaming, catSubscriptions, s.w("streaming"), next(15))
	fav(accChecking, -7800, modeDirect, payEnergy, catUtilities, s.w("energy"), s.energyDue())
	return x
}

// energyDue is the day the unpaid energy bill fell due.
func (s *seeder) energyDue() time.Time { return s.today.AddDate(0, 0, -3) }

// month writes one month's money. back counts months before the current one.
func (s *seeder) month(start time.Time, back int) {
	days := start.AddDate(0, 1, -1).Day()
	on := func(day int) time.Time {
		if day > days {
			day = days
		}
		return start.AddDate(0, 0, day-1)
	}

	s.add(ope{date: on(27), account: accChecking, cents: 245000, mode: modeDeposit, payee: payEmployer, category: catSalary, memo: s.w("salary")})
	if start.Month() == time.December {
		s.add(ope{date: on(18), account: accChecking, cents: 80000, mode: modeDeposit, payee: payEmployer, category: catOtherIncome, memo: s.w("bonus")})
	}
	s.add(ope{date: on(1), account: accChecking, cents: -75000, mode: modeStanding, payee: payLandlord, category: catRent, memo: s.w("rent")})
	s.add(ope{date: on(5), account: accChecking, cents: -2990, mode: modeDirect, payee: payInternet, category: catInternet, memo: s.w("internet")})
	// The energy bill falls three days before today's day of the month; the
	// latest one is left unpaid (see seedFile).
	winter := start.Month() <= time.March || start.Month() >= time.November
	lo, hi := int64(5200), int64(7400)
	if winter {
		lo, hi = 8200, 11800
	}
	energy := s.energyDue()
	if bill := on(energy.Day()); bill.Before(energy) {
		s.add(ope{date: bill, account: accChecking, cents: -s.between(lo, hi), mode: modeDirect, payee: payEnergy, category: catUtilities, memo: s.w("energy")})
	}
	s.add(ope{date: on(15), account: accCard, cents: -1299, mode: modeCard, payee: payStreaming, category: catSubscriptions, memo: s.w("streaming")})
	s.add(ope{date: on(3), account: accChecking, cents: -3900, mode: modeDebit, payee: payGym, category: catSport, memo: s.w("gym")})
	s.add(ope{date: on(2), account: accChecking, cents: -3500, mode: modeDebit, payee: payTransit, category: catTransit, memo: s.w("pass")})

	// Groceries: most weeks at the supermarket, a Saturday market now and then,
	// and one receipt a month that was partly for the house.
	for _, day := range []int{4, 9, 16, 23, 29} {
		s.add(ope{date: on(day + s.rng.IntN(2)), account: accChecking, cents: -s.between(3800, 8900), mode: modeDebit, payee: paySupermarket, category: catGroceries, memo: s.w("weekly")})
	}
	s.add(ope{date: on(13), account: accCash, cents: -s.between(1400, 3200), mode: modeCash, payee: payMarket, category: catGroceries})
	s.split(on(20), s.between(3000, 5200), s.between(1500, 3500))

	for i, n := 0, 2+s.rng.IntN(3); i < n; i++ {
		s.add(ope{date: on(6 + 7*i + s.rng.IntN(3)), account: accCard, cents: -s.between(2400, 6800), mode: modeCard, payee: payRestaurant, category: catRestaurants})
	}
	for _, day := range []int{7, 21} {
		s.add(ope{date: on(day), account: accCard, cents: -s.between(4500, 6900), mode: modeCard, payee: payPetrol, category: catFuel})
	}
	for i := 0; i < 4; i++ {
		s.add(ope{date: on(3 + 6*i + s.rng.IntN(4)), account: accCash, cents: -s.between(150, 480), mode: modeCash, payee: payCafe, category: catRestaurants})
	}
	if s.rng.IntN(3) == 0 {
		s.add(ope{date: on(11 + s.rng.IntN(10)), account: accChecking, cents: -s.between(900, 3600), mode: modeDebit, payee: payPharmacy, category: catHealth})
	}
	if back%2 == 1 {
		s.add(ope{date: on(17), account: accCard, cents: -s.between(3500, 12000), mode: modeCard, payee: payClothes, category: catClothing})
	}
	if back%3 == 0 {
		s.add(ope{date: on(24), account: accCard, cents: -s.between(1200, 3200), mode: modeCard, payee: payBookshop, category: catBooks})
	}
	if start.Month() == time.December {
		for _, day := range []int{12, 19} {
			s.add(ope{date: on(day), account: accCard, cents: -s.between(3000, 9000), mode: modeCard, payee: payClothes, category: catGifts})
		}
	}
	// One summer week away, tagged so the tag has something to find.
	if start.Month() == time.August {
		tag := s.w("tagHoliday")
		s.add(ope{date: on(10), account: accCard, cents: -64000, mode: modeCard, payee: payHotel, category: catHolidays, tags: tag})
		for day := 10; day <= 15; day++ {
			s.add(ope{date: on(day), account: accCard, cents: -s.between(3500, 7500), mode: modeCard, payee: payRestaurant, category: catRestaurants, tags: tag})
		}
		s.add(ope{date: on(9), account: accCard, cents: -6800, mode: modeCard, payee: payPetrol, category: catFuel, tags: tag})
	}
	if back == 4 {
		s.add(ope{date: on(14), account: accChecking, cents: 4590, mode: modeTransfer, payee: payClothes, category: catClothing, memo: s.w("refund")})
	}

	s.transfer(on(6), accChecking, accCash, 6000, s.w("withdraw"))
	s.transfer(on(28), accChecking, accSavings, 40000, s.w("topUp"))
	// Last month's card spending, paid off from checking.
	if back < 11 {
		prev := start.AddDate(0, -1, 0).Month()
		s.transfer(on(20), accChecking, accCard, -s.cardSpend[prev], s.w("payOff"))
	}
}
